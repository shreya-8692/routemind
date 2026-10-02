const hazardService = require('../services/hazardService');
const v = require('../utils/validate');
const { HAZARD_TYPES, HAZARD_SEVERITIES, HAZARD_STATUSES } = require('../utils/constants');
const { ValidationError } = require('../utils/errors');

function requireObjectId(id) {
  if (!/^[a-f\d]{24}$/i.test(id)) throw new ValidationError('Invalid hazard id.');
  return id;
}

function parseExpiry(body) {
  if (body.expiresAt === null) return null;
  if (body.expiresAt !== undefined) {
    const d = new Date(body.expiresAt);
    if (Number.isNaN(d.getTime())) throw new ValidationError('expiresAt must be a valid date.');
    return d;
  }
  const hours = v.number(body.durationHours, 'durationHours', { min: 0.1, max: 168 });
  return hours !== undefined ? new Date(Date.now() + hours * 3600 * 1000) : undefined;
}

function parseHazard(body, { partial = false } = {}) {
  const required = !partial;
  const data = {
    type: v.oneOf(body.type, HAZARD_TYPES, 'type', { required }),
    title: v.string(body.title, 'title', { required, max: 120 }),
    description: v.string(body.description, 'description', { max: 1000 }),
    severity: v.oneOf(body.severity, HAZARD_SEVERITIES, 'severity', { required: false }),
    status: v.oneOf(body.status, HAZARD_STATUSES, 'status', { required: false }),
    radiusMeters: v.number(body.radiusMeters, 'radiusMeters', { min: 10, max: 2000 }),
    expiresAt: parseExpiry(body),
  };
  if (!partial || body.latitude !== undefined || body.longitude !== undefined) {
    const point = v.parsePoint({ latitude: body.latitude, longitude: body.longitude }, 'latitude/longitude');
    data.latitude = point.lat;
    data.longitude = point.lng;
  }
  if (!partial) {
    data.source = v.oneOf(body.source, ['user-report', 'simulation'], 'source', { required: false, fallback: 'user-report' });
    // Default lifetime: 4 hours, so stale reports stop affecting routes.
    if (data.expiresAt === undefined) data.expiresAt = new Date(Date.now() + 4 * 3600 * 1000);
  }
  return Object.fromEntries(Object.entries(data).filter(([, val]) => val !== undefined));
}

async function list(req, res) {
  const hazards = await hazardService.listHazards({
    includeInactive: v.bool(req.query.includeInactive),
    includeSimulated: v.bool(req.query.includeSimulated, true),
  });
  res.json({ hazards });
}

async function create(req, res) {
  const hazard = await hazardService.createHazard(parseHazard(req.body || {}));
  res.status(201).json(hazard);
}

async function update(req, res) {
  const hazard = await hazardService.updateHazard(requireObjectId(req.params.id), parseHazard(req.body || {}, { partial: true }));
  res.json(hazard);
}

async function remove(req, res) {
  res.json(await hazardService.deleteHazard(requireObjectId(req.params.id)));
}

module.exports = { list, create, update, remove };
