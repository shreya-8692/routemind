const config = require('./config/env');
const { connectDB } = require('./config/db');
const createApp = require('./app');
const logger = require('./utils/logger');

async function start() {
  await connectDB();
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`RouteMind API listening on port ${config.port}`);
    logger.info(`Routing provider: ${config.routing.provider}; AI reasoning: ${config.ai.enabled ? config.ai.model : 'disabled (no AI_API_KEY)'}`);
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
