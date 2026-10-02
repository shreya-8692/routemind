const mongoose = require('mongoose');
const config = require('../config/env');
const { EMERGENCY_TYPES, REQUEST_STATUSES } = require('../utils/constants');

const placeSchema = new mongoose.Schema(
  {
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    address: { type: String, maxlength: 300 },
    name: { type: String, maxlength: 200 },
  },
  { _id: false },
);

const emergencyRequestSchema = new mongoose.Schema(
  {
    emergencyType: { type: String, enum: EMERGENCY_TYPES, required: true },
    origin: placeSchema,
    destination: placeSchema,
    destinationFacility: {
      osmId: String,
      category: String,
    },
    status: { type: String, enum: REQUEST_STATUSES, default: 'Active' },
    // Summary of the selected route only; full geometry lives in RouteSession.
    route: {
      label: String,
      provider: String,
      summary: String,
      riskLevel: String,
    },
    routeSession: { type: mongoose.Schema.Types.ObjectId, ref: 'RouteSession' },
    estimatedTime: Number, // seconds
    distance: Number, // metres
    warnings: [{ type: String, maxlength: 500 }],
    rerouteCount: { type: Number, default: 0 },
    simulation: { type: Boolean, default: false },
    completedAt: Date,
  },
  { timestamps: true },
);

// Privacy: emergency history (including origin/destination coordinates) is deleted
// automatically HISTORY_RETENTION_DAYS after the request was created.
emergencyRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: config.retention.historyDays * 86400 });

emergencyRequestSchema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('EmergencyRequest', emergencyRequestSchema, 'emergencyRequests');
