import { useState } from 'react';
import { HAZARD_SEVERITIES, HAZARD_TYPES } from '../../constants/emergency';
import { createHazard } from '../../services/routemindApi';
import { Banner, ErrorMessage } from '../common/Feedback';
import { formatCoord } from '../../utils/format';

/**
 * Hazard reporting at a map point. `simulated` creates clearly labelled test data
 * (Simulation Mode); otherwise it is an unverified user report.
 */
export default function HazardForm({ point, simulated, onCreated, onCancel }) {
  const [form, setForm] = useState({ type: 'Road Block', severity: 'High', title: '', description: '', durationHours: 1 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!point) {
    return <p className="muted">Tap the map where the hazard is located.</p>;
  }

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const hazard = await createHazard({
        type: form.type,
        severity: form.severity,
        title: (form.title.trim() || `${form.type}${simulated ? ' (simulated)' : ''}`).slice(0, 120),
        description: form.description.trim(),
        latitude: point.lat,
        longitude: point.lng,
        durationHours: Number(form.durationHours),
        source: simulated ? 'simulation' : 'user-report',
      });
      onCreated(hazard);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="hazard-form" onSubmit={submit}>
      {simulated ? (
        <Banner tone="sim" title="Simulated hazard">This is test data for Simulation Mode. It is never shown as a real incident and only affects routing while Simulation Mode is on.</Banner>
      ) : (
        <Banner tone="info" title="Report a road hazard">Your report is stored as an unverified user report and affects routing for everyone using this RouteMind server until it expires.</Banner>
      )}
      <p className="muted small mono">Location: {formatCoord(point.lat)}, {formatCoord(point.lng)}</p>
      <div className="form-grid">
        <label>
          Type
          <select value={form.type} onChange={set('type')}>
            {HAZARD_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Severity
          <select value={form.severity} onChange={set('severity')}>
            {HAZARD_SEVERITIES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="span-2">
          Title
          <input value={form.title} onChange={set('title')} maxLength={120} placeholder={`e.g. ${form.type} near junction`} />
        </label>
        <label className="span-2">
          Description (optional)
          <textarea value={form.description} onChange={set('description')} maxLength={1000} rows={2} />
        </label>
        <label>
          Expires after
          <select value={form.durationHours} onChange={set('durationHours')}>
            <option value={0.5}>30 minutes</option>
            <option value={1}>1 hour</option>
            <option value={4}>4 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>24 hours</option>
          </select>
        </label>
      </div>
      <p className="muted small">
        Road Block is always treated as impassable; Critical hazards and High flooding/fire block the road too. Other hazards add an estimated delay.
      </p>
      <ErrorMessage error={error} title="Could not save hazard" />
      <div className="btn-row">
        <button type="submit" className={`btn ${simulated ? 'btn-sim' : 'btn-primary'}`} disabled={saving}>
          {saving ? 'Saving…' : simulated ? 'Add simulated hazard' : 'Submit report'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
