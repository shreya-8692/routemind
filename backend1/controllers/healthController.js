const config = require('../config/env');
const { isDbConnected } = require('../config/db');
const routingService = require('../services/routingService');

function health(_req, res) {
  const db = isDbConnected();
  res.json({
    status: db ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    database: { connected: db },
    routing: routingService.describeProvider(),
    ai: { enabled: config.ai.enabled, model: config.ai.enabled ? config.ai.model : null },
    weather: { enabled: config.weather.enabled, provider: 'Open-Meteo' },
    liveTraffic: { available: false },
    retention: config.retention,
  });
}

module.exports = { health };
