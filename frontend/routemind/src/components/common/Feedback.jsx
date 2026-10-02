export function Banner({ tone = 'info', title, children, actions, role }) {
  return (
    <div className={`banner banner--${tone}`} role={role || (tone === 'danger' || tone === 'warning' ? 'alert' : 'status')}>
      <div className="banner__body">
        {title && <strong className="banner__title">{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {actions && <div className="banner__actions">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/** Error box with an optional retry. Used so no view is ever left stuck on "Loading…". */
export function ErrorMessage({ error, onRetry, title = 'Something went wrong' }) {
  if (!error) return null;
  return (
    <Banner
      tone="danger"
      title={title}
      actions={onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Try again
        </button>
      )}
    >
      {error.message || String(error)}
    </Banner>
  );
}

export function RiskBadge({ level }) {
  if (!level) return null;
  return <span className={`badge badge--risk-${String(level).toLowerCase()}`}>Risk: {level}</span>;
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}
