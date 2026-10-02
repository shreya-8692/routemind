import { useEffect, useRef, useState } from 'react';
import { reverseGeocode } from '../services/routemindApi';
import { haversine } from '../utils/geo';

const MIN_MOVE_M = 75;
const MIN_INTERVAL_MS = 20000;

/**
 * Readable address for a moving point. Only re-queries after the point moved
 * MIN_MOVE_M and at most every MIN_INTERVAL_MS (Nominatim allows 1 req/s total).
 */
export function useReverseGeocode(point) {
  const [state, setState] = useState({ address: null, error: null, for: null });
  const last = useRef({ point: null, at: 0 });
  const lat = point?.lat;
  const lng = point?.lng;

  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
    const target = { lat, lng };
    const prev = last.current;
    const moved = !prev.point || haversine(prev.point, target) >= MIN_MOVE_M;
    if (!moved) return undefined;
    const wait = Math.max(0, prev.at + MIN_INTERVAL_MS - Date.now());
    let cancelled = false;
    const timer = setTimeout(() => {
      last.current = { point: target, at: Date.now() };
      reverseGeocode(target)
        .then(({ result }) => {
          if (!cancelled) setState({ address: result?.shortName || null, full: result?.displayName || null, error: result ? null : 'No address found for this location.', for: target });
        })
        .catch((err) => {
          if (!cancelled) setState((s) => ({ ...s, error: `Address lookup failed: ${err.message}` }));
        });
    }, prev.point ? wait : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lat, lng]);

  return state;
}
