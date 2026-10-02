const test = require('node:test');
const assert = require('node:assert/strict');
const { withFallback } = require('../services/facilityService');

const after = (ms, value, fail = false) => new Promise((resolve, reject) => setTimeout(() => (fail ? reject(new Error(value)) : resolve(value)), ms));

test('fast primary wins and the fallback never starts', async () => {
  let started = false;
  const v = await withFallback(after(10, 'primary'), () => { started = true; return after(10, 'fallback'); }, 100);
  assert.equal(v, 'primary');
  assert.equal(started, false);
});

test('slow primary → fallback result is used', async () => {
  const v = await withFallback(after(500, 'primary'), () => after(10, 'fallback'), 50);
  assert.equal(v, 'fallback');
});

test('failed primary starts the fallback immediately', async () => {
  const t = Date.now();
  const v = await withFallback(after(10, 'down', true), () => after(10, 'fallback'), 5000);
  assert.equal(v, 'fallback');
  assert.ok(Date.now() - t < 1000);
});

test('fallback failure still lets a late primary succeed', async () => {
  const v = await withFallback(after(150, 'primary'), () => after(10, 'nominatim down', true), 20);
  assert.equal(v, 'primary');
});

test('both failing rejects with the primary error', async () => {
  await assert.rejects(withFallback(after(30, 'overpass down', true), () => after(10, 'nominatim down', true), 5), /overpass down/);
});
