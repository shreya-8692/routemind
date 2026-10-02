const config = require('../config/env');
const TTLCache = require('../utils/cache');
const { fetchJson } = require('../utils/httpClient');
const { ExternalServiceError } = require('../utils/errors');

/**
 * Routing provider abstraction.
 *  - osrm (default): public OSRM demo server, no key. Supports alternatives and
 *    via-waypoints but NOT avoid-areas; RouteMind compensates by generating
 *    detour candidates through via-points (see emergencyRouteAgent).
 *  - openrouteservice: requires ROUTING_API_KEY. Supports avoid_polygons, which
 *    RouteMind uses to route around blocking hazards directly.
 * Neither provider supplies live traffic: durations come from static road-speed profiles.
 */
const routeCache = new TTLCache({ ttlMs: 60 * 1000, maxEntries: 200 });

const providerName = () => (config.routing.provider === 'openrouteservice' && config.routing.apiKey ? 'openrouteservice' : 'osrm');

function describeProvider() {
  const name = providerName();
  return name === 'osrm'
    ? { id: 'osrm', label: 'OSRM (OpenStreetMap data)', supportsAvoidAreas: false, liveTraffic: false }
    : { id: 'openrouteservice', label: 'OpenRouteService (OpenStreetMap data)', supportsAvoidAreas: true, liveTraffic: false };
}

// ---------- OSRM ----------

function osrmInstruction(step) {
  const { type, modifier } = step.maneuver;
  const road = step.name ? ` onto ${step.name}` : '';
  const dir = modifier ? ` ${modifier}` : '';
  switch (type) {
    case 'depart': return `Head${step.name ? ` along ${step.name}` : ' out'}`;
    case 'arrive': return 'Arrive at destination';
    case 'turn': return `Turn${dir}${road}`;
    case 'new name': return `Continue${road}`;
    case 'merge': return `Merge${dir}${road}`;
    case 'on ramp': return `Take the ramp${dir}${road}`;
    case 'off ramp': return `Take the exit${dir}${road}`;
    case 'fork': return `Keep${dir} at the fork${road}`;
    case 'end of road': return `At the end of the road turn${dir}${road}`;
    case 'roundabout':
    case 'rotary': return `At the roundabout take exit ${step.maneuver.exit || ''}${road}`.replace('  ', ' ');
    case 'continue': return `Continue${dir}${road}`;
    default: return `${type.charAt(0).toUpperCase()}${type.slice(1)}${dir}${road}`;
  }
}

function normalizeOsrmRoute(route, index, idPrefix) {
  const steps = route.legs.flatMap((leg) => leg.steps || []).map((s) => ({
    instruction: osrmInstruction(s),
    name: s.name || '',
    distance: s.distance,
    duration: s.duration,
    location: [s.maneuver.location[1], s.maneuver.location[0]],
  }));
  return {
    id: `${idPrefix}-${index}`,
    provider: 'osrm',
    distance: route.distance,
    duration: route.duration,
    geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    summary: route.legs.map((l) => l.summary).filter(Boolean).join(' → '),
    steps,
  };
}

async function osrmRoutes(points, { alternatives, idPrefix }) {
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url = `${config.routing.osrmBaseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&alternatives=${alternatives ? 'true' : 'false'}`;
  let data;
  try {
    data = await fetchJson(url, { service: 'Routing service (OSRM)', timeoutMs: config.routing.timeoutMs });
  } catch (err) {
    const upstreamCode = err.upstreamBody?.code;
    if (upstreamCode === 'NoRoute' || upstreamCode === 'NoSegment') {
      throw new ExternalServiceError('Routing service (OSRM)', 'NO_ROUTE', 'No drivable route was found between these locations.');
    }
    throw err;
  }
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new ExternalServiceError('Routing service (OSRM)', 'NO_ROUTE', 'No drivable route was found between these locations.');
  }
  return data.routes.map((r, i) => normalizeOsrmRoute(r, i, idPrefix));
}

async function osrmTable(origin, destinations) {
  const coords = [origin, ...destinations].map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url = `${config.routing.osrmBaseUrl}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`;
  const data = await fetchJson(url, { service: 'Routing service (OSRM)', timeoutMs: config.routing.timeoutMs });
  if (data.code !== 'Ok') throw new ExternalServiceError('Routing service (OSRM)', 'UPSTREAM_ERROR', 'Travel-time lookup failed.');
  return destinations.map((_, i) => ({
    duration: data.durations?.[0]?.[i + 1] ?? null,
    distance: data.distances?.[0]?.[i + 1] ?? null,
  }));
}

// ---------- OpenRouteService ----------

function orsHeaders() {
  return { Authorization: config.routing.apiKey, 'Content-Type': 'application/json' };
}

async function orsRoutes(points, { alternatives, avoidPolygons, idPrefix }) {
  const body = {
    coordinates: points.map((p) => [p.lng, p.lat]),
    instructions: true,
  };
  if (alternatives && points.length === 2) body.alternative_routes = { target_count: 3, weight_factor: 1.6, share_factor: 0.6 };
  if (avoidPolygons?.length) body.options = { avoid_polygons: { type: 'MultiPolygon', coordinates: avoidPolygons } };

  let data;
  try {
    data = await fetchJson(`${config.routing.orsBaseUrl}/v2/directions/driving-car/geojson`, {
      service: 'Routing service (OpenRouteService)',
      method: 'POST',
      headers: orsHeaders(),
      body: JSON.stringify(body),
      timeoutMs: config.routing.timeoutMs,
    });
  } catch (err) {
    // ORS error code 2009 = route could not be found.
    if (err.upstreamBody?.error?.code === 2009 || err.upstreamBody?.error?.code === 2010) {
      throw new ExternalServiceError('Routing service (OpenRouteService)', 'NO_ROUTE', 'No drivable route was found between these locations.');
    }
    throw err;
  }
  if (!data.features?.length) {
    throw new ExternalServiceError('Routing service (OpenRouteService)', 'NO_ROUTE', 'No drivable route was found between these locations.');
  }
  return data.features.map((f, i) => {
    const geometry = f.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const steps = (f.properties.segments || []).flatMap((seg) => seg.steps || []).map((s) => ({
      instruction: s.instruction,
      name: s.name && s.name !== '-' ? s.name : '',
      distance: s.distance,
      duration: s.duration,
      location: geometry[s.way_points?.[0]] || null,
    }));
    return {
      id: `${idPrefix}-${i}`,
      provider: 'openrouteservice',
      distance: f.properties.summary?.distance ?? 0,
      duration: f.properties.summary?.duration ?? 0,
      geometry,
      summary: '',
      steps,
    };
  });
}

async function orsTable(origin, destinations) {
  const data = await fetchJson(`${config.routing.orsBaseUrl}/v2/matrix/driving-car`, {
    service: 'Routing service (OpenRouteService)',
    method: 'POST',
    headers: orsHeaders(),
    body: JSON.stringify({ locations: [origin, ...destinations].map((p) => [p.lng, p.lat]), sources: [0], metrics: ['distance', 'duration'] }),
    timeoutMs: config.routing.timeoutMs,
  });
  return destinations.map((_, i) => ({
    duration: data.durations?.[0]?.[i + 1] ?? null,
    distance: data.distances?.[0]?.[i + 1] ?? null,
  }));
}

// ---------- Public API ----------

/**
 * Fetch route options from origin to destination.
 * @param {object} opts
 * @param {Array<{lat,lng}>} [opts.via]          intermediate waypoints (disables alternatives)
 * @param {boolean} [opts.alternatives=true]
 * @param {Array} [opts.avoidPolygons]           GeoJSON polygon coordinates (ORS only)
 * @param {string} [opts.idPrefix='route']
 */
async function getRoutes(origin, destination, { via = [], alternatives = true, avoidPolygons, idPrefix = 'route' } = {}) {
  const points = [origin, ...via, destination];
  const useAlternatives = alternatives && via.length === 0;
  const provider = providerName();
  const key = JSON.stringify([provider, points.map((p) => [p.lat.toFixed(5), p.lng.toFixed(5)]), useAlternatives, avoidPolygons || null, idPrefix]);
  const cached = routeCache.get(key);
  if (cached) return cached;

  const routes = provider === 'openrouteservice'
    ? await orsRoutes(points, { alternatives: useAlternatives, avoidPolygons, idPrefix })
    : await osrmRoutes(points, { alternatives: useAlternatives, idPrefix });
  routeCache.set(key, routes);
  return routes;
}

/** Road distance/duration from origin to each destination (one request). */
async function getTravelTable(origin, destinations) {
  if (!destinations.length) return [];
  return providerName() === 'openrouteservice' ? orsTable(origin, destinations) : osrmTable(origin, destinations);
}

module.exports = { getRoutes, getTravelTable, describeProvider, supportsAvoidAreas: () => providerName() === 'openrouteservice' };
