const config = require('../config/env');
const { ExternalServiceError } = require('./errors');

/**
 * fetch() wrapper that applies a timeout, identifies RouteMind to the upstream
 * service and converts failures into ExternalServiceError with a stable code.
 */
async function fetchJson(url, { service, method = 'GET', headers = {}, body, timeoutMs = 10000, signal } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      body,
      headers: { 'User-Agent': config.userAgent, Accept: 'application/json', ...headers },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new ExternalServiceError(service, 'TIMEOUT', `${service} did not respond in time.`);
    }
    throw new ExternalServiceError(service, 'NETWORK', `Unable to reach ${service}. Please check the internet connection.`);
  }

  if (response.status === 429) {
    throw new ExternalServiceError(service, 'RATE_LIMITED', `${service} rate limit reached. Please wait a moment and try again.`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new ExternalServiceError(service, 'UPSTREAM_ERROR', `${service} returned an unreadable response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const err = new ExternalServiceError(service, 'UPSTREAM_ERROR', `${service} request failed (HTTP ${response.status}).`);
    err.upstreamStatus = response.status;
    err.upstreamBody = data;
    throw err;
  }
  return data;
}

/** Serialises calls so that at most one request starts every `intervalMs` (Nominatim: 1 req/s). */
function createThrottle(intervalMs) {
  let last = 0;
  let chain = Promise.resolve();
  return function throttle(fn) {
    const run = chain.then(async () => {
      const wait = last + intervalMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      last = Date.now();
    });
    chain = run.catch(() => {});
    return run.then(fn);
  };
}

module.exports = { fetchJson, createThrottle };
