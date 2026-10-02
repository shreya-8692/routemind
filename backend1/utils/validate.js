const { ValidationError } = require('./errors');
const { isValidCoordinate } = require('./geo');

/** Parses a { latitude, longitude } or { lat, lng } object into { lat, lng }. */
function parsePoint(value, field, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`${field} is required.`);
    return null;
  }
  if (typeof value !== 'object') throw new ValidationError(`${field} must be an object with latitude and longitude.`);
  const lat = Number(value.latitude ?? value.lat);
  const lng = Number(value.longitude ?? value.lng);
  if (!isValidCoordinate(lat, lng)) {
    throw new ValidationError(`${field} must contain a valid latitude (-90..90) and longitude (-180..180).`);
  }
  const point = { lat, lng };
  if (typeof value.address === 'string') point.address = value.address.trim().slice(0, 300);
  if (typeof value.name === 'string') point.name = value.name.trim().slice(0, 200);
  return point;
}

function parseLatLngQuery(query, prefix = '') {
  const lat = Number(query[`${prefix}lat`]);
  const lng = Number(query[`${prefix}lng`]);
  if (!isValidCoordinate(lat, lng)) {
    throw new ValidationError(`Query parameters ${prefix}lat and ${prefix}lng must be valid coordinates.`);
  }
  return { lat, lng };
}

function oneOf(value, allowed, field, { required = true, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required. Allowed: ${allowed.join(', ')}.`);
    return fallback;
  }
  if (!allowed.includes(value)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}.`);
  return value;
}

function string(value, field, { required = false, max = 500 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ValidationError(`${field} is required.`);
  if (trimmed.length > max) throw new ValidationError(`${field} must be at most ${max} characters.`);
  return trimmed;
}

function number(value, field, { min = -Infinity, max = Infinity, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required.`);
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${field} must be a number between ${min} and ${max}.`);
  return n;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === '1' || value === 1;
}

/** Validates a client-supplied route geometry: array of [lat, lng] pairs. */
function parsePolyline(value, field, { maxPoints = 20000 } = {}) {
  if (!Array.isArray(value) || value.length < 2) throw new ValidationError(`${field} must be an array of at least two [lat, lng] pairs.`);
  if (value.length > maxPoints) throw new ValidationError(`${field} has too many points (max ${maxPoints}).`);
  return value.map((pair, i) => {
    if (!Array.isArray(pair) || pair.length < 2 || !isValidCoordinate(Number(pair[0]), Number(pair[1]))) {
      throw new ValidationError(`${field}[${i}] is not a valid [lat, lng] pair.`);
    }
    return [Number(pair[0]), Number(pair[1])];
  });
}

module.exports = { parsePoint, parseLatLngQuery, oneOf, string, number, bool, parsePolyline };
