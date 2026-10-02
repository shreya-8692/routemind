const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No API route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: Object.values(err.errors).map((e) => e.message).join(' ') },
    });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Invalid value for ${err.path}.` } });
  }
  if (err.name === 'MongoServerSelectionError' || err.name === 'MongoNetworkError' || /buffering timed out/.test(err.message || '')) {
    return res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'Database is unavailable. Please try again shortly.' } });
  }
  if (err instanceof AppError) {
    if (err.statusCode >= 500) logger.warn(`${req.method} ${req.path} → ${err.code}: ${err.message}`);
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, ...(err.service ? { service: err.service } : {}), ...(err.details ? { details: err.details } : {}) },
    });
  }
  // Unexpected error: log the stack, never leak internals to the client.
  logger.error(`${req.method} ${req.path} unhandled:`, err.stack || err.message);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
}

module.exports = { notFound, errorHandler };
