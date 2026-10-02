const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config/env');
const apiRoutes = require('./routes');
const { mongoSanitize, generalLimiter } = require('./middleware/security');
const { notFound, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin / non-browser requests and the configured frontend origins.
        if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }),
  );
  // Route geometries sent for monitoring can be a few hundred KB.
  app.use(express.json({ limit: '1mb' }));
  app.use(mongoSanitize);
  app.use('/api', generalLimiter, apiRoutes);
  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
