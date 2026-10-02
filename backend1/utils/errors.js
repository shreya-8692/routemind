class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details;
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/**
 * Raised when a third-party API (routing, geocoding, Overpass, weather, AI) fails.
 * `code` is one of RATE_LIMITED | TIMEOUT | NETWORK | UPSTREAM_ERROR | NO_ROUTE.
 */
class ExternalServiceError extends AppError {
  constructor(service, code, message) {
    const status = code === 'RATE_LIMITED' ? 429 : code === 'NO_ROUTE' ? 404 : 502;
    super(message, status, code);
    this.name = 'ExternalServiceError';
    this.service = service;
  }
}

class DatabaseUnavailableError extends AppError {
  constructor(message = 'Database is unavailable. History and hazard reports cannot be accessed right now.') {
    super(message, 503, 'DB_UNAVAILABLE');
    this.name = 'DatabaseUnavailableError';
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ExternalServiceError,
  DatabaseUnavailableError,
};
