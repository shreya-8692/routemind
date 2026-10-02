import { Link } from 'react-router';
import { useEmergency, useLocation } from '../context/contexts';
import RouteAlerts from '../components/panels/RouteAlerts';
import { EmptyState, RiskBadge } from '../components/common/Feedback';
import Disclaimer from '../components/layout/Disclaimer';
import { emergencyById, TRIP_STATUS_LABEL } from '../constants/emergency';
import { formatCoord, formatDistance, formatDuration, formatTime, placeLabel } from '../utils/format';

export default function DashboardPage() {
  const { trip, monitor, selectedRoute, selectedEvaluation, startMonitoring, stopMonitoring, cancelTrip, completeTrip } = useEmergency();
  const { origin } = useLocation();
  const type = emergencyById(trip.emergencyType);

  if (!type) {
    return (
      <div className="page">
        <h1>Emergency dashboard</h1>
        <EmptyState title="No active emergency">
          <Link to="/emergency">Start an emergency route</Link>.
        </EmptyState>
      </div>
    );
  }

  const plan = trip.plan;
  const live = monitor.last;
  const monitoring = trip.status === 'monitoring' || trip.status === 'rerouting';
  const warnings = [
    ...(live?.hazardsAhead || []).map((h) => `${h.isSimulated ? '[SIMULATED] ' : ''}${h.type} (${h.severity}) ${formatDistance(h.metersAhead)} ahead — ${h.title}`),
    ...(plan?.evaluation.warnings || []),
  ];

  return (
    <div className="page dashboard">
      <div className={`dash-hero dash-hero--${type.id}`}>
        <span className="dash-hero__icon" aria-hidden="true">🚨</span>
        <h1>{type.label.toUpperCase()}</h1>
        <span className={`status-pill status-pill--${trip.status}`}>{TRIP_STATUS_LABEL[trip.status]}</span>
      </div>

      <RouteAlerts />

      <div className="dash-grid">
        <div className="dash-tile">
          <span className="dash-tile__label">Current location</span>
          <span className="dash-tile__value">{origin?.address || (origin ? `${formatCoord(origin.lat, 4)}, ${formatCoord(origin.lng, 4)}` : 'Unknown')}</span>
          {origin && <span className="muted small">{origin.source === 'gps' ? 'Live GPS' : origin.source === 'simulated' ? 'SIMULATED' : 'Manual'}</span>}
        </div>
        <div className="dash-tile">
          <span className="dash-tile__label">Destination</span>
          <span className="dash-tile__value">{plan ? placeLabel(plan.destination) : 'Not selected'}</span>
          {plan?.facility && <span className="muted small">{plan.facility.categoryLabel}</span>}
        </div>
        <div className="dash-tile dash-tile--big">
          <span className="dash-tile__label">ETA</span>
          <span className="dash-tile__value">
            {live && monitoring ? live.remainingDurationText : selectedRoute ? formatDuration(selectedEvaluation?.adjustedDuration ?? selectedRoute.duration) : '—'}
          </span>
          <span className="muted small">Routing-engine estimate, no live traffic</span>
        </div>
        <div className="dash-tile dash-tile--big">
          <span className="dash-tile__label">Distance remaining</span>
          <span className="dash-tile__value">{live && monitoring ? live.remainingDistanceText : selectedRoute ? formatDistance(selectedRoute.distance) : '—'}</span>
          {live && monitoring && <span className="muted small">{live.progress}% of route covered</span>}
        </div>
        <div className="dash-tile">
          <span className="dash-tile__label">Current route</span>
          <span className="dash-tile__value">{selectedRoute ? selectedRoute.label : '—'}</span>
          {selectedEvaluation && <RiskBadge level={selectedEvaluation.riskLevel} />}
        </div>
        <div className="dash-tile">
          <span className="dash-tile__label">Route status</span>
          <span className="dash-tile__value">{live && monitoring ? live.status.replace('-', ' ') : TRIP_STATUS_LABEL[trip.status]}</span>
          <span className="muted small">Reroutes: {trip.rerouteCount}{live && monitoring ? ` · last check ${formatTime(live.checkedAt)}` : ''}</span>
        </div>
      </div>

      <section className="card">
        <h2>⚠️ Warnings</h2>
        {warnings.length ? <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="muted">No warnings.</p>}
      </section>

      <div className="btn-row">
        <Link to="/map" className="btn btn-primary">Open map</Link>
        {plan && !monitoring && !['arrived', 'completed', 'cancelled'].includes(trip.status) && (
          <button type="button" className="btn" onClick={startMonitoring}>Start monitoring</button>
        )}
        {monitoring && <button type="button" className="btn" onClick={stopMonitoring}>Pause monitoring</button>}
        {plan && !['completed', 'cancelled'].includes(trip.status) && (
          <>
            <button type="button" className="btn" onClick={completeTrip}>Mark completed</button>
            <button type="button" className="btn btn-danger-outline" onClick={cancelTrip}>Cancel trip</button>
          </>
        )}
      </div>

      <section className="card">
        <h2>Activity</h2>
        {trip.events.length ? (
          <ul className="timeline">
            {trip.events.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <span className="muted small mono">{formatTime(e.at)}</span> {e.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No activity yet.</p>
        )}
      </section>
      <Disclaimer compact />
    </div>
  );
}
