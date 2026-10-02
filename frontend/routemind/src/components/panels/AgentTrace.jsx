const STATUS_ICON = { ok: '✓', warning: '!', error: '✕' };

/** The Emergency Route Agent's tool calls, in order, with what each one found. */
export default function AgentTrace({ trace }) {
  if (!trace?.length) return null;
  return (
    <ol className="trace">
      {trace.map((step, i) => (
        <li key={`${step.tool}-${i}`} className={`trace__step trace__step--${step.status}`}>
          <span className="trace__icon" aria-label={step.status}>{STATUS_ICON[step.status] || '•'}</span>
          <div>
            <strong>{step.label}</strong> <code className="muted small">{step.tool}()</code>
            <div className="small">{step.summary}</div>
            <div className="muted small">{step.durationMs} ms</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
