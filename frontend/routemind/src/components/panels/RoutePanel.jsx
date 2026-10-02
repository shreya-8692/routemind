import { Link } from 'react-router';
import { useEmergency } from '../../context/contexts';
import { Banner, RiskBadge, Spinner } from '../common/Feedback';
import { formatDistance, formatDuration, placeLabel } from '../../utils/format';

/** Recommended route, explanation, alternatives and trip actions. */
export default function RoutePanel() {
  const { trip, planning, selectedRoute, selectedEvaluation, selectRoute, startMonitoring, stopMonitoring, recalculate, clearDestination, completeTrip, monitor } = useEmergency();
  const { plan, status } = trip;
  if (!plan) return null;
  const { evaluation } = plan;
  const monitoring = status === 'monitoring' || status === 'rerouting';
  const isRecommended = selectedRoute?.id === plan.recommendedRouteId;
  const live = monitor.last;

  return (
    <section className="card route-panel" aria-label="Route">
      <div className="card__head">
        <h3>Route to {placeLabel(plan.destination)}</h3>
        {plan.simulation && <span className="badge badge--sim">SIMULATION</span>}
      </div>
      {plan.facility && (
        <p className="muted small">
          {plan.facility.categoryLabel}
          {plan.facility.emergencyDepartment === true && ' · Emergency department (OSM tag)'}
          {plan.facility.address && ` · ${plan.facility.address}`}
        </p>
      )}

      {evaluation.allRoutesBlocked && (
        <Banner tone="danger" title="No viable route">
          Every route found passes a reported blocking hazard. Consider another destination or contact local emergency services.
        </Banner>
      )}

      {selectedRoute && (
        <div className="route-summary">
          <div className="metric">
            <span className="metric__label">{monitoring && live ? 'Remaining' : 'Distance'}</span>
            <span className="metric__value">{monitoring && live ? live.remainingDistanceText : formatDistance(selectedRoute.distance)}</span>
          </div>
          <div className="metric">
            <span className="metric__label">{monitoring && live ? 'ETA' : 'Estimated time'}</span>
            <span className="metric__value">
              {monitoring && live ? live.remainingDurationText : formatDuration(selectedEvaluation?.adjustedDuration ?? selectedRoute.duration)}
            </span>
          </div>
          <div className="metric">
            <span className="metric__label">Route</span>
            <span className="metric__value">{selectedRoute.label.replace(' (detour)', '')}</span>
            {selectedRoute.isDetour && <span className="muted small">detour</span>}
          </div>
        </div>
      )}
      {selectedEvaluation && (
        <div className="badge-row">
          <RiskBadge level={selectedEvaluation.riskLevel} />
          {isRecommended && <span className="badge badge--ok">Recommended</span>}
          {selectedEvaluation.blocked && <span className="badge badge--danger">Blocked by hazard</span>}
          {selectedEvaluation.hazardDelaySeconds > 0 && <span className="badge badge--warn">+{formatDuration(selectedEvaluation.hazardDelaySeconds)} est. hazard delay</span>}
        </div>
      )}

      <div className="explanation">
        <h4>Why this route</h4>
        <p>{plan.explanation.text}</p>
        {!isRecommended && selectedRoute && (
          <p className="text-warn">You selected {selectedRoute.label}; RouteMind recommends {evaluation.recommendedRoute || 'no route'}.</p>
        )}
      </div>

      {plan.routes.length > 1 && (
        <div className="route-options">
          <h4>Route options</h4>
          <ul className="list">
            {evaluation.evaluations.map((e) => (
              <li key={e.routeId} className={`list__item route-option${e.routeId === trip.selectedRouteId ? ' is-selected' : ''}`}>
                <button type="button" className="route-option__btn" onClick={() => selectRoute(e.routeId)} aria-pressed={e.routeId === trip.selectedRouteId}>
                  <strong>{e.label}</strong>
                  <span>{formatDistance(e.distance)} · {formatDuration(e.adjustedDuration)}</span>
                  <span className="muted small">
                    {e.blocked ? 'Blocked by reported hazard' : e.hazards.length ? `${e.hazards.length} hazard(s) · risk ${e.riskLevel}` : 'No reported hazards'}
                    {e.routeId === plan.recommendedRouteId && ' · recommended'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {evaluation.warnings.length > 0 && (
        <details className="warnings" open={evaluation.warnings.length <= 3}>
          <summary>Warnings ({evaluation.warnings.length})</summary>
          <ul>
            {evaluation.warnings.map((w) => (
              <li key={w} className={w.startsWith('[SIMULATED]') ? 'sim-text' : undefined}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="btn-row btn-row--stack">
        {!monitoring && status !== 'arrived' && status !== 'completed' && (
          <button type="button" className="btn btn-primary btn-large" onClick={startMonitoring} disabled={!selectedRoute || planning}>
            Start route monitoring
          </button>
        )}
        {monitoring && (
          <button type="button" className="btn btn-large" onClick={stopMonitoring}>
            Pause monitoring
          </button>
        )}
        <button type="button" className="btn" onClick={() => recalculate('Manual recalculation')} disabled={planning}>
          {planning ? <Spinner label="Recalculating…" /> : 'Recalculate route'}
        </button>
        <div className="btn-row">
          <Link to="/route" className="btn btn-small">Route details</Link>
          <Link to="/dashboard" className="btn btn-small">Dashboard</Link>
          {!monitoring && (
            <button type="button" className="btn btn-small" onClick={clearDestination}>Change destination</button>
          )}
          {(monitoring || status === 'arrived') && (
            <button type="button" className="btn btn-small" onClick={completeTrip}>Mark completed</button>
          )}
        </div>
      </div>
    </section>
  );
}
