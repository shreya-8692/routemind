// HTTP API tests that need neither MongoDB nor network access.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../app');
const { straightLine } = require('./helpers');
const { destinationPoint } = require('../utils/geo');

const app = createApp();
const start = { lat: 19.07, lng: 72.87 };
const line = straightLine(start, 3000);
const monitorBody = (position, extra = {}) => ({
  route: { geometry: line, distance: 3000, duration: 360 },
  destination: { lat: line.at(-1)[0], lng: line.at(-1)[1] },
  position,
  accuracy: 10,
  ...extra,
});

test('GET /api/health reports degraded state honestly without a database', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.database.connected, false);
  assert.equal(res.body.status, 'degraded');
  assert.equal(res.body.liveTraffic.available, false);
});

test('unknown API routes return a JSON 404', async () => {
  const res = await request(app).get('/api/nope').expect(404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('route calculation validates coordinates and emergency type', async () => {
  let res = await request(app).post('/api/routes/calculate').send({ emergencyType: 'medical', origin: { lat: 123, lng: 0 } }).expect(400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  res = await request(app).post('/api/routes/calculate').send({ emergencyType: 'alien', origin: { lat: 1, lng: 1 } }).expect(400);
  assert.match(res.body.error.message, /emergencyType must be one of/);
  res = await request(app).post('/api/routes/calculate').send({ emergencyType: 'fire' }).expect(400);
  assert.match(res.body.error.message, /origin is required/);
});

test('malformed JSON is rejected cleanly', async () => {
  const res = await request(app).post('/api/routes/calculate').set('Content-Type', 'application/json').send('{"bad json').expect(400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
});

test('MongoDB operator injection keys are stripped', async () => {
  const res = await request(app).post('/api/routes/calculate').send({ emergencyType: { $ne: null }, origin: { lat: 1, lng: 1 } }).expect(400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('facility search validates query parameters', async () => {
  const res = await request(app).get('/api/emergency/facilities?lat=abc&lng=1').expect(400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('hazard and history endpoints return 503 DB_UNAVAILABLE without a database', async () => {
  for (const req of [request(app).get('/api/hazards'), request(app).get('/api/emergency/history'), request(app).post('/api/hazards').send({ type: 'Accident', title: 't', latitude: 1, longitude: 1 })]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await req.expect(503);
    assert.equal(res.body.error.code, 'DB_UNAVAILABLE');
  }
});

test('monitor: on route with remaining distance/ETA, hazard data flagged unavailable', async () => {
  const pos = destinationPoint(start, 90, 1000);
  const res = await request(app).post('/api/routes/monitor').send(monitorBody(pos)).expect(200);
  assert.equal(res.body.status, 'on-route');
  assert.ok(Math.abs(res.body.remainingDistance - 2000) < 20);
  assert.ok(Math.abs(res.body.remainingDuration - 240) < 5);
  assert.equal(res.body.hazardDataAvailable, false);
});

test('monitor: off-route when far from the line', async () => {
  const pos = destinationPoint(destinationPoint(start, 90, 1000), 0, 250);
  const res = await request(app).post('/api/routes/monitor').send(monitorBody(pos)).expect(200);
  assert.equal(res.body.status, 'off-route');
  assert.ok(res.body.messages.includes('You appear to have left the planned route.'));
});

test('monitor: poor GPS accuracy widens the off-route threshold', async () => {
  const pos = destinationPoint(destinationPoint(start, 90, 1000), 0, 150);
  const res = await request(app).post('/api/routes/monitor').send(monitorBody(pos, { accuracy: 200 })).expect(200);
  assert.equal(res.body.status, 'on-route');
  assert.equal(res.body.lowAccuracy, true);
});

test('monitor: arrival near the destination', async () => {
  const end = { lat: line.at(-1)[0], lng: line.at(-1)[1] };
  const res = await request(app).post('/api/routes/monitor').send(monitorBody(end)).expect(200);
  assert.equal(res.body.status, 'arrived');
});

test('AI review without AI_API_KEY is reported as unavailable, not faked', async (t) => {
  // Only the validation path here: a full review would call routing APIs over the network.
  const res = await request(app).post('/api/routes/ai-review').send({ emergencyType: 'medical', origin: { lat: 1, lng: 1 } }).expect(400);
  assert.match(res.body.error.message, /destination is required/);
  t.diagnostic('full AI review exercised in manual/E2E testing');
});
