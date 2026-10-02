import { useState } from 'react';
import { useSettings } from '../context/contexts';
import { useAsync } from '../hooks/useAsync';
import { deleteHazard, getHazards, getHealth, updateHazard } from '../services/routemindApi';
import { Banner, ErrorMessage, Spinner } from '../components/common/Feedback';
import { formatDateTime } from '../utils/format';

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="setting">
      <span>
        <strong>{label}</strong>
        {hint && <span className="muted small">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function HazardAdmin() {
  const { data, error, loading, reload } = useAsync(() => getHazards({ includeSimulated: true, includeInactive: true }), []);
  const [actionError, setActionError] = useState(null);
  const act = async (fn) => {
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(err);
    }
  };
  return (
    <section className="card">
      <div className="card__head">
        <h2>Hazard reports</h2>
        <button type="button" className="btn btn-small" onClick={reload}>Refresh</button>
      </div>
      {loading && !data && <Spinner label="Loading hazards…" />}
      <ErrorMessage error={error} title="Hazards unavailable" onRetry={reload} />
      <ErrorMessage error={actionError} title="Action failed" />
      {data && !data.hazards.length && <p className="muted">No hazard reports stored.</p>}
      {data?.hazards.length > 0 && (
        <ul className="list">
          {data.hazards.map((h) => (
            <li key={h.id} className="list__item">
              <div>
                <strong>{h.title}</strong> {h.isSimulated && <span className="badge badge--sim">SIM</span>}
                <div className="small">{h.type} · {h.severity} · {h.isActive ? 'active' : h.status === 'resolved' ? 'resolved' : 'expired'}</div>
                <div className="muted small">Created {formatDateTime(h.createdAt)} · expires {formatDateTime(h.expiresAt)}</div>
              </div>
              <div className="btn-row">
                {h.isActive && <button type="button" className="btn btn-small" onClick={() => act(() => updateHazard(h.id, { status: 'resolved' }))}>Resolve</button>}
                <button type="button" className="btn btn-small btn-danger-outline" onClick={() => act(() => deleteHazard(h.id))}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Only active, unexpired hazards affect routing. Simulated hazards only affect routing while Simulation Mode is on.</p>
    </section>
  );
}

export default function SettingsPage() {
  const { settings, update, reset } = useSettings();
  const health = useAsync(() => getHealth(), []);

  return (
    <div className="page page--narrow">
      <h1>Settings</h1>

      <section className="card">
        <h2>Navigation</h2>
        <Toggle label="High-accuracy GPS" hint="Uses satellite GPS where available (more battery)." checked={settings.highAccuracy} onChange={(v) => update({ highAccuracy: v })} />
        <Toggle label="Automatic rerouting" hint="Recalculate automatically when a blocking hazard is detected ahead." checked={settings.autoReroute} onChange={(v) => update({ autoReroute: v })} />
        <label className="setting">
          <span>
            <strong>Monitoring interval</strong>
            <span className="muted small">How often the route is checked while monitoring.</span>
          </span>
          <select value={settings.monitorIntervalSec} onChange={(e) => update({ monitorIntervalSec: Number(e.target.value) })}>
            {[5, 10, 20, 30].map((s) => <option key={s} value={s}>{s} s</option>)}
          </select>
        </label>
        <label className="setting">
          <span>
            <strong>Off-route threshold</strong>
            <span className="muted small">Distance from the route before “left the route” is reported (widened automatically for poor GPS accuracy).</span>
          </span>
          <select value={settings.offRouteThreshold} onChange={(e) => update({ offRouteThreshold: Number(e.target.value) })}>
            {[40, 60, 100, 150, 300].map((m) => <option key={m} value={m}>{m} m</option>)}
          </select>
        </label>
      </section>

      <section className="card">
        <h2>Developer</h2>
        <Toggle
          label="Simulation Mode"
          hint="Shows and routes around clearly labelled DEMO hazards, and lets you move a simulated position. Never use during a real emergency."
          checked={settings.simulationMode}
          onChange={(v) => update({ simulationMode: v })}
        />
        {settings.simulationMode && <Banner tone="sim" title="Simulation Mode is ON">All simulated data is labelled “SIMULATION”. Simulated hazards are not real incidents.</Banner>}
        <Toggle label="Show debug panel" hint="Raw latitude/longitude, GPS accuracy and monitoring values on the map page." checked={settings.showDebug} onChange={(v) => update({ showDebug: v })} />
        <button type="button" className="btn btn-small" onClick={reset}>Reset settings</button>
      </section>

      <HazardAdmin />

      <section className="card">
        <h2>Services</h2>
        {health.loading && !health.data && <Spinner label="Checking…" />}
        <ErrorMessage error={health.error} title="Server unreachable" onRetry={health.reload} />
        {health.data && (
          <dl className="kv">
            <div><dt>API status</dt><dd>{health.data.status}</dd></div>
            <div><dt>Database</dt><dd>{health.data.database.connected ? 'Connected' : 'Unavailable'}</dd></div>
            <div><dt>Routing</dt><dd>{health.data.routing.label}{health.data.routing.supportsAvoidAreas ? ' (avoid-areas supported)' : ''}</dd></div>
            <div><dt>Weather</dt><dd>{health.data.weather.enabled ? health.data.weather.provider : 'Disabled'}</dd></div>
            <div><dt>Live traffic</dt><dd>Not available</dd></div>
            <div><dt>AI reasoning</dt><dd>{health.data.ai.enabled ? health.data.ai.model : 'Not configured (set AI_API_KEY on the server)'}</dd></div>
            <div><dt>Data retention</dt><dd>History {health.data.retention.historyDays} days · route sessions {health.data.retention.routeSessionDays} days · live GPS positions never stored</dd></div>
          </dl>
        )}
      </section>
    </div>
  );
}
