const { formatDuration, formatDistance } = require('../utils/format');
const { EMERGENCY_LABELS } = require('../utils/constants');

/**
 * Emergency Route Engine — deterministic, explainable route evaluation.
 *
 * Score (lower is better), in seconds:
 *   score = adjustedDuration × timeWeight
 *         + Σ(severityPoints) × 30 × riskWeight
 *         + distanceKm × 3                      (tie-breaker)
 *   adjustedDuration = routing-engine duration + Σ(estimated hazard delays × type multiplier)
 * Routes passing a blocking hazard are not viable and are never recommended.
 */
const PROFILES = {
  medical: {
    timeWeight: 1.0,
    riskWeight: 1.0,
    typeMultipliers: {},
    rationale: 'Patient transport: minimise travel time while avoiding severe hazards that could delay or endanger the patient.',
  },
  accident: {
    timeWeight: 1.0,
    riskWeight: 1.2,
    typeMultipliers: { Accident: 1.3 },
    rationale: 'Trauma response: minimise travel time; secondary accidents and severe hazards weigh more.',
  },
  fire: {
    timeWeight: 1.0,
    riskWeight: 1.0,
    typeMultipliers: { Construction: 1.5, Flooding: 1.5, 'Traffic Congestion': 1.3 },
    rationale: 'Large fire appliances: obstructed or narrowed roads (construction, flooding, congestion) weigh more.',
  },
  police: {
    timeWeight: 1.0,
    riskWeight: 0.6,
    typeMultipliers: {},
    rationale: 'Rapid response: travel time dominates; moderate hazards weigh less.',
  },
  other: {
    timeWeight: 1.0,
    riskWeight: 1.0,
    typeMultipliers: {},
    rationale: 'Balanced: travel time and hazard exposure weighed equally.',
  },
};

const SEVERITY_POINTS = { Low: 1, Medium: 2, High: 4, Critical: 8 };
const RISK_ORDER = ['Low', 'Moderate', 'High', 'Critical'];
const SEVERITY_TO_RISK = { Low: 'Low', Medium: 'Moderate', High: 'High', Critical: 'Critical' };

const maxRisk = (a, b) => (RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b);
const routeLabel = (index) => `Route ${String.fromCharCode(65 + index)}`;

function hazardText(h) {
  return `${h.type} (${h.severity})${h.isSimulated ? ' [SIMULATED]' : ''}`;
}

function evaluateRoute(route, label, impacts, profile, weather) {
  let delay = 0;
  let riskPoints = 0;
  let riskLevel = 'Low';
  let blocked = false;
  for (const impact of impacts) {
    const h = impact.hazard;
    riskPoints += SEVERITY_POINTS[h.severity] || 1;
    riskLevel = maxRisk(riskLevel, SEVERITY_TO_RISK[h.severity] || 'Moderate');
    if (impact.blocking) {
      blocked = true;
    } else {
      let multiplier = profile.typeMultipliers[h.type] || 1;
      if (h.type === 'Flooding' && weather?.available && weather.risk === 'high') multiplier *= 1.5;
      delay += impact.delaySeconds * multiplier;
    }
  }
  if (blocked) riskLevel = 'Critical';
  if (weather?.available && weather.risk === 'high') riskLevel = maxRisk(riskLevel, 'High');
  else if (weather?.available && weather.risk === 'moderate') riskLevel = maxRisk(riskLevel, 'Moderate');

  const adjustedDuration = route.duration + delay;
  const riskPenalty = riskPoints * 30 * profile.riskWeight;
  const score = adjustedDuration * profile.timeWeight + riskPenalty + (route.distance / 1000) * 3;

  return {
    routeId: route.id,
    label,
    isDetour: Boolean(route.isDetour),
    distance: Math.round(route.distance),
    baseDuration: Math.round(route.duration),
    hazardDelaySeconds: Math.round(delay),
    adjustedDuration: Math.round(adjustedDuration),
    riskPenaltySeconds: Math.round(riskPenalty),
    score: Math.round(score),
    viable: !blocked,
    blocked,
    riskLevel,
    hazards: impacts.map((i) => ({
      id: i.hazard.id,
      type: i.hazard.type,
      severity: i.hazard.severity,
      title: i.hazard.title,
      isSimulated: Boolean(i.hazard.isSimulated),
      blocking: i.blocking,
      estimatedDelaySeconds: i.delaySeconds,
      distanceFromRoute: i.distanceFromRoute,
      alongMeters: i.alongMeters,
      latitude: i.hazard.latitude,
      longitude: i.hazard.longitude,
    })),
  };
}

function buildReason(best, evaluations, traffic) {
  const parts = [];
  const fastestBase = [...evaluations].sort((a, b) => a.baseDuration - b.baseDuration)[0];

  if (!best) {
    parts.push(
      `All ${evaluations.length} available route${evaluations.length > 1 ? 's pass' : ' passes'} a reported blocking hazard (` +
        [...new Set(evaluations.flatMap((e) => e.hazards.filter((h) => h.blocking).map(hazardText)))].join(', ') +
        '). No viable route could be recommended.',
    );
  } else if (evaluations.length === 1) {
    parts.push(
      `${best.label} is the only route returned by the routing service (${formatDistance(best.distance)}, about ${formatDuration(best.adjustedDuration)}).`,
    );
  } else if (best.routeId === fastestBase.routeId) {
    parts.push(
      `RouteMind recommends ${best.label}: it has the shortest estimated travel time (${formatDuration(best.adjustedDuration)}, ${formatDistance(best.distance)})` +
        (best.hazards.length ? '.' : ' and no reported hazards affect it.'),
    );
  } else {
    const avoided = fastestBase.hazards.length
      ? `${fastestBase.label} (fastest by base time) passes ${fastestBase.hazards.map(hazardText).join(', ')}`
      : `${fastestBase.label} has a higher overall score`;
    const extraKm = (best.distance - fastestBase.distance) / 1000;
    const extraMin = Math.round((best.baseDuration - fastestBase.baseDuration) / 60);
    const cost = [
      extraKm > 0.05 ? `approximately ${extraKm.toFixed(1)} km longer` : null,
      extraMin > 0 ? `about ${extraMin} min slower by base time` : null,
    ].filter(Boolean).join(' and ');
    parts.push(
      `RouteMind recommends ${best.label}${best.isDetour ? ' (a detour generated to avoid a reported hazard)' : ''} because ${avoided}.` +
        (cost ? ` ${best.label} is ${cost}, but` : ` ${best.label}`) +
        (fastestBase.hazards.length
          ? ` currently avoids ${fastestBase.hazards.some((h) => h.blocking) ? 'the reported obstruction' : 'those reported hazards'}.`
          : ' scores better overall.'),
    );
  }

  if (best && best.hazards.length) {
    parts.push(
      `${best.label} still passes ${best.hazards.map(hazardText).join(', ')}` +
        (best.hazardDelaySeconds ? `, with an estimated extra delay of ${formatDuration(best.hazardDelaySeconds)}.` : '.'),
    );
  }
  if (!traffic?.liveTrafficAvailable) parts.push(traffic?.note || 'Live traffic data is unavailable.');
  return parts.join(' ');
}

/**
 * @param {object} input
 * @param {Array} input.routes            normalized routes from routingService
 * @param {object} input.hazardImpacts    { routeId: impacts[] } from hazardService.findHazardsOnRoutes
 * @param {object} input.traffic          from trafficService
 * @param {object} input.weather          from weatherService
 * @param {string} input.emergencyType
 * @param {string} [input.facilityType]
 * @param {object} [input.hazardData]     { available, note } from hazardService.getActiveHazards
 */
function evaluateRoutes({ routes, hazardImpacts = {}, traffic, weather, emergencyType = 'other', facilityType, hazardData }) {
  const profile = PROFILES[emergencyType] || PROFILES.other;
  const evaluations = routes.map((route, i) =>
    evaluateRoute(route, route.label || routeLabel(i), hazardImpacts[route.id] || [], profile, weather),
  );
  const viable = evaluations.filter((e) => e.viable).sort((a, b) => a.score - b.score);
  const best = viable[0] || null;

  const warnings = [];
  if (!best) warnings.push('All available routes pass a reported blocking hazard. Consider an alternative destination.');
  if (best) {
    for (const h of best.hazards) {
      warnings.push(`${h.isSimulated ? '[SIMULATED] ' : ''}${h.type} (${h.severity}) reported on the recommended route: ${h.title}`);
    }
  }
  for (const e of evaluations) {
    if (best && e.routeId !== best.routeId && e.blocked) {
      warnings.push(`${e.label} is not viable: it passes a reported blocking hazard.`);
    }
  }
  if (weather?.available && weather.risk !== 'low') {
    warnings.push(`Weather risk ${weather.risk}: ${weather.reasons.join('; ')} (Open-Meteo).`);
  }
  if (!weather?.available) warnings.push(weather?.note || 'Weather data unavailable.');
  if (hazardData && !hazardData.available) warnings.push(hazardData.note);
  if (!traffic?.liveTrafficAvailable) warnings.push(traffic?.note || 'Live traffic data is unavailable.');

  return {
    recommendedRouteId: best ? best.routeId : null,
    recommendedRoute: best ? best.label : null,
    reason: buildReason(best, evaluations, traffic),
    riskLevel: best ? best.riskLevel : 'Critical',
    estimatedTime: best ? best.adjustedDuration : null,
    estimatedTimeText: best ? formatDuration(best.adjustedDuration) : null,
    distance: best ? best.distance : null,
    distanceText: best ? formatDistance(best.distance) : null,
    warnings,
    allRoutesBlocked: !best,
    evaluations: evaluations.sort((a, b) => (a.viable === b.viable ? a.score - b.score : a.viable ? -1 : 1)),
    decisionFactors: {
      emergencyType,
      emergencyLabel: EMERGENCY_LABELS[emergencyType] || emergencyType,
      facilityType: facilityType || null,
      profile: { timeWeight: profile.timeWeight, riskWeight: profile.riskWeight, typeMultipliers: profile.typeMultipliers },
      rationale: profile.rationale,
      liveTraffic: Boolean(traffic?.liveTrafficAvailable),
      weatherRisk: weather?.available ? weather.risk : 'unknown',
      hazardDataAvailable: hazardData ? hazardData.available : true,
      formula: 'score = adjustedDuration × timeWeight + Σ severityPoints × 30 s × riskWeight + km × 3 s; blocked routes excluded',
    },
  };
}

module.exports = { evaluateRoutes, PROFILES, routeLabel };
