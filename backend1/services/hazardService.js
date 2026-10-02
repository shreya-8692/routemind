const mongoose = require('mongoose');
const Hazard = require('../models/Hazard');
const { isDbConnected } = require('../config/db');
const { NotFoundError, DatabaseUnavailableError } = require('../utils/errors');
const { nearestOnPolyline, boundingBox } = require('../utils/geo');

/**
 * Hazard impact model. Values are transparent heuristics, not measured data:
 *  - 'block'  → the road is treated as impassable; routes through it are not viable.
 *  - number   → estimated extra delay in seconds when a route passes the hazard.
 */
const IMPACT_RULES = {
  'Road Block':         { Low: 'block', Medium: 'block', High: 'block', Critical: 'block' },
  Accident:             { Low: 120, Medium: 300, High: 600, Critical: 'block' },
  Flooding:             { Low: 120, Medium: 300, High: 'block', Critical: 'block' },
  Construction:         { Low: 60, Medium: 180, High: 420, Critical: 'block' },
  Fire:                 { Low: 120, Medium: 300, High: 'block', Critical: 'block' },
  'Traffic Congestion': { Low: 60, Medium: 180, High: 420, Critical: 900 },
  Other:                { Low: 60, Medium: 120, High: 300, Critical: 'block' },
};

function impactOf(hazard) {
  const rule = IMPACT_RULES[hazard.type]?.[hazard.severity] ?? 120;
  return rule === 'block' ? { blocking: true, delaySeconds: 0 } : { blocking: false, delaySeconds: rule };
}

// Mongoose's global sanitizeFilter wraps $-operators found in filters; operators built
// here from server-side values are explicitly marked as trusted.
const { trusted } = mongoose;

function activeFilter(now = new Date()) {
  return { status: 'active', $or: [{ expiresAt: null }, { expiresAt: trusted({ $gt: now }) }] };
}

function ensureDb() {
  if (!isDbConnected()) throw new DatabaseUnavailableError();
}

function plain(doc) {
  return doc.toJSON ? doc.toJSON() : doc;
}

/**
 * Active (non-expired, non-resolved) hazards, optionally within a bounding box.
 * Never throws: when the database is down it reports { available: false } so
 * that routing can continue with a clear warning.
 */
async function getActiveHazards({ bbox, includeSimulated = false } = {}) {
  if (!isDbConnected()) {
    return { available: false, hazards: [], note: 'Hazard database unavailable — reported hazards could not be checked.' };
  }
  const filter = { ...activeFilter() };
  if (!includeSimulated) filter.isSimulated = false;
  if (bbox) {
    filter.latitude = trusted({ $gte: bbox.minLat, $lte: bbox.maxLat });
    filter.longitude = trusted({ $gte: bbox.minLng, $lte: bbox.maxLng });
  }
  const docs = await Hazard.find(filter).limit(500);
  return { available: true, hazards: docs.map(plain) };
}

async function listHazards({ includeInactive = false, includeSimulated = true, limit = 200 } = {}) {
  ensureDb();
  const filter = includeInactive ? {} : { ...activeFilter() };
  if (!includeSimulated) filter.isSimulated = false;
  const docs = await Hazard.find(filter).sort({ createdAt: -1 }).limit(limit);
  return docs.map(plain);
}

async function createHazard(data) {
  ensureDb();
  const doc = await Hazard.create(data);
  return plain(doc);
}

async function updateHazard(id, data) {
  ensureDb();
  const doc = await Hazard.findById(id);
  if (!doc) throw new NotFoundError('Hazard not found.');
  Object.assign(doc, data);
  await doc.save();
  return plain(doc);
}

async function deleteHazard(id) {
  ensureDb();
  const doc = await Hazard.findByIdAndDelete(id);
  if (!doc) throw new NotFoundError('Hazard not found.');
  return { id };
}

/**
 * For each route, the hazards lying within their impact radius of the route line.
 * Returns { [routeId]: [{ hazard, distanceFromRoute, alongMeters, blocking, delaySeconds }] }.
 */
function findHazardsOnRoutes(routes, hazards) {
  const impacts = {};
  for (const route of routes) {
    impacts[route.id] = [];
    for (const hazard of hazards) {
      const near = nearestOnPolyline({ lat: hazard.latitude, lng: hazard.longitude }, route.geometry);
      if (!near) continue;
      const radius = hazard.radiusMeters || 100;
      if (near.distance <= radius) {
        impacts[route.id].push({
          hazard,
          distanceFromRoute: Math.round(near.distance),
          alongMeters: Math.round(near.alongMeters),
          ...impactOf(hazard),
        });
      }
    }
    impacts[route.id].sort((a, b) => a.alongMeters - b.alongMeters);
  }
  return impacts;
}

function bboxForRoutes(routes, padMeters = 500) {
  return boundingBox(routes.map((r) => r.geometry), padMeters);
}

module.exports = {
  IMPACT_RULES,
  impactOf,
  getActiveHazards,
  listHazards,
  createHazard,
  updateHazard,
  deleteHazard,
  findHazardsOnRoutes,
  bboxForRoutes,
};
