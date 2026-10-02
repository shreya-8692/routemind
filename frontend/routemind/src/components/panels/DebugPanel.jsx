import { useEmergency, useLocation } from '../../context/contexts';
import { formatCoord, formatTime } from '../../utils/format';

/** Developer/debug view of the raw location and monitoring values. */
export default function DebugPanel() {
  const { origin, gps, simulatedPosition } = useLocation();
  const { trip, monitor } = useEmergency();
  const p = gps.position;
  const m = monitor.last;
  const rows = [
    ['Origin source', origin?.source || '—'],
    ['Latitude', formatCoord(origin?.lat, 6)],
    ['Longitude', formatCoord(origin?.lng, 6)],
    ['GPS status', gps.status],
    ['Permission', gps.permission],
    ['GPS accuracy', p ? `±${Math.round(p.accuracy)} m` : '—'],
    ['GPS speed', p?.speed != null ? `${(p.speed * 3.6).toFixed(1)} km/h` : '—'],
    ['GPS heading', p?.heading != null ? `${Math.round(p.heading)}°` : '—'],
    ['GPS fix time', p ? formatTime(p.timestamp) : '—'],
    ['GPS error', gps.error?.message || '—'],
    ['Simulated position', simulatedPosition ? `${formatCoord(simulatedPosition.lat)}, ${formatCoord(simulatedPosition.lng)}` : '—'],
    ['Address', origin?.address || '—'],
    ['Trip status', trip.status],
    ['Emergency request', trip.emergencyRequestId || '—'],
    ['Route session', trip.sessionId || '—'],
    ['Last monitor check', m ? formatTime(m.checkedAt) : '—'],
    ['Monitor status', m?.status || '—'],
    ['Distance from route', m ? `${m.distanceFromRoute} m (threshold ${m.offRouteThreshold} m)` : '—'],
    ['Progress', m ? `${m.progress}%` : '—'],
  ];
  return (
    <section className="card debug" aria-label="Debug information">
      <h3>Developer / debug</h3>
      <dl className="kv mono small">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
