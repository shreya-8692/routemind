const EMERGENCY_TYPES = ['medical', 'accident', 'fire', 'police', 'other'];

const EMERGENCY_LABELS = {
  medical: 'Medical Emergency',
  accident: 'Accident',
  fire: 'Fire Emergency',
  police: 'Police Emergency',
  other: 'Other Emergency',
};

const HAZARD_TYPES = ['Road Block', 'Accident', 'Flooding', 'Construction', 'Fire', 'Traffic Congestion', 'Other'];
const HAZARD_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const HAZARD_STATUSES = ['active', 'resolved'];

const REQUEST_STATUSES = ['Active', 'Routing', 'Rerouting', 'Completed', 'Cancelled'];

const FACILITY_TYPES = ['hospital', 'clinic', 'fire_station', 'police'];

// Default facility categories searched for each emergency type.
const FACILITIES_FOR_EMERGENCY = {
  medical: ['hospital', 'clinic'],
  accident: ['hospital'],
  fire: ['fire_station'],
  police: ['police'],
  other: ['hospital', 'police', 'fire_station'],
};

module.exports = {
  EMERGENCY_TYPES,
  EMERGENCY_LABELS,
  HAZARD_TYPES,
  HAZARD_SEVERITIES,
  HAZARD_STATUSES,
  REQUEST_STATUSES,
  FACILITY_TYPES,
  FACILITIES_FOR_EMERGENCY,
};
