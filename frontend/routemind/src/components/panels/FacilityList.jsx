import { ErrorMessage, Spinner, EmptyState } from '../common/Feedback';
import { formatDistance, formatDuration } from '../../utils/format';

/** Nearby emergency facilities from OpenStreetMap (via the backend's Overpass search). */
export default function FacilityList({ result, loading, error, onReload, onRoute, onFocus, selectedId, disabled }) {
  if (loading && !result) return <Spinner label="Searching OpenStreetMap for nearby facilities…" />;
  if (error && !result) return <ErrorMessage error={error} title="Facility search unavailable" onRetry={onReload} />;
  if (!result) return null;

  const { facilities, radius, etaAvailable, etaNote, source } = result;
  return (
    <div className="facility-list">
      {loading && <Spinner label="Refreshing…" />}
      {error && <ErrorMessage error={error} title="Refresh failed" onRetry={onReload} />}
      {!facilities.length ? (
        <EmptyState title="No facilities found">
          OpenStreetMap lists no matching facility within {formatDistance(radius)}. Search for a destination or select it on the map.
        </EmptyState>
      ) : (
        <ul className="list">
          {facilities.map((f) => (
            <li key={f.id} className={`list__item facility${f.id === selectedId ? ' is-selected' : ''}`}>
              <button type="button" className="facility__info" onClick={() => onFocus?.(f)}>
                <strong>{f.displayName}</strong>
                <span className="muted small">
                  {f.categoryLabel}
                  {f.emergencyDepartment === true && ' · Emergency dept. (OSM tag)'}
                </span>
                <span className="facility__metrics">
                  <span>{formatDistance(f.roadDistance ?? f.straightLineDistance)}{f.roadDistance == null && ' (straight line)'}</span>
                  {f.roadDuration != null && <span className="facility__eta">ETA {formatDuration(f.roadDuration)}</span>}
                </span>
                {f.address && <span className="muted small">{f.address}</span>}
              </button>
              <button type="button" className="btn btn-primary btn-small" onClick={() => onRoute(f)} disabled={disabled}>
                Route here
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Within {formatDistance(radius)} · Source: {source}.{' '}
        {etaAvailable ? 'ETA = routing-engine estimate without live traffic.' : etaNote}
      </p>
    </div>
  );
}
