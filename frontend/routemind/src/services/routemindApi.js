import { request } from './api';

const point = (p) => (p ? { lat: p.lat, lng: p.lng, ...(p.address ? { address: p.address } : {}), ...(p.name ? { name: p.name } : {}) } : undefined);

export const getHealth = () => request('/health', { timeoutMs: 8000 });

// ----- Emergency requests & facilities -----

export const getFacilities = ({ lat, lng, type, radius }, opts) =>
  request('/emergency/facilities', { query: { lat, lng, type, radius }, timeoutMs: 45000, ...opts });

export const getEmergencyRequest = (id) => request(`/emergency/${id}`);
export const updateEmergencyRequest = (id, body) => request(`/emergency/${id}`, { method: 'PATCH', body });
export const deleteEmergencyRequest = (id) => request(`/emergency/${id}`, { method: 'DELETE' });
export const getHistory = (limit = 50) => request('/emergency/history', { query: { limit } });

// ----- Routing (Emergency Route Agent) -----

function planBody({ emergencyType, origin, destination, includeSimulated, emergencyRequestId }) {
  return {
    emergencyType,
    origin: point(origin),
    destination: point(destination),
    includeSimulated: Boolean(includeSimulated),
    ...(emergencyRequestId ? { emergencyRequestId } : {}),
  };
}

export const calculateRoute = (input) =>
  request('/routes/calculate', { method: 'POST', body: planBody(input), timeoutMs: 60000 });

export const recalculateRoute = (input) =>
  request('/routes/recalculate', { method: 'POST', body: { ...planBody(input), reason: input.reason }, timeoutMs: 60000 });

export const monitorRoute = ({ route, destination, position, accuracy, offRouteThreshold, knownHazardIds, includeSimulated, sessionId }) =>
  request('/routes/monitor', {
    method: 'POST',
    timeoutMs: 20000,
    body: {
      route: { geometry: route.geometry, distance: route.distance, duration: route.duration },
      destination: point(destination),
      position: { lat: position.lat, lng: position.lng },
      ...(Number.isFinite(accuracy) ? { accuracy } : {}),
      offRouteThreshold,
      knownHazardIds,
      includeSimulated: Boolean(includeSimulated),
      ...(sessionId ? { sessionId } : {}),
    },
  });

export const aiReview = (input) =>
  request('/routes/ai-review', {
    method: 'POST',
    body: { ...planBody(input), ...(input.sessionId ? { sessionId: input.sessionId } : {}) },
    timeoutMs: 150000,
  });

// ----- Hazards -----

export const getHazards = ({ includeSimulated = false, includeInactive = false } = {}) =>
  request('/hazards', { query: { includeSimulated, includeInactive } });
export const createHazard = (body) => request('/hazards', { method: 'POST', body });
export const updateHazard = (id, body) => request(`/hazards/${id}`, { method: 'PUT', body });
export const deleteHazard = (id) => request(`/hazards/${id}`, { method: 'DELETE' });

// ----- Geocoding -----

export const reverseGeocode = ({ lat, lng }) => request('/geo/reverse', { query: { lat, lng }, timeoutMs: 15000 });
export const searchPlaces = (q, near) =>
  request('/geo/search', { query: { q, ...(near ? { lat: near.lat, lng: near.lng } : {}) }, timeoutMs: 15000 });
