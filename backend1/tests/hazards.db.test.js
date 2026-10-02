// Hazard persistence against a real MongoDB test database. Skipped when MongoDB is not reachable.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');

const TEST_URI = process.env.MONGO_TEST_URI || 'mongodb://127.0.0.1:27017/routemind_test';

let available = false;
test.before(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2000 });
    await mongoose.connection.db.dropDatabase();
    available = true;
  } catch {
    available = false;
  }
});

test.after(async () => {
  if (available) await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

test('hazard CRUD, expiry and simulation filtering', async (t) => {
  if (!available) return t.skip(`MongoDB not reachable at ${TEST_URI}`);
  const createApp = require('../app');
  const hazardService = require('../services/hazardService');
  const app = createApp();

  const base = { latitude: 19.07, longitude: 72.87, severity: 'High' };
  const real = await request(app).post('/api/hazards').send({ ...base, type: 'Road Block', title: 'Reported closure' }).expect(201);
  assert.equal(real.body.source, 'user-report');
  assert.equal(real.body.isSimulated, false);
  assert.equal(real.body.radiusMeters, 150); // default for High
  assert.ok(new Date(real.body.expiresAt) > new Date()); // default 4 h lifetime

  const sim = await request(app).post('/api/hazards').send({ ...base, type: 'Flooding', title: 'Sim flood', source: 'simulation' }).expect(201);
  assert.equal(sim.body.isSimulated, true);

  const expired = await request(app)
    .post('/api/hazards')
    .send({ ...base, type: 'Accident', title: 'Old accident', expiresAt: new Date(Date.now() - 60000).toISOString() })
    .expect(201);
  assert.equal(expired.body.isActive, false);

  // Routing only sees active, non-expired, non-simulated hazards unless simulation is requested.
  let active = await hazardService.getActiveHazards({});
  assert.deepEqual(active.hazards.map((h) => h.title), ['Reported closure']);
  active = await hazardService.getActiveHazards({ includeSimulated: true });
  assert.deepEqual(active.hazards.map((h) => h.title).sort(), ['Reported closure', 'Sim flood']);

  // Resolving removes it from routing.
  await request(app).put(`/api/hazards/${real.body.id}`).send({ status: 'resolved' }).expect(200);
  active = await hazardService.getActiveHazards({});
  assert.equal(active.hazards.length, 0);

  // Validation.
  const bad = await request(app).post('/api/hazards').send({ ...base, type: 'Meteor', title: 'x' }).expect(400);
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
  await request(app).put('/api/hazards/not-an-id').send({ status: 'resolved' }).expect(400);

  await request(app).delete(`/api/hazards/${sim.body.id}`).expect(200);
  await request(app).delete(`/api/hazards/${sim.body.id}`).expect(404);
});

test('emergency request lifecycle', async (t) => {
  if (!available) return t.skip(`MongoDB not reachable at ${TEST_URI}`);
  const app = require('../app')();
  const created = await request(app)
    .post('/api/emergency/request')
    .send({ emergencyType: 'medical', origin: { latitude: 19.07, longitude: 72.87, address: 'Test' } })
    .expect(201);
  assert.equal(created.body.status, 'Active');
  const updated = await request(app).patch(`/api/emergency/${created.body.id}`).send({ status: 'Completed' }).expect(200);
  assert.equal(updated.body.status, 'Completed');
  assert.ok(updated.body.completedAt);
  const history = await request(app).get('/api/emergency/history').expect(200);
  assert.equal(history.body.requests.length, 1);
  assert.match(history.body.retention.note, /never stored/);
  await request(app).patch(`/api/emergency/${created.body.id}`).send({ status: 'Flying' }).expect(400);
});
