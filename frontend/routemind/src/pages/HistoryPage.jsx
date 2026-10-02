import { useState } from 'react';
import { useAsync } from '../hooks/useAsync';
import { deleteEmergencyRequest, getHistory } from '../services/routemindApi';
import { EmptyState, ErrorMessage, Spinner } from '../components/common/Feedback';
import { emergencyById } from '../constants/emergency';
import { formatDateTime, formatDistance, formatDuration, placeLabel } from '../utils/format';

export default function HistoryPage() {
  const { data, error, loading, reload } = useAsync(() => getHistory(100), []);
  const [deleteError, setDeleteError] = useState(null);

  const remove = async (id) => {
    setDeleteError(null);
    try {
      await deleteEmergencyRequest(id);
      reload();
    } catch (err) {
      setDeleteError(err);
    }
  };

  return (
    <div className="page">
      <div className="page__head">
        <h1>Emergency route history</h1>
        <button type="button" className="btn btn-small" onClick={reload} disabled={loading}>Refresh</button>
      </div>
      {loading && !data && <Spinner label="Loading history…" />}
      <ErrorMessage
        error={error}
        title={error?.code === 'DB_UNAVAILABLE' ? 'History unavailable (database offline)' : 'Could not load history'}
        onRetry={reload}
      />
      <ErrorMessage error={deleteError} title="Could not delete" />
      {data && <p className="muted small">{data.retention.note}</p>}
      {data && !data.requests.length && <EmptyState title="No previous emergency routes">Routes you calculate are listed here.</EmptyState>}
      {data?.requests.length > 0 && (
        <ul className="history">
          {data.requests.map((r) => (
            <li key={r.id} className="card history__item">
              <div className="history__main">
                <strong>{emergencyById(r.emergencyType)?.label || r.emergencyType}</strong>
                {r.simulation && <span className="badge badge--sim">SIMULATION</span>}
                <span className={`status-pill status-pill--${String(r.status).toLowerCase()}`}>{r.status}</span>
                <div className="small">
                  {placeLabel(r.origin)} → {placeLabel(r.destination)}
                </div>
                <div className="muted small">
                  {formatDateTime(r.createdAt)}
                  {r.route?.label && ` · ${r.route.label}`}
                  {r.distance != null && ` · ${formatDistance(r.distance)}`}
                  {r.estimatedTime != null && ` · ${formatDuration(r.estimatedTime)}`}
                  {r.rerouteCount > 0 && ` · ${r.rerouteCount} reroute(s)`}
                </div>
              </div>
              <button type="button" className="btn btn-small btn-danger-outline" onClick={() => remove(r.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
