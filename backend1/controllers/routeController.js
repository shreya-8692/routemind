const EmergencyRequest = require('../models/EmergencyRequest');
const RouteSession = require('../models/RouteSession');
const { isDbConnected } = require('../config/db');
const agent = require('../services/emergencyRouteAgent');
const monitor = require('../services/routeMonitorService');
const logger = require('../utils/logger');
const v = require('../utils/validate');
const { EMERGENCY_TYPES } = require('../utils/constants');
const { ValidationError } = require('../utils/errors');

// Stored history coordinates are rounded to 4 decimals (~11 m).
const round4 = (n) => Math.round(n * 1e4) / 1e4;
const place = (p) => (p ? { latitude: round4(p.lat), longitude: round4(p.lng), address: p.address, name: p.name } : undefined);
const isObjectId = (id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);

function parsePlanInput(body, { requireDestination = false } = {}) {
  return {
    emergencyType: v.oneOf(body.emergencyType, EMERGENCY_TYPES, 'emergencyType'),
    origin: v.parsePoint(body.origin, 'origin'),
    destination: v.parsePoint(body.destination, 'destination', { required: requireDestination }),
    includeSimulated: v.bool(body.includeSimulated),
    emergencyRequestId: isObjectId(body.emergencyRequestId) ? body.emergencyRequestId : null,
  };
}

/** Saves the plan to emergencyRequests + routeSessions. Never fails the routing response. */
async function persistPlan(plan, { emergencyRequestId, eventType, reason }) {
  if (!isDbConnected()) return { persisted: false, note: 'Database unavailable: this route is not saved to history.' };
  try {
    let request = emergencyRequestId ? await EmergencyRequest.findById(emergencyRequestId) : null;
    if (!request) request = new EmergencyRequest({ emergencyType: plan.emergencyType });
    const selected = plan.routes.find((r) => r.id === plan.recommendedRouteId);

    request.emergencyType = plan.emergencyType;
    request.origin = place(plan.origin);
    request.destination = place(plan.destination);
    request.destinationFacility = plan.facility ? { osmId: plan.facility.id, category: plan.facility.category } : undefined;
    request.status = 'Active';
    request.route = selected
      ? { label: selected.label, provider: selected.provider, summary: selected.summary, riskLevel: plan.evaluation.riskLevel }
      : undefined;
    request.estimatedTime = plan.evaluation.estimatedTime ?? undefined;
    request.distance = plan.evaluation.distance ?? undefined;
    request.warnings = plan.evaluation.warnings.slice(0, 20);
    request.simulation = plan.simulation;
    if (eventType === 'recalculated') request.rerouteCount += 1;

    let session = request.routeSession ? await RouteSession.findById(request.routeSession) : null;
    if (!session) session = new RouteSession({ emergencyRequest: request._id });
    session.emergencyType = plan.emergencyType;
    session.provider = plan.provider.id;
    session.selectedRouteId = plan.recommendedRouteId;
    session.selectedRoute = selected
      ? { id: selected.id, label: selected.label, distance: selected.distance, duration: selected.duration, geometry: selected.geometry }
      : undefined;
    session.evaluation = plan.evaluation;
    session.agentTrace = plan.trace;
    session.events.push({ type: eventType, reason });
    request.routeSession = session._id;

    await Promise.all([session.save(), request.save()]);
    return { persisted: true, emergencyRequestId: String(request._id), sessionId: String(session._id) };
  } catch (err) {
    logger.error('Failed to persist route plan:', err.message);
    return { persisted: false, note: 'Route could not be saved to history (database error).' };
  }
}

async function calculate(req, res) {
  const input = parsePlanInput(req.body);
  const plan = await agent.planRoute(input);
  const persistence = await persistPlan(plan, { emergencyRequestId: input.emergencyRequestId, eventType: 'calculated', reason: 'Initial route' });
  res.json({ plan, ...persistence });
}

async function recalculate(req, res) {
  const input = parsePlanInput(req.body, { requireDestination: true });
  const reason = v.string(req.body.reason, 'reason', { max: 300 }) || 'Recalculation requested';
  if (input.emergencyRequestId && isDbConnected()) {
    await EmergencyRequest.updateOne({ _id: input.emergencyRequestId }, { status: 'Rerouting' }).catch(() => {});
  }
  const plan = await agent.planRoute(input);
  const persistence = await persistPlan(plan, { emergencyRequestId: input.emergencyRequestId, eventType: 'recalculated', reason });
  res.json({ plan, rerouted: true, reason, ...persistence });
}

async function monitorProgress(req, res) {
  const body = req.body || {};
  if (!body.route || typeof body.route !== 'object') throw new ValidationError('route is required.');
  const route = {
    geometry: v.parsePolyline(body.route.geometry, 'route.geometry'),
    distance: v.number(body.route.distance, 'route.distance', { min: 0 }) || 0,
    duration: v.number(body.route.duration, 'route.duration', { min: 0 }) || 0,
  };
  const knownHazardIds = Array.isArray(body.knownHazardIds) ? body.knownHazardIds.slice(0, 500).map(String) : [];
  const result = await monitor.checkProgress({
    route,
    destination: v.parsePoint(body.destination, 'destination', { required: false }),
    position: v.parsePoint(body.position, 'position'),
    accuracy: v.number(body.accuracy, 'accuracy', { min: 0, max: 100000 }),
    offRouteThreshold: v.number(body.offRouteThreshold, 'offRouteThreshold', { min: 20, max: 300 }) ?? 60,
    knownHazardIds,
    includeSimulated: v.bool(body.includeSimulated),
  });

  // Record notable events (without coordinates) on the session.
  const sessionId = isObjectId(body.sessionId) ? body.sessionId : null;
  const eventType = { 'off-route': 'off-route', 'reroute-recommended': 'hazard-detected', arrived: 'arrived' }[result.status];
  if (sessionId && eventType && isDbConnected()) {
    const session = await RouteSession.findById(sessionId).catch(() => null);
    const last = session?.events[session.events.length - 1];
    if (session && last?.type !== eventType) {
      session.events.push({ type: eventType, reason: result.rerouteReason || result.messages[0] });
      await session.save().catch(() => {});
    }
  }
  res.json(result);
}

async function aiReview(req, res) {
  const input = parsePlanInput(req.body, { requireDestination: true });
  const review = await agent.reviewWithAI(input);
  const sessionId = isObjectId(req.body.sessionId) ? req.body.sessionId : null;
  if (sessionId && isDbConnected()) {
    await RouteSession.updateOne(
      { _id: sessionId },
      {
        aiReview: { status: review.status, model: review.model, decision: review.decision, explanation: review.explanation, guardrail: review.guardrail, toolCalls: review.toolCalls },
        $push: { events: { type: 'ai-review', reason: `AI review ${review.status}` } },
      },
    ).catch(() => {});
  }
  res.json(review);
}

module.exports = { calculate, recalculate, monitorProgress, aiReview };
