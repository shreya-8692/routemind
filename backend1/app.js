
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
        if (
          !origin ||
          config.corsOrigins.includes('*') ||
          config.corsOrigins.includes(origin)
        ) {
          return callback(null, true);
        }

        return callback(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(mongoSanitize);

  // Root route: confirms the API is running.
  app.get('/', (req, res) => {
    res.json({
      name: 'RouteMind API',
      status: 'OK',
      message: 'RouteMind backend is running successfully.',
    });
  });

  app.use('/api', generalLimiter, apiRoutes);
  app.use('/api', notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;