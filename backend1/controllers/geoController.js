const locationService = require('../services/locationService');
const v = require('../utils/validate');

async function reverse(req, res) {
  const point = v.parseLatLngQuery(req.query);
  const result = await locationService.reverseGeocode(point);
  res.json({ result });
}

async function search(req, res) {
  const q = v.string(req.query.q, 'q', { required: true, max: 200 });
  const near = req.query.lat !== undefined ? v.parseLatLngQuery(req.query) : null;
  const results = await locationService.searchPlaces(q, near);
  res.json({ results });
}

module.exports = { reverse, search };
