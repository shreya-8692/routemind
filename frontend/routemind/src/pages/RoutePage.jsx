import { Link } from 'react-router';
import { useEmergency } from '../context/contexts';
import EvaluationTable from '../components/panels/EvaluationTable';
import AgentTrace from '../components/panels/AgentTrace';
import AiReviewPanel from '../components/panels/AiReviewPanel';
import { EmptyState, RiskBadge } from '../components/common/Feedback';
import { emergencyById } from '../constants/emergency';
import { formatDateTime, formatDistance, formatDuration, placeLabel } from '../utils/format';

export default function RoutePage() {
  const { trip, selectedRoute, selectedEvaluation, selectRoute } = useEmergency();
  const plan = trip.plan;

  if (!plan) {
    return (
      <div className="page">
        <h1>Route details</h1>
        <EmptyState title="No route calculated yet">
          <Link to="/emergency">Start an emergency route</Link> to see the route analysis.
        </EmptyState>
      </div>
    );
  }

  const { evaluation } = plan;
  const factors = evaluation.decisionFactors;
  return (
    <div className="page">
      <h1>Route details</h1>
      <p className="muted">
        {emergencyById(plan.emergencyType)?.label} · from {placeLabel(plan.origin)} to {placeLabel(plan.destination)} · calculated {formatDateTime(plan.generatedAt)}
        {plan.simulation && <span className="badge badge--sim">SIMULATION DATA INCLUDED</span>}
      </p>

      <div className="grid-2">
        <section className="card">
          <h2>Recommendation</h2>
          {evaluation.recommendedRoute ? (
            <p className="big-line">
              <strong>{evaluation.recommendedRoute}</strong> · {evaluation.distanceText} · {evaluation.estimatedTimeText} <RiskBadge level={evaluation.riskLevel} />
            </p>
          ) : (
            <p className="text-danger"><strong>No viable route.</strong></p>
          )}
          <p>{plan.explanation.text}</p>
          {selectedRoute && selectedRoute.id !== plan.recommendedRouteId && (
            <p className="text-warn">Currently selected: {selectedRoute.label} ({formatDistance(selectedRoute.distance)}, {formatDuration(selectedEvaluation?.adjustedDuration)}).</p>
          )}
          <h3>Warnings</h3>
          <ul>{evaluation.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>

        <section className="card">
          <h2>Decision factors</h2>
          <dl className="kv">
            <div><dt>Emergency profile</dt><dd>{factors.emergencyLabel}</dd></div>
            <div><dt>Rationale</dt><dd>{factors.rationale}</dd></div>
            <div><dt>Destination type</dt><dd>{plan.facility?.categoryLabel || 'User-selected destination'}</dd></div>
            <div><dt>Live traffic</dt><dd>{factors.liveTraffic ? 'Yes' : 'Not available'}</dd></div>
            <div><dt>Weather risk</dt><dd>{factors.weatherRisk}{plan.weather?.available ? ` (${plan.weather.condition}, Open-Meteo)` : ''}</dd></div>
            <div><dt>Hazard data</dt><dd>{factors.hazardDataAvailable ? `${plan.hazards.length} active report(s) near the routes` : 'Unavailable'}</dd></div>
            <div><dt>Scoring</dt><dd className="mono small">{factors.formula}</dd></div>
          </dl>
        </section>
      </div>

      <section className="card">
        <h2>Route evaluation (Emergency Route Engine)</h2>
        <EvaluationTable evaluation={evaluation} selectedRouteId={trip.selectedRouteId} onSelect={selectRoute} />
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Emergency Route Agent — steps</h2>
          <AgentTrace trace={plan.trace} />
        </section>
        <section className="card">
          <h2>AI route review</h2>
          <AiReviewPanel />
        </section>
      </div>

      {selectedRoute?.steps?.length > 0 && (
        <section className="card">
          <h2>Directions — {selectedRoute.label}</h2>
          <ol className="directions">
            {selectedRoute.steps.map((s, i) => (
              <li key={i}>
                <span>{s.instruction}</span>
                <span className="muted small">{formatDistance(s.distance)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="card">
        <h2>Data sources</h2>
        <ul>{plan.dataSources.map((d) => <li key={d}>{d}</li>)}</ul>
        <p className="muted small">Map data © OpenStreetMap contributors (ODbL).</p>
      </section>
    </div>
  );
}
