import { NavLink } from 'react-router';
import { useEmergency, useSettings } from '../../context/contexts';
import { emergencyById, TRIP_STATUS_LABEL } from '../../constants/emergency';

const LINKS = [
  { to: '/map', label: 'Map' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/route', label: 'Route' },
  { to: '/history', label: 'History' },
  { to: '/settings', label: 'Settings' },
];

export default function AppHeader() {
  const { trip } = useEmergency();
  const { settings } = useSettings();
  const type = emergencyById(trip.emergencyType);

  return (
    <header className="app-header">
      <div className="app-header__row">
        <NavLink to="/" className="brand" aria-label="RouteMind home">
          <span className="brand__mark" aria-hidden="true">RM</span>
          <span className="brand__name">RouteMind</span>
        </NavLink>
        {type && (
          <span className={`trip-chip trip-chip--${trip.status}`}>
            <span aria-hidden="true">{type.icon}</span> {type.short} · {TRIP_STATUS_LABEL[trip.status]}
          </span>
        )}
      </div>
      <nav className="app-nav" aria-label="Main">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      {settings.simulationMode && (
        <div className="sim-banner" role="status">
          SIMULATION MODE — DEMO / SIMULATION DATA is shown and used for routing. Simulated hazards are not real incidents.
        </div>
      )}
    </header>
  );
}
