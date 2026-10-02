import { useCallback, useEffect, useState } from 'react';
import { LocationContext, useSettings } from './contexts';
import { useGeolocation } from '../hooks/useGeolocation';
import { useReverseGeocode } from '../hooks/useReverseGeocode';
import { session } from '../utils/storage';

const KEY = 'routemind.location';

/**
 * Where the trip starts from. Priority:
 *   1. a simulated position (Simulation Mode only, always labelled),
 *   2. the real device position from the Geolocation API,
 *   3. a location the user chose manually (map click or search) — the fallback
 *      when permission is denied or GPS is unavailable, or by explicit choice.
 * There is no built-in default location.
 */
export default function LocationProvider({ children }) {
  const { settings } = useSettings();
  const saved = session.get(KEY, {});
  const [enabled, setEnabled] = useState(Boolean(saved.enabled));
  const [manualOrigin, setManualOriginState] = useState(saved.manualOrigin || null);
  const [preferManual, setPreferManual] = useState(Boolean(saved.preferManual));
  const [simulatedPosition, setSimulatedPosition] = useState(null);

  const gps = useGeolocation({ enabled, highAccuracy: settings.highAccuracy });

  useEffect(() => session.set(KEY, { enabled, manualOrigin, preferManual }), [enabled, manualOrigin, preferManual]);

  const start = useCallback(() => setEnabled(true), []);
  const setManualOrigin = useCallback((point) => {
    setManualOriginState(point ? { lat: point.lat, lng: point.lng, name: point.name || null, address: point.address || null } : null);
    setPreferManual(Boolean(point));
  }, []);
  const { retry } = gps;
  const switchToDeviceLocation = useCallback(() => {
    setPreferManual(false);
    setEnabled(true);
    retry();
  }, [retry]);

  let origin = null;
  if (settings.simulationMode && simulatedPosition) {
    origin = { ...simulatedPosition, source: 'simulated', accuracy: null };
  } else if (!preferManual && gps.position) {
    origin = { ...gps.position, source: 'gps' };
  } else if (manualOrigin) {
    origin = { ...manualOrigin, source: 'manual', accuracy: null };
  }

  const geocode = useReverseGeocode(origin);
  const address = origin?.source === 'manual' && origin.address ? origin.address : geocode.address;

  const value = {
    origin: origin ? { ...origin, address: address || null } : null,
    gps,
    enabled: gps.active,
    start,
    manualOrigin,
    setManualOrigin,
    preferManual,
    switchToDeviceLocation,
    simulatedPosition: settings.simulationMode ? simulatedPosition : null,
    setSimulatedPosition,
    geocodeError: geocode.error,
  };

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}
