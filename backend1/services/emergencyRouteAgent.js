const Anthropic = require('@anthropic-ai/sdk');
const { betaTool } = require('@anthropic-ai/sdk/helpers/beta/json-schema');
const config = require('../config/env');
const logger = require('../utils/logger');
const AgentToolbox = require('./agentToolbox');
const routingService = require('./routingService');
const { checkExplanation } = require('./aiGuardrails');
const { LIVE_TRAFFIC_UNAVAILABLE } = require('./trafficService');

/**
 * Emergency Route Agent
 *
 * planRoute():    the agent's core workflow. Calls its tools in a fixed, auditable
 *                 order (location → facility → routing → hazards/weather → traffic →
 *                 evaluation → rerouting) and returns a recommendation with a full
 *                 step trace. Runs without any AI provider, so navigation never
 *                 waits on an LLM.
 * reviewWithAI(): optional Claude-driven reasoning pass over the same tools. Claude
 *                 decides which tools to call, reasons over their results, and must
 *                 submit one of the engine-validated routes. Guardrails reject any
 *                 explanation containing facts not present in the tool data.
 */

function publicRoute(r) {
  return {
    id: r.id,
    label: r.label,
    provider: r.provider,
    distance: Math.round(r.distance),
    duration: Math.round(r.duration),
    geometry: r.geometry,
    summary: r.summary,
    steps: r.steps,
    isDetour: Boolean(r.isDetour),
  };
}

function buildPlan(tools, evaluation, extra = {}) {
  const routes = tools.state.routes || [];
  return {
    emergencyType: tools.emergencyType,
    origin: tools.origin,
    destination: tools.destination,
    facility: tools.facility || null,
    facilities: tools.state.facilities?.facilities || null,
    routes: routes.map(publicRoute),
    recommendedRouteId: evaluation.recommendedRouteId,
    evaluation,
    explanation: { text: evaluation.reason, source: 'engine' },
    hazards: tools.state.hazardData?.hazards || [],
    hazardDataAvailable: tools.state.hazardData?.available ?? false,
    traffic: tools.state.traffic ? { liveTrafficAvailable: false, note: tools.state.traffic.note, durationBasis: tools.state.traffic.durationBasis } : null,
    weather: tools.state.weather || null,
    provider: routingService.describeProvider(),
    simulation: tools.includeSimulated,
    trace: tools.trace,
    ai: { available: config.ai.enabled, model: config.ai.enabled ? config.ai.model : null },
    dataSources: [
      'Route geometry & durations: ' + routingService.describeProvider().label,
      `Facilities: ${tools.state.facilities?.source || 'OpenStreetMap contributors (Overpass API / Nominatim)'}`,
      'Addresses: OpenStreetMap Nominatim',
      'Weather: Open-Meteo',
      `Hazards: RouteMind hazard reports${tools.includeSimulated ? ' (including SIMULATED data)' : ''}`,
      'Live traffic: not available',
    ],
    generatedAt: new Date().toISOString(),
    ...extra,
  };
}

/** Deterministic agent workflow. */
async function planRoute({ emergencyType, origin, destination, facility, includeSimulated = false }) {
  const tools = new AgentToolbox({ emergencyType, origin, destination, facility, includeSimulated });
  await tools.getCurrentLocation();
  if (!destination) await tools.selectDestinationFacility();
  await tools.calculateRoute();
  await tools.getRoadConditions();
  await tools.getTrafficInformation();
  let evaluation = await tools.evaluateRoute();
  if (evaluation.allRoutesBlocked) evaluation = await tools.recalculateRoute();
  return buildPlan(tools, evaluation);
}

// ---------------------------------------------------------------------------
// Claude-driven review
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the Emergency Route Agent inside RouteMind, an emergency navigation decision-support prototype.

Your job: decide which candidate route to recommend for an active emergency trip and explain why, using ONLY data returned by your tools.

How to work:
- Call get_emergency_context, then gather route options, road conditions (reported hazards + weather) and traffic information, then call evaluate_routes for the deterministic engine's scoring.
- If every route is blocked, call find_detour_routes.
- Finish by calling submit_recommendation exactly once.

Rules:
- Only recommend a route the evaluation marks as viable. You may prefer a different viable route than the engine's top score only when the tool data supports it (for example a markedly lower hazard risk for a small time cost); say so explicitly.
- Never invent roads, places, facilities, incidents, traffic conditions or numbers. Every distance, duration, hazard and road name you mention must appear in tool results. Round numbers the way the tools present them.
- Live traffic data is not available from the configured providers. Do not describe traffic as light, heavy, clear, etc. Say that live traffic data is unavailable.
- Hazards marked simulated are developer test data; call them simulated.
- The explanation is read by a stressed person during an emergency: 2–4 short, plain sentences, leading with the recommendation. Refer to routes by their labels (e.g. "Route B").`;

function compactEvaluation(evaluation) {
  return {
    recommended_route_id: evaluation.recommendedRouteId,
    recommended_label: evaluation.recommendedRoute,
    all_routes_blocked: evaluation.allRoutesBlocked,
    engine_reason: evaluation.reason,
    decision_factors: evaluation.decisionFactors,
    routes: evaluation.evaluations.map((e) => ({
      route_id: e.routeId,
      label: e.label,
      viable: e.viable,
      distance_km: Number((e.distance / 1000).toFixed(2)),
      base_duration_min: Number((e.baseDuration / 60).toFixed(1)),
      estimated_hazard_delay_min: Number((e.hazardDelaySeconds / 60).toFixed(1)),
      adjusted_duration_min: Number((e.adjustedDuration / 60).toFixed(1)),
      risk_level: e.riskLevel,
      score: e.score,
      hazards: e.hazards.map((h) => ({ type: h.type, severity: h.severity, title: h.title, simulated: h.isSimulated, blocking: h.blocking })),
    })),
  };
}

function buildClaudeTools(tools, decisionRef, callLog) {
  const logged = (name, fn) => async (input) => {
    const started = Date.now();
    try {
      const out = await fn(input);
      callLog.push({ tool: name, status: 'ok', durationMs: Date.now() - started });
      return JSON.stringify(out);
    } catch (err) {
      callLog.push({ tool: name, status: 'error', summary: err.message, durationMs: Date.now() - started });
      return JSON.stringify({ error: err.message });
    }
  };
  const noInput = { type: 'object', properties: {}, additionalProperties: false };

  return [
    betaTool({
      name: 'get_emergency_context',
      description: 'Emergency type, origin (real device or user-selected coordinates, with reverse-geocoded address), destination and selected facility.',
      inputSchema: noInput,
      run: logged('get_emergency_context', async () => {
        await tools.getCurrentLocation();
        await tools.selectDestinationFacility();
        return tools.context();
      }),
    }),
    betaTool({
      name: 'get_route_options',
      description: 'Candidate driving routes from the routing provider (primary + alternatives), with distance, duration and main roads. Durations come from static road-speed profiles, not live traffic.',
      inputSchema: noInput,
      run: logged('get_route_options', async () => {
        await tools.calculateRoute();
        return { provider: routingService.describeProvider().label, routes: tools.routeSummaries() };
      }),
    }),
    betaTool({
      name: 'get_road_conditions',
      description: 'Active reported hazards (user reports or simulated test data) affecting each candidate route, plus current weather risk from Open-Meteo.',
      inputSchema: noInput,
      run: logged('get_road_conditions', async () => {
        const { hazardImpacts, weather, hazardData } = await tools.getRoadConditions();
        const perRoute = {};
        for (const [routeId, list] of Object.entries(hazardImpacts)) {
          perRoute[routeId] = list.map((i) => ({
            type: i.hazard.type,
            severity: i.hazard.severity,
            title: i.hazard.title,
            simulated: Boolean(i.hazard.isSimulated),
            blocking: i.blocking,
            estimated_delay_min: Number((i.delaySeconds / 60).toFixed(1)),
            distance_from_route_m: i.distanceFromRoute,
            km_into_route: Number((i.alongMeters / 1000).toFixed(2)),
          }));
        }
        return {
          hazard_data_available: hazardData?.available ?? false,
          hazard_note: hazardData?.note || null,
          hazards_by_route: perRoute,
          weather: weather.available
            ? { source: weather.source, condition: weather.condition, risk: weather.risk, reasons: weather.reasons }
            : { available: false, note: weather.note },
        };
      }),
    }),
    betaTool({
      name: 'get_traffic_information',
      description: 'Traffic information available to RouteMind (live traffic availability and user-reported congestion per route).',
      inputSchema: noInput,
      run: logged('get_traffic_information', async () => {
        const t = await tools.getTrafficInformation();
        return { live_traffic_available: t.liveTrafficAvailable, note: t.note, duration_basis: t.durationBasis, reported_congestion_by_route: t.reportedCongestion };
      }),
    }),
    betaTool({
      name: 'evaluate_routes',
      description: "Run RouteMind's deterministic Emergency Route Engine: per-route viability, hazard delay, risk level and score (lower is better), plus the engine's own recommendation.",
      inputSchema: noInput,
      run: logged('evaluate_routes', async () => compactEvaluation(await tools.evaluateRoute())),
    }),
    betaTool({
      name: 'find_detour_routes',
      description: 'Generate detour candidates around blocking hazards and re-evaluate. Only useful when all routes are blocked.',
      inputSchema: noInput,
      run: logged('find_detour_routes', async () => compactEvaluation(await tools.recalculateRoute())),
    }),
    betaTool({
      name: 'submit_recommendation',
      description: 'Submit the final recommendation. route_id must be a viable route from evaluate_routes.',
      inputSchema: {
        type: 'object',
        properties: {
          route_id: { type: 'string', description: 'route_id of the recommended route' },
          explanation: { type: 'string', description: '2–4 plain sentences grounded in tool data' },
          warnings: { type: 'array', items: { type: 'string' }, description: 'Short safety-relevant warnings from tool data' },
          agrees_with_engine: { type: 'boolean' },
        },
        required: ['route_id', 'explanation', 'warnings', 'agrees_with_engine'],
        additionalProperties: false,
      },
      run: logged('submit_recommendation', async (input) => {
        const evaluation = tools.state.evaluation || (await tools.evaluateRoute());
        const target = evaluation.evaluations.find((e) => e.routeId === input.route_id);
        if (!target) {
          return { accepted: false, error: `Unknown route_id. Valid viable route_ids: ${evaluation.evaluations.filter((e) => e.viable).map((e) => e.routeId).join(', ') || 'none'}` };
        }
        if (!target.viable) return { accepted: false, error: `${target.label} is not viable (blocked). Choose a viable route.` };
        decisionRef.current = { ...input, label: target.label };
        return { accepted: true };
      }),
    }),
  ];
}

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: config.ai.apiKey, timeout: config.ai.timeoutMs, maxRetries: 1 });
  return client;
}

function aiErrorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'AI provider rejected the API key.';
  if (err instanceof Anthropic.RateLimitError) return 'AI provider rate limit reached.';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'AI provider timed out.';
  if (err instanceof Anthropic.APIConnectionError) return 'Unable to reach the AI provider.';
  if (err instanceof Anthropic.APIError) return `AI provider error (HTTP ${err.status}).`;
  return 'AI review failed.';
}

/**
 * Claude reviews the trip using the agent's tools.
 * Always resolves; on any failure returns status 'unavailable' | 'error' | 'fallback'
 * together with the deterministic engine result.
 */
async function reviewWithAI({ emergencyType, origin, destination, includeSimulated = false }) {
  const tools = new AgentToolbox({ emergencyType, origin, destination, includeSimulated });
  const base = { model: config.ai.model, toolCalls: [], guardrail: null };

  if (!config.ai.enabled) {
    const evaluation = await tools.evaluateRoute();
    return {
      ...base,
      status: 'unavailable',
      message: 'AI reasoning is not configured (set AI_API_KEY). Showing the deterministic engine explanation.',
      explanation: { text: evaluation.reason, source: 'engine' },
      decision: { routeId: evaluation.recommendedRouteId, label: evaluation.recommendedRoute, agreesWithEngine: true },
      evaluation,
      routes: (tools.state.routes || []).map(publicRoute),
      trace: tools.trace,
    };
  }

  const decisionRef = { current: null };
  const callLog = base.toolCalls;
  let finalMessage;
  let failure = null;
  try {
    const runner = getClient().beta.messages.toolRunner({
      model: config.ai.model,
      max_tokens: 16000,
      max_iterations: config.ai.maxIterations,
      output_config: { effort: config.ai.effort },
      // Server-side refusal fallback (routes a declined request to another model).
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      tools: buildClaudeTools(tools, decisionRef, callLog),
      messages: [
        {
          role: 'user',
          content: 'An emergency trip needs a route recommendation. Use your tools to gather the data, evaluate the routes and submit your recommendation.',
        },
      ],
    });
    finalMessage = await runner.runUntilDone();
    if (finalMessage.stop_reason === 'refusal') failure = 'The AI model declined this request.';
  } catch (err) {
    logger.warn('AI review failed:', aiErrorMessage(err));
    failure = aiErrorMessage(err);
  }

  // Ground truth for guardrails: make sure the deterministic evaluation exists.
  let evaluation;
  try {
    evaluation = tools.state.evaluation || (await tools.evaluateRoute());
  } catch (err) {
    return { ...base, status: 'error', message: err.message, trace: tools.trace };
  }
  const routes = tools.state.routes || [];
  const engineResult = {
    explanation: { text: evaluation.reason, source: 'engine' },
    decision: { routeId: evaluation.recommendedRouteId, label: evaluation.recommendedRoute, agreesWithEngine: true },
  };
  const common = { evaluation, routes: routes.map(publicRoute), trace: tools.trace, usage: finalMessage?.usage || null };

  if (failure || !decisionRef.current) {
    return {
      ...base,
      ...common,
      ...engineResult,
      status: 'fallback',
      message: failure || 'The AI agent did not submit a recommendation. Showing the deterministic engine result.',
    };
  }

  const decision = decisionRef.current;
  const guardrail = checkExplanation(decision.explanation, { evaluation, traffic: tools.state.traffic, routes, chosenRouteId: decision.route_id });
  if (!guardrail.passed) {
    return {
      ...base,
      ...common,
      ...engineResult,
      guardrail,
      status: 'fallback',
      message: 'The AI explanation contained statements not supported by the route data and was discarded. Showing the deterministic engine result.',
    };
  }

  let text = decision.explanation.trim();
  if (!/live traffic/i.test(text)) text += ` ${LIVE_TRAFFIC_UNAVAILABLE}`;
  return {
    ...base,
    ...common,
    guardrail,
    status: 'completed',
    explanation: { text, source: 'ai' },
    warnings: (decision.warnings || []).slice(0, 6).map((w) => String(w).slice(0, 300)),
    decision: {
      routeId: decision.route_id,
      label: decision.label,
      agreesWithEngine: decision.route_id === evaluation.recommendedRouteId,
    },
  };
}

module.exports = { planRoute, reviewWithAI, publicRoute, SYSTEM_PROMPT };
