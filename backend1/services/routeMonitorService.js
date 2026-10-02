const hazardService = require('./hazardService');
const { nearestOnPolyline, remainingPolyline, haversine, boundingBox } = require('../utils/geo');
const { formatDistance, formatDuration } = require('../utils/format');

const ARRIVAL_RADIUS_M = 40;
const MAX_OFF_ROUTE_THRESHOLD_M = 300;

/**
 * One monitoring check for an active trip. Stateless: the client sends the route
 * it is following and its current position. Positions are not stored.
 *
 * @returns {object} status: 'arrived' | 'off-route' | 'reroute-recommended' | 'on-route'
 */
async function checkProgress({ route, destination, position, accuracy, offRouteThreshold = 60, knownHazardIds = [], includeSimulated = false }) {
  const near = nearestOnPolyline(position, route.geometry);
  const total = near.totalMeters || route.distance || 0;
  const remainingDistance = Math.max(0, total - near.alongMeters);
  const ratio = total > 0 ? remainingDistance / total : 0;
  // Proportional estimate from the routing engine's duration (no live traffic).
  const remainingDuration = Math.round((route.duration || 0) * ratio);
  const distanceToDestination = destination ? haversine(position, destination) : remainingDistance;

  // Poor GPS fixes widen the threshold so jitter is not reported as leaving the route.
  const lowAccuracy = typeof accuracy === 'number' && accuracy > 100;
  const threshold = Math.min(MAX_OFF_ROUTE_THRESHOLD_M, Math.max(offRouteThreshold, typeof accuracy === 'number' ? accuracy : 0));
  const offRoute = near.distance > threshold;

  const result = {
    checkedAt: new Date().toISOString(),
    distanceFromRoute: Math.round(near.distance),
    offRouteThreshold: Math.round(threshold),
    offRoute,
    lowAccuracy,
    remainingDistance: Math.round(remainingDistance),
    remainingDistanceText: formatDistance(remainingDistance),
    remainingDuration,
    remainingDurationText: formatDuration(remainingDuration),
    etaBasis: 'Proportional to the routing engine estimate (no live traffic).',
    progress: total > 0 ? Math.round((near.alongMeters / total) * 100) : 0,
    distanceToDestination: Math.round(distanceToDestination),
    hazardsAhead: [],
    newHazards: [],
    hazardDataAvailable: true,
    messages: [],
  };

  if (distanceToDestination <= ARRIVAL_RADIUS_M || (remainingDistance <= ARRIVAL_RADIUS_M && !offRoute)) {
    result.status = 'arrived';
    result.messages.push('You have arrived at the destination.');
    return result;
  }

  // Hazards on the part of the route still ahead.
  const ahead = remainingPolyline(position, route.geometry);
  if (ahead.length >= 2) {
    const hazardData = await hazardService.getActiveHazards({ bbox: boundingBox([ahead], 600), includeSimulated });
    result.hazardDataAvailable = hazardData.available;
    if (!hazardData.available) result.messages.push(hazardData.note);
    const impacts = hazardService.findHazardsOnRoutes([{ id: 'ahead', geometry: ahead }], hazardData.hazards).ahead;
    const known = new Set(knownHazardIds.map(String));
    result.hazardsAhead = impacts.map((i) => ({
      id: i.hazard.id,
      type: i.hazard.type,
      severity: i.hazard.severity,
      title: i.hazard.title,
      isSimulated: Boolean(i.hazard.isSimulated),
      blocking: i.blocking,
      estimatedDelaySeconds: i.delaySeconds,
      metersAhead: i.alongMeters,
      latitude: i.hazard.latitude,
      longitude: i.hazard.longitude,
    }));
    result.newHazards = result.hazardsAhead.filter((h) => !known.has(String(h.id)));
  }

  const blockingAhead = result.hazardsAhead.filter((h) => h.blocking);
  if (offRoute) {
    result.status = 'off-route';
    result.messages.push('You appear to have left the planned route.');
  } else if (blockingAhead.length) {
    result.status = 'reroute-recommended';
    const h = blockingAhead[0];
    result.rerouteReason = `${h.isSimulated ? '[SIMULATED] ' : ''}${h.type} (${h.severity}) reported ${formatDistance(h.metersAhead)} ahead on your route.`;
    result.messages.push('A road condition affecting your current route has been detected.');
  } else {
    result.status = 'on-route';
  }
  if (lowAccuracy) result.messages.push(`GPS accuracy is low (±${Math.round(accuracy)} m); off-route detection is less reliable.`);
  return result;
}

module.exports = { checkProgress, ARRIVAL_RADIUS_M };
