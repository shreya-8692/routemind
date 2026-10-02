import { Link, useNavigate } from 'react-router';
import { useEmergency, useLocation } from '../context/contexts';
import { useAsync } from '../hooks/useAsync';
import { getHealth } from '../services/routemindApi';
import Disclaimer from '../components/layout/Disclaimer';
import { emergencyById, TRIP_STATUS_LABEL } from '../constants/emergency';
import { placeLabel } from '../utils/format';

function ServiceStatus() {
  const { data, error, loading, reload } = useAsync(() => getHealth(), []);
  if (loading && !data) return <p className="muted small">Checking services…</p>;
  if (error) {
    return (
      <p className="service-status service-status--down small">
        RouteMind server unreachable: {error.message}{' '}
        <button type="button" className="link-btn" onClick={reload}>Retry</button>
      </p>
    );
  }
  if (!data) return null;
  return (
    <ul className="service-status small" aria-label="Service status">
      <li className="ok">Routing: {data.routing.label}</li>
      <li className={data.database.connected ? 'ok' : 'warn'}>Database: {data.database.connected ? 'connected' : 'unavailable (history and hazard reports disabled)'}</li>
      <li className={data.ai.enabled ? 'ok' : 'info'}>AI reasoning: {data.ai.enabled ? data.ai.model : 'not configured — deterministic engine only'}</li>
      <li className="info">Live traffic: not available (no traffic provider configured)</li>
    </ul>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { start } = useLocation();
  const { trip } = useEmergency();
  const active = trip.emergencyType && !['completed', 'cancelled', 'idle'].includes(trip.status);
  const activeType = emergencyById(trip.emergencyType);

  const begin = () => {
    // Request location in response to the tap: browsers are more willing to prompt on a user gesture.
    start();
    navigate('/emergency');
  };

  return (
    <div className="landing">
      <section className="landing__hero">
        <h1 className="landing__title">RouteMind</h1>
        <p className="landing__subtitle">Emergency Response Route Planner</p>
        <button type="button" className="btn btn-emergency" onClick={begin}>
          Start Emergency Route
        </button>
        {active && activeType && (
          <p className="landing__resume">
            Active: {activeType.label} → {placeLabel(trip.plan?.destination)} ({TRIP_STATUS_LABEL[trip.status]}).{' '}
            <Link to="/map">Resume</Link>
          </p>
        )}
      </section>

      <Disclaimer />

      <section className="landing__how card">
        <h2>How it works</h2>
        <ol>
          <li>Share your real location (or choose it on the map).</li>
          <li>Select the type of emergency.</li>
          <li>RouteMind finds nearby hospitals, fire or police stations from OpenStreetMap, or uses a destination you choose.</li>
          <li>The Emergency Route Agent fetches route options, checks reported hazards and weather, scores each route and explains its recommendation.</li>
          <li>While you travel, RouteMind monitors your position and recalculates if you leave the route or a new hazard blocks it.</li>
        </ol>
        <ServiceStatus />
      </section>
    </div>
  );
}
