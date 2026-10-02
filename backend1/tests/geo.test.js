const test = require('node:test');
const assert = require('node:assert/strict');
const { haversine, nearestOnPolyline, remainingPolyline, destinationPoint, polylineLength } = require('../utils/geo');
const { straightLine } = require('./helpers');

test('haversine: one degree of latitude is ~111 km', () => {
  const d = haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111195) < 100, `got ${d}`);
});

test('destinationPoint travels the requested distance', () => {
  const start = { lat: 19.07, lng: 72.87 };
  const p = destinationPoint(start, 45, 1500);
  assert.ok(Math.abs(haversine(start, p) - 1500) < 1);
});

test('nearestOnPolyline: distance from line and progress along it', () => {
  const line = straightLine({ lat: 10, lng: 10 }, 2000);
  const along = destinationPoint({ lat: 10, lng: 10 }, 90, 700);
  const offset = destinationPoint(along, 0, 50); // 50 m north of the 700 m mark
  const near = nearestOnPolyline(offset, line);
  assert.ok(Math.abs(near.distance - 50) < 2, `distance ${near.distance}`);
  assert.ok(Math.abs(near.alongMeters - 700) < 5, `along ${near.alongMeters}`);
  assert.ok(Math.abs(near.totalMeters - polylineLength(line)) < 1);
});

test('remainingPolyline starts at the projected point', () => {
  const line = straightLine({ lat: 10, lng: 10 }, 1000);
  const p = destinationPoint({ lat: 10, lng: 10 }, 90, 400);
  const rest = remainingPolyline(p, line);
  assert.ok(Math.abs(polylineLength(rest) - 600) < 5);
});
