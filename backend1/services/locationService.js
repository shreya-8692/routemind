const config = require('../config/env');
const TTLCache = require('../utils/cache');
const { fetchJson, createThrottle } = require('../utils/httpClient');

// Nominatim usage policy: max 1 request/second and an identifying User-Agent.
const throttle = createThrottle(1100);
const reverseCache = new TTLCache({ ttlMs: 15 * 60 * 1000 });
const searchCache = new TTLCache({ ttlMs: 10 * 60 * 1000 });

const SERVICE = 'Geocoding service (Nominatim)';

function buildUrl(path, params) {
  const url = new URL(path, config.geocoding.baseUrl.endsWith('/') ? config.geocoding.baseUrl : `${config.geocoding.baseUrl}/`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  if (config.geocoding.apiKey) url.searchParams.set('key', config.geocoding.apiKey); // LocationIQ-compatible providers
  if (config.geocoding.email) url.searchParams.set('email', config.geocoding.email);
  return url.toString();
}

function shortName(address = {}, fallback = '') {
  const parts = [
    address.road || address.pedestrian || address.neighbourhood,
    address.suburb || address.city_district,
    address.city || address.town || address.village || address.county,
  ].filter(Boolean);
  return parts.length ? [...new Set(parts)].join(', ') : fallback.split(',').slice(0, 3).join(',');
}

/** Coordinates -> readable address. Returns null when nothing is found. */
async function reverseGeocode({ lat, lng }) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = reverseCache.get(key);
  if (cached !== undefined) return cached;

  const data = await throttle(() =>
    fetchJson(buildUrl('reverse', { lat, lon: lng, format: 'jsonv2', zoom: 18, addressdetails: 1 }), {
      service: SERVICE,
      timeoutMs: config.geocoding.timeoutMs,
    }),
  );
  const result = data && !data.error
    ? {
        displayName: data.display_name,
        shortName: shortName(data.address, data.display_name),
        city: data.address?.city || data.address?.town || data.address?.village || data.address?.county || null,
        source: 'OpenStreetMap Nominatim',
      }
    : null;
  reverseCache.set(key, result);
  return result;
}

/** Free-text place search, biased (not restricted) to the area around `near`. */
async function searchPlaces(query, near) {
  const key = `${query.toLowerCase()}|${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ''}`;
  const cached = searchCache.get(key);
  if (cached) return cached;

  const params = { q: query, format: 'jsonv2', addressdetails: 1, limit: 8 };
  if (near) {
    const d = 0.25; // ~25 km viewbox for ranking
    params.viewbox = `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`;
  }
  const data = await throttle(() =>
    fetchJson(buildUrl('search', params), { service: SERVICE, timeoutMs: config.geocoding.timeoutMs }),
  );
  const results = (Array.isArray(data) ? data : []).map((item) => ({
    id: `${item.osm_type}-${item.osm_id}`,
    name: item.name || item.display_name.split(',')[0],
    displayName: item.display_name,
    category: item.type,
    lat: Number(item.lat),
    lng: Number(item.lon),
    source: 'OpenStreetMap Nominatim',
  }));
  searchCache.set(key, results);
  return results;
}

/**
 * Raw Nominatim search restricted (bounded) to a box of `radius` metres around
 * `center`. Used as the facility-search fallback when Overpass is unavailable.
 * Nominatim returns at most 40 results ranked by importance, not distance.
 */
async function searchWithinRadius(query, center, radius) {
  const key = `bounded|${query}|${center.lat.toFixed(3)},${center.lng.toFixed(3)}|${radius}`;
  const cached = searchCache.get(key);
  if (cached) return cached;

  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
  const params = {
    q: query,
    format: 'jsonv2',
    addressdetails: 1,
    extratags: 1,
    bounded: 1,
    limit: 40,
    viewbox: `${center.lng - dLng},${center.lat + dLat},${center.lng + dLng},${center.lat - dLat}`,
  };
  const data = await throttle(() =>
    fetchJson(buildUrl('search', params), { service: SERVICE, timeoutMs: config.geocoding.timeoutMs }),
  );
  const results = Array.isArray(data) ? data : [];
  searchCache.set(key, results);
  return results;
}

module.exports = { reverseGeocode, searchPlaces, searchWithinRadius };
