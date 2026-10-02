const mongoose = require('mongoose');
const config = require('./env');
const logger = require('../utils/logger');

// Reject query selectors such as { $gt: '' } that arrive inside filter objects.
mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);

async function connectDB() {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB error:', err.message));

  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
    logger.info('MongoDB connected');
  } catch (err) {
    // Routing must keep working without the database; persistence features degrade instead.
    logger.error('MongoDB connection failed — running without persistence:', err.message);
  }
}

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = { connectDB, isDbConnected };
