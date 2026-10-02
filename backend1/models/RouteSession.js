const mongoose = require('mongoose');
const config = require('../config/env');

const routeEventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['calculated', 'recalculated', 'ai-review', 'off-route', 'hazard-detected', 'arrived'] },
    reason: { type: String, maxlength: 500 },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * Detailed routing state for one emergency request: the candidate routes,
 * the engine's evaluation and the agent's step trace. Live GPS positions
 * reported during monitoring are NOT stored here (or anywhere).
 */
const routeSessionSchema = new mongoose.Schema(
  {
    emergencyRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'EmergencyRequest' },
    emergencyType: String,
    provider: String,
    selectedRouteId: String,
    selectedRoute: {
      id: String,
      label: String,
      distance: Number,
      duration: Number,
      geometry: [[Number]],
    },
    evaluation: mongoose.Schema.Types.Mixed,
    agentTrace: mongoose.Schema.Types.Mixed,
    aiReview: mongoose.Schema.Types.Mixed,
    events: [routeEventSchema],
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

routeSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: config.retention.routeSessionDays * 86400 });

module.exports = mongoose.model('RouteSession', routeSessionSchema, 'routeSessions');
