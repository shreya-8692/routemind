import { useId, useState } from 'react';
import { searchPlaces } from '../../services/routemindApi';
import { ErrorMessage, Spinner } from '../common/Feedback';

/** Free-text place search (OpenStreetMap Nominatim via the backend). */
export default function PlaceSearch({ near, onSelect, label = 'Search for a place', placeholder = 'e.g. hospital name, street, landmark', actionLabel = 'Go here' }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ loading: false, results: null, error: null });

  const submit = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setState({ loading: true, results: null, error: null });
    try {
      const { results } = await searchPlaces(q, near);
      setState({ loading: false, results, error: null });
    } catch (err) {
      setState({ loading: false, results: null, error: err });
    }
  };

  return (
    <div className="place-search">
      <form onSubmit={submit} className="search-row" role="search">
        <label htmlFor={id} className="sr-only">{label}</label>
        <input id={id} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} autoComplete="off" maxLength={200} />
        <button type="submit" className="btn" disabled={state.loading || query.trim().length < 2}>Search</button>
      </form>
      {state.loading && <Spinner label="Searching OpenStreetMap…" />}
      <ErrorMessage error={state.error} title="Search failed" />
      {state.results && !state.results.length && <p className="muted">No places found for “{query}”. Try a different name or select the destination on the map.</p>}
      {state.results?.length > 0 && (
        <ul className="list">
          {state.results.map((r) => (
            <li key={r.id} className="list__item">
              <div>
                <strong>{r.name}</strong>
                <div className="muted small">{r.displayName}</div>
              </div>
              <button type="button" className="btn btn-small btn-primary" onClick={() => onSelect({ lat: r.lat, lng: r.lng, name: r.name, address: r.displayName })}>
                {actionLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Search results: OpenStreetMap Nominatim.</p>
    </div>
  );
}
