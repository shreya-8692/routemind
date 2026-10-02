import { useCallback, useEffect, useState } from 'react';
import { LOCATION_REQUIRED } from '../constants/emergency';

const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
const secure = typeof window === 'undefined' || window.isSecureContext;

const ERROR_MESSAGES = {
  1: LOCATION_REQUIRED,
  2: 'Your location is currently unavailable (no GPS / network position). Move to an open area or choose your location manually.',
  3: 'Timed out while waiting for a GPS fix. Retrying in the background — you can also choose your location manually.',
};

function toPosition(pos) {
  const { latitude, longitude, accuracy, heading, speed, altitude } = pos.coords;
  return {
    lat: latitude,
    lng: longitude,
    accuracy,
    heading: Number.isFinite(heading) ? heading : null,
    speed: Number.isFinite(speed) ? speed : null,
    altitude: Number.isFinite(altitude) ? altitude : null,
    timestamp: pos.timestamp,
  };
}

/**
 * Real device location from the browser Geolocation API.
 * Takes a quick first fix with getCurrentPosition(), then follows the device
 * with watchPosition(). Nothing is ever substituted for a missing position.
 */
export function useGeolocation({ enabled, highAccuracy = true }) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const [permission, setPermission] = useState('unknown');
  const [attempt, setAttempt] = useState(0);

  // Track the permission state where the Permissions API exists (not on all mobile browsers).
  useEffect(() => {
    if (!navigator.permissions?.query) return undefined;
    let status;
    let cancelled = false;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((s) => {
        if (cancelled) return;
        status = s;
        setPermission(s.state);
        s.onchange = () => setPermission(s.state);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, []);

  // Start when asked to, or straight away if the browser already granted permission earlier (no prompt).
  const active = enabled || permission === 'granted';

  useEffect(() => {
    if (!active || !supported || !secure) return undefined;
    const onSuccess = (pos) => {
      setPosition(toPosition(pos));
      setError(null);
    };
    const onError = (err) => {
      // A timeout while we already have a fix is not fatal: keep the last position.
      setError({ code: err.code, message: ERROR_MESSAGES[err.code] || 'Unable to determine your location.' });
      if (err.code === 1) setPermission('denied');
    };
    const options = { enableHighAccuracy: highAccuracy, maximumAge: 5000, timeout: 20000 };
    navigator.geolocation.getCurrentPosition(onSuccess, onError, { ...options, maximumAge: 30000 });
    const id = navigator.geolocation.watchPosition(onSuccess, onError, options);
    return () => navigator.geolocation.clearWatch(id);
  }, [active, highAccuracy, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  let status = 'idle';
  let effectiveError = error;
  if (!supported) {
    status = 'unsupported';
    effectiveError = { code: 0, message: 'This browser does not support location services. Choose your location manually.' };
  } else if (!secure) {
    status = 'insecure';
    effectiveError = {
      code: 0,
      message: 'Browsers only share location over HTTPS (or localhost). Open RouteMind via https:// or choose your location manually.',
    };
  } else if (active) {
    if (error?.code === 1) status = 'denied';
    else if (position) status = error ? 'stale' : 'active';
    else if (error) status = 'error';
    else status = 'requesting';
  }

  return { position, error: effectiveError, status, permission, retry, active, supported: supported && secure };
}
