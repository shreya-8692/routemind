const mongoose = require('mongoose');
const { HAZARD_TYPES, HAZARD_SEVERITIES, HAZARD_STATUSES } = require('../utils/constants');

// Default radius (metres) within which a hazard is considered to affect a road.
const DEFAULT_RADIUS = { Low: 60, Medium: 100, High: 150, Critical: 250 };

const hazardSchema = new mongoose.Schema(
  {
    type: { type: String, enum: HAZARD_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    severity: { type: String, enum: HAZARD_SEVERITIES, required: true, default: 'Medium' },
    status: { type: String, enum: HAZARD_STATUSES, default: 'active' },
    radiusMeters: { type: Number, min: 10, max: 2000 },
    // 'user-report' = entered by a RouteMind user; 'simulation' = developer test data.
    // RouteMind has no live incident feed, so there is no other source.
    source: { type: String, enum: ['user-report', 'simulation'], required: true, default: 'user-report' },
    isSimulated: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

hazardSchema.index({ status: 1, expiresAt: 1 });
hazardSchema.index({ latitude: 1, longitude: 1 });

hazardSchema.pre('validate', function setDefaults() {
  const severityChangedAlone = !this.isNew && this.isModified('severity') && !this.isModified('radiusMeters');
  if (!this.radiusMeters || severityChangedAlone) this.radiusMeters = DEFAULT_RADIUS[this.severity] || 100;
  this.isSimulated = this.source === 'simulation';
});

hazardSchema.virtual('isActive').get(function isActive() {
  return this.status === 'active' && (!this.expiresAt || this.expiresAt > new Date());
});

hazardSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Hazard', hazardSchema);
module.exports.DEFAULT_RADIUS = DEFAULT_RADIUS;
