const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRoutes } = require('../services/emergencyRouteEngine');
const { findHazardsOnRoutes, impactOf } = require('../services/hazardService');
const { route, hazard, straightLine, NO_TRAFFIC } = require('./helpers');

const WEATHER_OK = { available: true, risk: 'low', reasons: [], condition: 'Clear sky' };

// Route A: shorter, passes (10, 10.01). Route B: longer, on a parallel line 1 km north.
const lineA = straightLine({ lat: 10, lng: 10 }, 5000);
const lineB = straightLine({ lat: 10.009, lng: 10 }, 5000);
const routes = () => [
  route('a', { label: 'Route A', distance: 5000, duration: 600, geometry: lineA }),
  route('b', { label: 'Route B', distance: 6400, duration: 700, geometry: lineB }),
];
const onA = { latitude: lineA[20][0], longitude: lineA[20][1] };

function run(hazards, extra = {}) {
  const rs = routes();
  return evaluateRoutes({
    routes: rs,
    hazardImpacts: findHazardsOnRoutes(rs, hazards),
    traffic: NO_TRAFFIC,
    weather: WEATHER_OK,
    emergencyType: 'medical',
    hazardData: { available: true },
    ...extra,
  });
}

test('without hazards the fastest route is recommended', () => {
  const r = run([]);
  assert.equal(r.recommendedRouteId, 'a');
  assert.equal(r.riskLevel, 'Low');
  assert.match(r.reason, /Route A/);
});

test('a road block makes a route non-viable and the alternative is recommended', () => {
  const r = run([hazard({ ...onA, type: 'Road Block', severity: 'Medium' })]);
  assert.equal(r.recommendedRouteId, 'b');
  const a = r.evaluations.find((e) => e.routeId === 'a');
  assert.equal(a.viable, false);
  assert.match(r.reason, /Route B because Route A .* passes Road Block/);
  assert.match(r.reason, /1\.4 km longer/);
});

test('it never just picks the shortest: a delay hazard can flip the decision', () => {
  // Critical congestion adds 900 s to route A (600 s) → 1500 s vs 700 s on route B.
  const r = run([hazard({ ...onA, type: 'Traffic Congestion', severity: 'Critical' })]);
  assert.equal(r.recommendedRouteId, 'b');
});

test('a small delay does not outweigh a much longer route', () => {
  const r = run([hazard({ ...onA, type: 'Construction', severity: 'Low' })]);
  assert.equal(r.recommendedRouteId, 'a');
  assert.ok(r.warnings.some((w) => w.includes('Construction (Low)')));
});

test('all routes blocked → no recommendation, Critical risk, explicit warning', () => {
  const r = run([
    hazard({ id: 'h1', ...onA }),
    hazard({ id: 'h2', latitude: lineB[20][0], longitude: lineB[20][1] }),
  ]);
  assert.equal(r.recommendedRouteId, null);
  assert.equal(r.allRoutesBlocked, true);
  assert.equal(r.riskLevel, 'Critical');
  assert.ok(r.warnings[0].includes('All available routes pass a reported blocking hazard'));
});

test('missing live traffic is always stated, never assumed', () => {
  const r = run([]);
  assert.ok(r.warnings.includes(NO_TRAFFIC.note));
  assert.match(r.reason, /Live traffic data is unavailable/);
  assert.equal(r.decisionFactors.liveTraffic, false);
});

test('simulated hazards are labelled in warnings and reasons', () => {
  const r = run([hazard({ ...onA, type: 'Road Block', isSimulated: true })]);
  assert.match(r.reason, /\[SIMULATED\]/);
});

test('emergency type changes the weighting (fire weighs construction more)', () => {
  const h = [hazard({ ...onA, type: 'Construction', severity: 'High' })];
  const medical = run(h, { emergencyType: 'medical' }).evaluations.find((e) => e.routeId === 'a');
  const fire = run(h, { emergencyType: 'fire' }).evaluations.find((e) => e.routeId === 'a');
  assert.ok(fire.hazardDelaySeconds > medical.hazardDelaySeconds);
});

test('unavailable hazard data and weather are reported as warnings', () => {
  const r = run([], { hazardData: { available: false, note: 'Hazard database unavailable.' }, weather: { available: false, note: 'Weather data unavailable: x' } });
  assert.ok(r.warnings.includes('Hazard database unavailable.'));
  assert.ok(r.warnings.some((w) => w.startsWith('Weather data unavailable')));
});

test('hazard impact rules: road blocks always block, low congestion only delays', () => {
  assert.equal(impactOf({ type: 'Road Block', severity: 'Low' }).blocking, true);
  assert.deepEqual(impactOf({ type: 'Traffic Congestion', severity: 'Low' }), { blocking: false, delaySeconds: 60 });
});

test('hazards outside their radius do not affect a route', () => {
  const far = { latitude: lineA[20][0] + 0.003, longitude: lineA[20][1] }; // ~330 m away
  const impacts = findHazardsOnRoutes(routes(), [hazard({ ...far, radiusMeters: 100 })]);
  assert.equal(impacts.a.length, 0);
});
