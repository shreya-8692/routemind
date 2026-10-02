const test = require('node:test');
const assert = require('node:assert/strict');
const { checkExplanation } = require('../services/aiGuardrails');
const { evaluateRoutes } = require('../services/emergencyRouteEngine');
const { findHazardsOnRoutes } = require('../services/hazardService');
const { route, hazard, straightLine, NO_TRAFFIC } = require('./helpers');

const lineA = straightLine({ lat: 10, lng: 10 }, 5000);
const lineB = straightLine({ lat: 10.009, lng: 10 }, 5000);
const routes = [
  route('a', { label: 'Route A', distance: 5000, duration: 600, geometry: lineA }),
  route('b', { label: 'Route B', distance: 6400, duration: 700, geometry: lineB }),
];
const evaluation = evaluateRoutes({
  routes,
  hazardImpacts: findHazardsOnRoutes(routes, [hazard({ latitude: lineA[20][0], longitude: lineA[20][1] })]),
  traffic: NO_TRAFFIC,
  weather: { available: true, risk: 'low', reasons: [] },
  emergencyType: 'medical',
});
const ctx = { evaluation, traffic: NO_TRAFFIC, routes, chosenRouteId: 'b' };

test('a grounded explanation passes', () => {
  const r = checkExplanation('Take Route B. Route A is blocked by a reported road block. Route B is about 1.4 km longer and takes about 12 min.', ctx);
  assert.deepEqual(r.violations, []);
  assert.equal(r.passed, true);
});

test('invented live-traffic claims are rejected', () => {
  const r = checkExplanation('Take Route B because traffic is light on it right now and Route A has a road block.', ctx);
  assert.equal(r.passed, false);
  assert.ok(r.violations.some((v) => v.includes('live traffic')));
});

test('non-existent routes are rejected', () => {
  const r = checkExplanation('Route B is good but Route D would be even better for this emergency.', ctx);
  assert.ok(r.violations.some((v) => v.includes('Route D')));
});

test('hazards that were not reported are rejected', () => {
  const r = checkExplanation('Take Route B to avoid the flooding reported on Route A near the junction.', ctx);
  assert.ok(r.violations.some((v) => v.includes('flooding')));
});

test('numbers not present in route data are rejected', () => {
  const r = checkExplanation('Take Route B: it is 9.9 km and takes about 31 min, avoiding the road block.', ctx);
  assert.ok(r.violations.some((v) => v.includes('9.9 km')));
  assert.ok(r.violations.some((v) => v.includes('31 min')));
});
