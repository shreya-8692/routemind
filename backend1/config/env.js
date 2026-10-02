const path = require('path');
const dotenv = require('dotenv');

// backend1/.env takes precedence over a repository-level .env.
// dotenv never overrides variables that are already set.
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

function int(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) ? value : fallback;
}

function list(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: int('PORT', 5000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/routemind',
  corsOrigins: list('CORS_ORIGIN', ['http://localhost:5173', 'https://localhost:5173']),

  // Identifies RouteMind to the public OSM services (required by their usage policies).
  userAgent:
    process.env.OSM_USER_AGENT ||
    'RouteMind/1.0 (emergency route planner prototype; contact: set OSM_USER_AGENT)',

  routing: {
    provider: (process.env.ROUTING_PROVIDER || 'osrm').toLowerCase(),
    osrmBaseUrl: process.env.OSRM_BASE_URL || 'https://router.project-osrm.org',
    orsBaseUrl: process.env.ORS_BASE_URL || 'https://api.openrouteservice.org',
    apiKey: process.env.ROUTING_API_KEY || '',
    timeoutMs: int('ROUTING_TIMEOUT_MS', 12000),
  },

  geocoding: {
    baseUrl: process.env.GEOCODING_BASE_URL || 'https://nominatim.openstreetmap.org',
    apiKey: process.env.GEOCODING_API_KEY || '',
    email: process.env.NOMINATIM_EMAIL || '',
    timeoutMs: int('GEOCODING_TIMEOUT_MS', 8000),
  },

  overpass: {
    urls: list('OVERPASS_URLS', [
      'https://overpass-api.de/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
    ]),
    timeoutMs: int('OVERPASS_TIMEOUT_MS', 25000),
  },

  weather: {
    baseUrl: process.env.WEATHER_BASE_URL || 'https://api.open-meteo.com/v1/forecast',
    enabled: process.env.WEATHER_ENABLED !== 'false',
    timeoutMs: int('WEATHER_TIMEOUT_MS', 6000),
  },

  ai: {
    apiKey: process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-opus-5-5',
    effort: process.env.AI_EFFORT || 'low',
    maxIterations: int('AI_MAX_ITERATIONS', 10),
    timeoutMs: int('AI_TIMEOUT_MS', 90000),
  },

  retention: {
    historyDays: int('HISTORY_RETENTION_DAYS', 30),
    routeSessionDays: int('ROUTE_SESSION_RETENTION_DAYS', 7),
  },
};

config.ai.enabled = Boolean(config.ai.apiKey);

module.exports = config;
