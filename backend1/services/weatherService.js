const config = require('../config/env');
const TTLCache = require('../utils/cache');
const { fetchJson } = require('../utils/httpClient');

/**
 * Current weather from Open-Meteo (free, no API key) turned into a coarse
 * driving-risk level. Weather is observed/modelled data for the area, not a
 * road-level report.
 */
const cache = new TTLCache({ ttlMs: 10 * 60 * 1000, maxEntries: 200 });

const WMO = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 56: 'Freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
};

const RANK = { low: 0, moderate: 1, high: 2 };

function assess(current) {
  const reasons = [];
  let risk = 'low';
  const raise = (level, reason) => {
    if (RANK[level] > RANK[risk]) risk = level;
    reasons.push(reason);
  };
  const code = current.weather_code;
  const precip = current.precipitation ?? 0;
  const gusts = current.wind_gusts_10m ?? 0;
  const visibility = current.visibility;

  if ([95, 96, 99].includes(code)) raise('high', 'Thunderstorm reported in the area');
  if ([65, 67, 82, 75, 86].includes(code)) raise('high', `${WMO[code]} in the area`);
  else if ([63, 66, 81, 73, 56, 57].includes(code)) raise('moderate', `${WMO[code]} in the area`);
  if (precip >= 7.6) raise('high', `Heavy precipitation (${precip} mm/h) — possible waterlogging`);
  else if (precip >= 2.5) raise('moderate', `Moderate precipitation (${precip} mm/h)`);
  if (visibility != null && visibility < 1000) raise('high', `Low visibility (${Math.round(visibility)} m)`);
  else if (visibility != null && visibility < 3000) raise('moderate', `Reduced visibility (${Math.round(visibility)} m)`);
  if (gusts >= 70) raise('high', `Strong wind gusts (${gusts} km/h)`);
  else if (gusts >= 50) raise('moderate', `Wind gusts (${gusts} km/h)`);
  if ([45, 48].includes(code)) raise('moderate', 'Fog in the area');

  return { risk, reasons, condition: WMO[code] || `Weather code ${code}` };
}

/** Weather risk at the given points (one request). Never throws: returns { available:false } on failure. */
async function getWeatherRisk(points) {
  if (!config.weather.enabled) return { available: false, note: 'Weather lookup disabled.' };
  const key = points.map((p) => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`).join('|');
  const cached = cache.get(key);
  if (cached) return cached;

  const url = new URL(config.weather.baseUrl);
  url.searchParams.set('latitude', points.map((p) => p.lat.toFixed(4)).join(','));
  url.searchParams.set('longitude', points.map((p) => p.lng.toFixed(4)).join(','));
  url.searchParams.set('current', 'precipitation,weather_code,wind_speed_10m,wind_gusts_10m,visibility');
  try {
    const data = await fetchJson(url.toString(), { service: 'Weather service (Open-Meteo)', timeoutMs: config.weather.timeoutMs });
    const entries = Array.isArray(data) ? data : [data];
    const locations = entries.map((e, i) => ({ point: points[i], ...assess(e.current || {}), observedAt: e.current?.time }));
    const worst = locations.reduce((acc, l) => (RANK[l.risk] > RANK[acc.risk] ? l : acc), locations[0]);
    const result = {
      available: true,
      source: 'Open-Meteo',
      risk: worst.risk,
      condition: worst.condition,
      reasons: [...new Set(locations.flatMap((l) => l.reasons))],
      observedAt: worst.observedAt,
    };
    cache.set(key, result);
    return result;
  } catch (err) {
    return { available: false, note: `Weather data unavailable: ${err.message}` };
  }
}

module.exports = { getWeatherRisk };
