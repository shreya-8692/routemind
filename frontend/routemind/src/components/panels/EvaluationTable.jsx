import { formatDistance, formatDuration } from '../../utils/format';

/** Per-route output of the deterministic Emergency Route Engine. */
export default function EvaluationTable({ evaluation, selectedRouteId, onSelect }) {
  if (!evaluation) return null;
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">Route evaluation</caption>
        <thead>
          <tr>
            <th scope="col">Route</th>
            <th scope="col">Distance</th>
            <th scope="col">Base time</th>
            <th scope="col">Hazard delay</th>
            <th scope="col">Est. time</th>
            <th scope="col">Risk</th>
            <th scope="col">Score</th>
            <th scope="col">Hazards</th>
          </tr>
        </thead>
        <tbody>
          {evaluation.evaluations.map((e) => (
            <tr key={e.routeId} className={`${e.routeId === selectedRouteId ? 'is-selected' : ''}${e.blocked ? ' is-blocked' : ''}`}>
              <th scope="row">
                {onSelect ? (
                  <button type="button" className="link-btn" onClick={() => onSelect(e.routeId)}>{e.label}</button>
                ) : e.label}
                {e.routeId === evaluation.recommendedRouteId && <span className="badge badge--ok">best</span>}
              </th>
              <td>{formatDistance(e.distance)}</td>
              <td>{formatDuration(e.baseDuration)}</td>
              <td>{e.hazardDelaySeconds ? `+${formatDuration(e.hazardDelaySeconds)}` : '—'}</td>
              <td>{formatDuration(e.adjustedDuration)}</td>
              <td>{e.riskLevel}</td>
              <td>{e.viable ? e.score : 'not viable'}</td>
              <td>
                {e.hazards.length
                  ? e.hazards.map((h) => (
                      <div key={h.id} className="small">
                        {h.isSimulated && <span className="badge badge--sim">SIM</span>} {h.type} ({h.severity}){h.blocking ? ' — blocks road' : ''}
                      </div>
                    ))
                  : 'None reported'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
