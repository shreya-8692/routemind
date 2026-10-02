// All requests go to the RouteMind backend. No third-party API keys exist in the frontend:
// the backend talks to routing, geocoding, facility and AI providers.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, { code = 'UNKNOWN', status = 0, service } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.service = service;
  }
}

const NETWORK_MESSAGE = 'Unable to reach the RouteMind server. Please check your internet connection.';

export async function request(path, { method = 'GET', body, query, timeoutMs = 30000, signal } = {}) {
  let url = `${BASE_URL}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (signal?.aborted) throw new ApiError('Request cancelled.', { code: 'ABORTED' });
    if (err.name === 'TimeoutError' || timeout.aborted) {
      throw new ApiError('The server took too long to respond. Please try again.', { code: 'TIMEOUT' });
    }
    throw new ApiError(NETWORK_MESSAGE, { code: 'NETWORK' });
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON body: usually the dev proxy reporting that the backend is down.
  }

  if (!response.ok) {
    if (data?.error) {
      throw new ApiError(data.error.message, { code: data.error.code, status: response.status, service: data.error.service });
    }
    if (response.status === 429) throw new ApiError('Too many requests. Please wait a moment and try again.', { code: 'RATE_LIMITED', status: 429 });
    if (response.status >= 500) throw new ApiError('The RouteMind server is not responding. Is the backend running?', { code: 'SERVER_UNAVAILABLE', status: response.status });
    throw new ApiError(`Request failed (HTTP ${response.status}).`, { status: response.status });
  }
  if (data === null) throw new ApiError('The server returned an unreadable response.', { code: 'BAD_RESPONSE', status: response.status });
  return data;
}
