import { useEmergency } from '../../context/contexts';
import { Banner, Spinner } from '../common/Feedback';
import { formatDistance } from '../../utils/format';

/** Live monitoring alerts: route updates, off-route, hazards ahead, arrival. */
export default function RouteAlerts() {
  const { trip, monitor, recalculate, planning, dismissRouteUpdate, completeTrip } = useEmergency();
  const { routeUpdate, last, error, offRoute } = monitor;
  const monitoring = trip.status === 'monitoring' || trip.status === 'rerouting';
  const nonBlockingAhead = last?.hazardsAhead?.filter((h) => !h.blocking) || [];

  return (
    <div className="route-alerts" aria-live="assertive">
      {routeUpdate && (
        <Banner
          tone={routeUpdate.phase === 'done' ? 'info' : routeUpdate.phase === 'failed' || routeUpdate.phase === 'blocked' ? 'danger' : 'warning'}
          title="⚠️ Route Update"
          actions={
            routeUpdate.phase === 'suggested' ? (
              <button type="button" className="btn btn-primary btn-small" onClick={() => recalculate(routeUpdate.reason, { hazard: true })} disabled={planning}>
                Recalculate route
              </button>
            ) : routeUpdate.phase !== 'calculating' ? (
              <button type="button" className="btn btn-small" onClick={dismissRouteUpdate}>Dismiss</button>
            ) : null
          }
        >
          {routeUpdate.hazard ? (
            <div>A road condition affecting your current route has been detected: {routeUpdate.reason}</div>
          ) : (
            routeUpdate.reason && <div>Reason: {routeUpdate.reason}</div>
          )}
          {routeUpdate.phase === 'calculating' && <Spinner label="Calculating an alternative route…" />}
          {routeUpdate.message && <div><strong>{routeUpdate.message}</strong></div>}
        </Banner>
      )}

      {monitoring && offRoute && routeUpdate?.phase !== 'calculating' && (
        <Banner
          tone="warning"
          title="You appear to have left the planned route."
          actions={
            <button type="button" className="btn btn-primary btn-small" onClick={() => recalculate('Left the planned route')} disabled={planning}>
              Recalculate Route
            </button>
          }
        >
          About {formatDistance(last?.distanceFromRoute)} from the route (threshold {formatDistance(last?.offRouteThreshold)}).
        </Banner>
      )}

      {monitoring && nonBlockingAhead.length > 0 && (
        <Banner tone="warning" title="Hazard ahead">
          {nonBlockingAhead.slice(0, 3).map((h) => (
            <div key={h.id}>
              {h.isSimulated && <span className="badge badge--sim">SIM</span>} {h.type} ({h.severity}) in {formatDistance(h.metersAhead)} — {h.title}
            </div>
          ))}
        </Banner>
      )}

      {monitoring && error && <Banner tone="warning" title="Monitoring check failed">{error} Retrying automatically.</Banner>}
      {monitoring && last?.lowAccuracy && <Banner tone="info">{last.messages.find((m) => m.startsWith('GPS accuracy'))}</Banner>}

      {trip.status === 'arrived' && (
        <Banner tone="success" title="You have arrived at the destination." actions={<button type="button" className="btn btn-small" onClick={completeTrip}>Close trip</button>}>
          Route monitoring has stopped.
        </Banner>
      )}
    </div>
  );
}
