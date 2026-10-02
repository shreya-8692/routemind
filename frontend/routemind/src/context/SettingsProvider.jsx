import { useCallback, useEffect, useMemo, useState } from 'react';
import { SettingsContext } from './contexts';
import { local } from '../utils/storage';

const KEY = 'routemind.settings';

const DEFAULT_SETTINGS = {
  simulationMode: false,
  highAccuracy: true,
  monitorIntervalSec: 10,
  offRouteThreshold: 60,
  autoReroute: true,
  showDebug: false,
};

export default function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...local.get(KEY, {}) }));

  useEffect(() => local.set(KEY, settings), [settings]);

  const update = useCallback((patch) => setSettings((s) => ({ ...s, ...patch })), []);
  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
