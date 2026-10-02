/**
 * Traffic information.
 *
 * Limitation: no free, key-less live traffic API exists for global use, and the
 * routing providers RouteMind uses (OSRM / OpenRouteService) return durations
 * from static road-speed profiles. RouteMind therefore NEVER claims live traffic.
 * The only congestion information available is "Traffic Congestion" hazards
 * reported by users (or created in Simulation Mode), which this service surfaces.
 *
 * A commercial traffic provider (TomTom, HERE, Google) can be plugged in here later.
 */
const LIVE_TRAFFIC_UNAVAILABLE =
  'Live traffic data is unavailable. Route recommendation is based on available map and route information.';

function getTrafficInformation(routes, hazardImpacts) {
  const congestion = {};
  for (const route of routes) {
    congestion[route.id] = (hazardImpacts[route.id] || [])
      .filter((impact) => impact.hazard.type === 'Traffic Congestion')
      .map((impact) => ({
        hazardId: impact.hazard.id,
        severity: impact.hazard.severity,
        title: impact.hazard.title,
        simulated: impact.hazard.isSimulated,
      }));
  }
  return {
    liveTrafficAvailable: false,
    provider: null,
    note: LIVE_TRAFFIC_UNAVAILABLE,
    durationBasis: 'Static road-speed profile of the routing engine (no live traffic).',
    reportedCongestion: congestion,
  };
}

module.exports = { getTrafficInformation, LIVE_TRAFFIC_UNAVAILABLE };
