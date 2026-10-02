const EmergencyRequest = require('../models/EmergencyRequest');
const { isDbConnected } = require('../config/db');
const config = require('../config/env');
const facilityService = require('../services/facilityService');
const v = require('../utils/validate');
const { EMERGENCY_TYPES, FACILITY_TYPES, REQUEST_STATUSES } = require('../utils/constants');
const { NotFoundError, ValidationError, DatabaseUnavailableError } = require('../utils/errors');

function ensureDb() {
  if (!isDbConnected()) throw new DatabaseUnavailableError();
}

function requireObjectId(id) {
  if (!/^[a-f\d]{24}$/i.test(id)) throw new ValidationError('Invalid id.');
  return id;
}

async function getFacilities(req, res) {
  const center = v.parseLatLngQuery(req.query);
  const emergencyType = v.oneOf(req.query.type, EMERGENCY_TYPES, 'type', { required: false, fallback: 'medical' });
  let categories;
  if (req.query.categories) {
    categories = String(req.query.categories).split(',').map((c) => c.trim());
    categories.forEach((c) => v.oneOf(c, FACILITY_TYPES, 'categories'));
  }
  const radius = v.number(req.query.radius, 'radius', { min: 500, max: 25000 }) ?? 5000;
  const result = await facilityService.searchFacilities({ center, emergencyType, categories, radius });
  res.json(result);
}

async function createRequest(req, res) {
  ensureDb();
  const body = req.body || {};
  const origin = v.parsePoint(body.origin, 'origin', { required: false });
  const destination = v.parsePoint(body.destination, 'destination', { required: false });
  const doc = await EmergencyRequest.create({
    emergencyType: v.oneOf(body.emergencyType, EMERGENCY_TYPES, 'emergencyType'),
    origin: origin ? { latitude: origin.lat, longitude: origin.lng, address: origin.address } : undefined,
    destination: destination ? { latitude: destination.lat, longitude: destination.lng, address: destination.address, name: destination.name } : undefined,
    status: 'Active',
    simulation: v.bool(body.simulation),
  });
  res.status(201).json(doc.toJSON());
}

async function getRequest(req, res) {
  ensureDb();
  const doc = await EmergencyRequest.findById(requireObjectId(req.params.id)).populate('routeSession', 'selectedRoute events aiReview provider updatedAt');
  if (!doc) throw new NotFoundError('Emergency request not found.');
  res.json(doc.toJSON());
}

async function updateRequest(req, res) {
  ensureDb();
  const body = req.body || {};
  const doc = await EmergencyRequest.findById(requireObjectId(req.params.id));
  if (!doc) throw new NotFoundError('Emergency request not found.');
  if (body.status !== undefined) {
    doc.status = v.oneOf(body.status, REQUEST_STATUSES, 'status');
    if (doc.status === 'Completed') doc.completedAt = new Date();
  }
  if (body.route && typeof body.route === 'object') {
    // User picked a different candidate route.
    doc.route = {
      label: v.string(body.route.label, 'route.label', { max: 60 }),
      provider: v.string(body.route.provider, 'route.provider', { max: 40 }),
      summary: v.string(body.route.summary, 'route.summary', { max: 300 }),
      riskLevel: v.string(body.route.riskLevel, 'route.riskLevel', { max: 20 }),
    };
    doc.estimatedTime = v.number(body.estimatedTime, 'estimatedTime', { min: 0 }) ?? doc.estimatedTime;
    doc.distance = v.number(body.distance, 'distance', { min: 0 }) ?? doc.distance;
  }
  await doc.save();
  res.json(doc.toJSON());
}

async function deleteRequest(req, res) {
  ensureDb();
  const doc = await EmergencyRequest.findByIdAndDelete(requireObjectId(req.params.id));
  if (!doc) throw new NotFoundError('Emergency request not found.');
  res.json({ id: req.params.id, deleted: true });
}

async function getHistory(req, res) {
  ensureDb();
  const limit = v.number(req.query.limit, 'limit', { min: 1, max: 200 }) ?? 50;
  const docs = await EmergencyRequest.find({}).sort({ createdAt: -1 }).limit(limit);
  res.json({
    requests: docs.map((d) => d.toJSON()),
    retention: {
      historyDays: config.retention.historyDays,
      routeSessionDays: config.retention.routeSessionDays,
      note: `Emergency history (rounded origin/destination coordinates, addresses, route summary) is deleted automatically after ${config.retention.historyDays} days. Live GPS positions are never stored.`,
    },
  });
}

module.exports = { getFacilities, createRequest, getRequest, updateRequest, deleteRequest, getHistory };
