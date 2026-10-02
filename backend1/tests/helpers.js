const { destinationPoint } = require('../utils/geo');

/** Straight east-bound test polyline of `meters` length starting at `start`, one vertex every 100 m. */
function straightLine(start, meters, bearingDeg = 90) {
  const coords = [];
  for (let d = 0; d <= meters; d += 100) {
    const p = destinationPoint(start, bearingDeg, d);
    coords.push([p.lat, p.lng]);
  }
  return coords;
}

function route(id, { distance = 5000, duration = 600, geometry, label } = {}) {
  return { id, label, distance, duration, geometry: geometry || straightLine({ lat: 10, lng: 10 }, distance), summary: '', steps: [] };
}

function hazard(overrides = {}) {
  return {
    id: overrides.id || 'h1',
    type: 'Road Block',
    severity: 'High',
    title: 'Test hazard',
    latitude: 10,
    longitude: 10,
    radiusMeters: 100,
    isSimulated: false,
    ...overrides,
  };
}

const NO_TRAFFIC = {
  liveTrafficAvailable: false,
  note: 'Live traffic data is unavailable. Route recommendation is based on available map and route information.',
};

module.exports = { straightLine, route, hazard, NO_TRAFFIC };
