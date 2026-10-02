import { useState } from 'react';
import { useEmergency, useLocation, useSettings } from '../../context/contexts';
import { aiReview } from '../../services/routemindApi';
import { Banner, ErrorMessage, Spinner } from '../common/Feedback';

const STATUS_TONE = { completed: 'success', fallback: 'warning', unavailable: 'info', error: 'danger' };

/**
 * Optional second opinion: Claude runs the Emergency Route Agent's tools itself,
 * reasons over their results and must pick an engine-validated route. Its
 * explanation is checked by guardrails before it is shown.
 */
export default function AiReviewPanel() {
  const { trip, selectRoute } = useEmergency();
  const { origin } = useLocation();
  const { settings } = useSettings();
  const [state, setState] = useState({ loading: false, result: null, error: null });
  const plan = trip.plan;
  if (!plan) return null;

  const run = async () => {
    setState({ loading: true, result: null, error: null });
    try {
      const result = await aiReview({
        emergencyType: trip.emergencyType,
        origin: origin || plan.origin,
        destination: plan.destination,
        includeSimulated: settings.simulationMode,
        sessionId: trip.sessionId,
      });
      setState({ loading: false, result, error: null });
    } catch (err) {
      setState({ loading: false, result: null, error: err });
    }
  };

  const r = state.result;
  const sameRoutes = r && r.routes?.length === plan.routes.length;
  return (
    <div className="ai-review">
      <p className="muted small">
        The AI agent calls the same tools (location, routing, hazards, weather, traffic, route evaluation), reasons over their output and submits a
        recommendation. It may only choose a route the engine marked viable, and its explanation is rejected if it states anything not present in the
        tool data.
      </p>
      <button type="button" className="btn" onClick={run} disabled={state.loading}>
        {state.loading ? <Spinner label="Agent is reviewing the route…" /> : 'Run AI route review'}
      </button>
      <ErrorMessage error={state.error} title="AI review failed" onRetry={run} />
      {r && (
        <Banner tone={STATUS_TONE[r.status] || 'info'} title={`AI review: ${r.status}${r.model && r.status === 'completed' ? ` (${r.model})` : ''}`}>
          {r.message && <p>{r.message}</p>}
          {r.explanation && (
            <p>
              <strong>{r.explanation.source === 'ai' ? 'AI explanation' : 'Engine explanation'}:</strong> {r.explanation.text}
            </p>
          )}
          {r.decision?.label && (
            <p>
              Choice: <strong>{r.decision.label}</strong> {r.decision.agreesWithEngine ? '(agrees with the engine)' : '(differs from the engine)'}
              {sameRoutes && r.decision.routeId !== trip.selectedRouteId && (
                <button type="button" className="btn btn-small" onClick={() => selectRoute(r.decision.routeId)}>Use {r.decision.label}</button>
              )}
            </p>
          )}
          {r.warnings?.length > 0 && <ul>{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          {r.guardrail && !r.guardrail.passed && (
            <details>
              <summary>Guardrail violations</summary>
              <ul>{r.guardrail.violations.map((v) => <li key={v}>{v}</li>)}</ul>
            </details>
          )}
          {r.toolCalls?.length > 0 && (
            <p className="muted small">Tool calls: {r.toolCalls.map((c) => c.tool).join(' → ')}</p>
          )}
        </Banner>
      )}
    </div>
  );
}
