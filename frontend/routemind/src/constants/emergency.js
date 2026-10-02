// Mirrors backend1/utils/constants.js. The backend validates every value.

export const EMERGENCY_TYPES = [
  {
    id: 'medical',
    label: 'Medical Emergency',
    short: 'Medical',
    icon: '✚',
    facilities: 'Hospitals and clinics',
  },
  {
    id: 'accident',
    label: 'Accident',
    short: 'Accident',
    icon: '⚠',
    facilities: 'Hospitals (trauma / emergency care)',
  },
  {
    id: 'fire',
    label: 'Fire Emergency',
    short: 'Fire',
    icon: '🔥',
    facilities: 'Fire stations',
  },
  {
    id: 'police',
    label: 'Police Emergency',
    short: 'Police',
    icon: '🛡',
    facilities: 'Police stations',
  },
  {
    id: 'other',
    label: 'Other Emergency',
    short: 'Other',
    icon: '!',
    facilities: 'Hospitals, police and fire stations',
  },
];

export const emergencyById = (id) => EMERGENCY_TYPES.find((t) => t.id === id) || null;

export const FACILITY_STYLE = {
  hospital: { symbol: 'H', label: 'Hospital' },
  clinic: { symbol: '+', label: 'Clinic' },
  fire_station: { symbol: 'F', label: 'Fire Station' },
  police: { symbol: 'P', label: 'Police Station' },
};

export const HAZARD_TYPES = ['Road Block', 'Accident', 'Flooding', 'Construction', 'Fire', 'Traffic Congestion', 'Other'];
export const HAZARD_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];

export const REQUEST_STATUS_LABEL = {
  Active: 'Active',
  Routing: 'Routing',
  Rerouting: 'Rerouting',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
};

// Client-side trip phases (the backend stores the coarser REQUEST_STATUSES).
export const TRIP_STATUS_LABEL = {
  idle: 'Not started',
  planning: 'Calculating route',
  ready: 'Route ready',
  monitoring: 'Active — monitoring',
  rerouting: 'Rerouting',
  arrived: 'Arrived',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const DISCLAIMER =
  'RouteMind is a navigation and decision-support prototype. It does not replace emergency services, dispatch centers, or professional emergency responders. In a real emergency, contact your local emergency service.';

export const LOCATION_REQUIRED = 'Location permission is required for live emergency navigation.';
