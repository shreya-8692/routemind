const config = require('../config/env');
const TTLCache = require('../utils/cache');
const logger = require('../utils/logger');
const { fetchJson } = require('../utils/httpClient');
const { ExternalServiceError } = require('../utils/errors');
const { haversine } = require('../utils/geo');
const { FACILITIES_FOR_EMERGENCY } = require('../utils/constants');
const routingService = require('./routingService');
const locationService = require('./locationService');

/**
 * Emergency facility search over real OpenStreetMap data.
 * Primary source: the Overpass API (complete tag-based search).
 * Fallback: Nominatim, started when Overpass has not answered within
 * FALLBACK_AFTER_MS (public Overpass instances are frequently overloaded).
 * Nominatim returns at most 40 results per category ranked by importance, so
 * the fallback can miss facilities; results say which source was used.
 * Nothing here is invented: if OSM has no facility nearby, the result is empty.
 */
// Facilities rarely change; a long cache keeps load off the public Overpass servers.
const cache = new TTLCache({ ttlMs: 30 * 60 * 1000, maxEntries: 300 });
const SERVICE = 'Facility search (Overpass API)';
const FALLBACK_AFTER_MS = 6000;
const SOURCES = {
  overpass: 'OpenStreetMap contributors (ODbL) via Overpass API',
  nominatim: 'OpenStreetMap contributors (ODbL) via Nominatim (fallback — Overpass unavailable; list may be incomplete)',
};

// Free-text terms for the Nominatim fallback; results are filtered by OSM class/type.
const NOMINATIM_TERMS = {
  hospital: 'hospital',
  clinic: 'clinic',
  fire_station: 'fire station',
  police: 'police',
};

const CATEGORY_FILTERS = {
  hospital: ['["amenity"="hospital"]', '["healthcare"="hospital"]'],
  clinic: ['["amenity"="clinic"]', '["healthcare"="clinic"]'],
  fire_station: ['["amenity"="fire_station"]'],
  police: ['["amenity"="police"]'],
};

const CATEGORY_LABELS = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  fire_station: 'Fire Station',
  police: 'Police Station',
};

function categorize(tags) {
  if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') return 'hospital';
  if (tags.amenity === 'clinic' || tags.healthcare === 'clinic') return 'clinic';
  if (tags.amenity === 'fire_station') return 'fire_station';
  if (tags.amenity === 'police') return 'police';
  return null;
}

function formatAddress(tags) {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:suburb'] || tags['addr:neighbourhood'],
    tags['addr:city'],
    tags['addr:postcode'],
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : tags['addr:full'] || null;
}

function buildQuery(categories, center, radius) {
  const around = `(around:${Math.round(radius)},${center.lat.toFixed(6)},${center.lng.toFixed(6)})`;
  const clauses = categories.flatMap((c) => CATEGORY_FILTERS[c] || []).map((f) => `nwr${f}${around};`);
  return `[out:json][timeout:20];(${clauses.join('')});out center tags 80;`;
}

/**
 * Hedged request across Overpass mirrors: start the first mirror, start the next
 * one if no answer arrives within HEDGE_DELAY_MS (or as soon as one fails), use
 * the first success and abort the rest. Public Overpass instances are often
 * overloaded (HTTP 504) or slow, and an emergency search should not wait 30 s.
 */
const HEDGE_DELAY_MS = 4000;

function runOverpass(query) {
  const urls = config.overpass.urls;
  const controllers = urls.map(() => new AbortController());
  return new Promise((resolve, reject) => {
    let started = 0;
    let failed = 0;
    let settled = false;
    let lastError;
    let timer;

    const launch = () => {
      if (settled || started >= urls.length) return;
      const index = started;
      started += 1;
      clearTimeout(timer);
      timer = setTimeout(launch, HEDGE_DELAY_MS);
      fetchJson(urls[index], {
        service: SERVICE,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }).toString(),
        timeoutMs: config.overpass.timeoutMs,
        signal: controllers[index].signal,
      }).then(
        (data) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          controllers.forEach((c, i) => i !== index && c.abort());
          resolve(data);
        },
        (err) => {
          if (settled) return;
          lastError = err;
          failed += 1;
          logger.warn(`Overpass endpoint failed (${new URL(urls[index]).host}): ${err.code}`);
          if (failed === urls.length) {
            settled = true;
            clearTimeout(timer);
            reject(lastError);
          } else {
            launch();
          }
        },
      );
    };
    launch();
  }).catch((err) => {
    throw err instanceof ExternalServiceError ? err : new ExternalServiceError(SERVICE, 'UPSTREAM_ERROR', 'Facility search is unavailable.');
  });
}

/** Nominatim results → Overpass-like elements so both sources share toFacility(). */
function nominatimToElement(item) {
  const a = item.address || {};
  const tags = {
    ...(item.extratags || {}),
    [item.category === 'healthcare' ? 'healthcare' : 'amenity']: item.type,
    'addr:housenumber': a.house_number,
    'addr:street': a.road,
    'addr:suburb': a.suburb || a.neighbourhood,
    'addr:city': a.city || a.town || a.village,
    'addr:postcode': a.postcode,
  };
  if (item.name) tags.name = item.name;
  return { type: item.osm_type, id: item.osm_id, lat: Number(item.lat), lon: Number(item.lon), tags };
}

async function nominatimElements(categories, center, radius) {
  const elements = [];
  let lastError;
  let succeeded = 0;
  for (const category of categories) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const items = await locationService.searchWithinRadius(NOMINATIM_TERMS[category], center, radius);
      succeeded += 1;
      for (const item of items) {
        if ((item.category === 'amenity' || item.category === 'healthcare') && item.type === category) elements.push(nominatimToElement(item));
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (!succeeded) throw lastError;
  return elements;
}

/**
 * Resolves with the primary result, or with the fallback if the primary has not
 * answered within `delayMs` (or failed). Rejects only when both fail.
 */
function withFallback(primary, startFallback, delayMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    let fallbackStarted = false;
    let primaryError = null;
    let fallbackError = null;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const runFallback = () => {
      if (done || fallbackStarted) return;
      fallbackStarted = true;
      startFallback().then(
        (value) => finish(resolve, value),
        (err) => {
          fallbackError = err;
          if (primaryError) finish(reject, primaryError);
        },
      );
    };
    const timer = setTimeout(runFallback, delayMs);
    primary.then(
      (value) => finish(resolve, value),
      (err) => {
        primaryError = err;
        if (fallbackError) finish(reject, err);
        else runFallback();
      },
    );
  });
}

function fetchElements(categories, center, radius) {
  const primary = runOverpass(buildQuery(categories, center, radius)).then((data) => ({ elements: data.elements || [], via: 'overpass' }));
  return withFallback(
    primary,
    () => nominatimElements(categories, center, radius).then((elements) => {
      logger.warn(`Facility search served by Nominatim fallback (${elements.length} results)`);
      return { elements, via: 'nominatim' };
    }),
    FALLBACK_AFTER_MS,
  );
}

function toFacility(el, center) {
  const tags = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const category = categorize(tags);
  if (lat === undefined || lng === undefined || !category) return null;
  const name = tags.name || tags['name:en'] || null;
  return {
    id: `osm-${el.type}-${el.id}`,
    osmType: el.type,
    osmId: el.id,
    name,
    displayName: name || `Unnamed ${CATEGORY_LABELS[category].toLowerCase()} (no name in OpenStreetMap)`,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    // true/false only when OSM explicitly tags it; null = unknown.
    emergencyDepartment: tags.emergency === 'yes' ? true : tags.emergency === 'no' ? false : null,
    lat,
    lng,
    address: formatAddress(tags),
    phone: tags.phone || tags['contact:phone'] || null,
    openingHours: tags.opening_hours || null,
    straightLineDistance: Math.round(haversine(center, { lat, lng })),
    roadDistance: null,
    roadDuration: null,
    source: 'OpenStreetMap',
  };
}

/**
 * Find facilities of the given categories near `center`.
 * Expands the radius (5 → 10 → 25 km) until at least `minResults` are found.
 * Road distance/ETA is added for the nearest `etaLimit` facilities.
 */
async function searchFacilities({ center, emergencyType = 'medical', categories, radius = 5000, minResults = 3, limit = 25, etaLimit = 10 }) {
  const cats = categories?.length ? categories : FACILITIES_FOR_EMERGENCY[emergencyType] || FACILITIES_FOR_EMERGENCY.other;
  const cacheKey = `${cats.join(',')}|${center.lat.toFixed(3)},${center.lng.toFixed(3)}|${radius}|${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const radii = [radius, 10000, 25000].filter((r, i, arr) => r >= radius && arr.indexOf(r) === i);
  let facilities = [];
  let usedRadius = radius;
  let via = 'overpass';
  for (const r of radii) {
    usedRadius = r;
    // eslint-disable-next-line no-await-in-loop
    const fetched = await fetchElements(cats, center, r);
    via = fetched.via;
    const seen = new Set();
    facilities = fetched.elements
      .map((el) => toFacility(el, center))
      .filter((f) => f && !seen.has(f.id) && seen.add(f.id))
      .sort((a, b) => a.straightLineDistance - b.straightLineDistance);
    if (facilities.length >= minResults) break;
  }
  facilities = facilities.slice(0, limit);

  let etaAvailable = false;
  let etaNote = null;
  const etaTargets = facilities.slice(0, etaLimit);
  if (etaTargets.length) {
    try {
      const table = await routingService.getTravelTable(center, etaTargets);
      table.forEach((t, i) => {
        etaTargets[i].roadDistance = t.distance != null ? Math.round(t.distance) : null;
        etaTargets[i].roadDuration = t.duration != null ? Math.round(t.duration) : null;
      });
      etaAvailable = true;
    } catch (err) {
      etaNote = `Road ETA unavailable: ${err.message}`;
    }
  }

  // For time-critical emergencies, the facility reachable soonest by road ranks first.
  facilities.sort((a, b) => {
    const da = a.roadDuration ?? Infinity;
    const db = b.roadDuration ?? Infinity;
    if (da !== db) return da - db;
    return a.straightLineDistance - b.straightLineDistance;
  });

  const result = {
    facilities,
    categories: cats,
    radius: usedRadius,
    etaAvailable,
    etaNote,
    source: SOURCES[via],
    sourceId: via,
    fetchedAt: new Date().toISOString(),
  };
  cache.set(cacheKey, result);
  return result;
}

module.exports = { searchFacilities, CATEGORY_LABELS, withFallback };
