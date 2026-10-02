const { rateLimit } = require('express-rate-limit');

/**
 * Removes keys that start with "$" or contain "." from request bodies and
 * route params (MongoDB operator injection). Express 5 makes req.query
 * read-only, so query values are validated individually in controllers and
 * Mongoose's sanitizeFilter is enabled globally as a second layer.
 */
function stripDangerousKeys(value, depth = 0) {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripDangerousKeys(item, depth + 1));
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      delete value[key];
    } else {
      value[key] = stripDangerousKeys(value[key], depth + 1);
    }
  }
  return value;
}

function mongoSanitize(req, _res, next) {
  if (req.body) stripDangerousKeys(req.body);
  if (req.params) stripDangerousKeys(req.params);
  next();
}

const limiterResponse = (message) => ({
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message } }),
});

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, ...limiterResponse('Too many requests. Please wait a moment.') });
// Routing and facility calls fan out to public APIs with strict usage policies.
const routingLimiter = rateLimit({ windowMs: 60 * 1000, limit: 40, ...limiterResponse('Too many route requests. Please wait a moment and try again.') });
const geoLimiter = rateLimit({ windowMs: 60 * 1000, limit: 40, ...limiterResponse('Too many location lookups. Please wait a moment.') });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 6, ...limiterResponse('AI review limit reached. Please wait a minute.') });
// Monitoring polls every few seconds during navigation.
const monitorLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, ...limiterResponse('Monitoring requests are too frequent.') });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, ...limiterResponse('Too many changes. Please wait a moment.') });

module.exports = { mongoSanitize, generalLimiter, routingLimiter, geoLimiter, aiLimiter, monitorLimiter, writeLimiter };
