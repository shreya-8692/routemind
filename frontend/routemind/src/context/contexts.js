import { createContext, useContext } from 'react';

export const SettingsContext = createContext(null);
export const LocationContext = createContext(null);
export const EmergencyContext = createContext(null);

function useRequired(context, name) {
  const value = useContext(context);
  if (!value) throw new Error(`${name} must be used inside its provider.`);
  return value;
}

export const useSettings = () => useRequired(SettingsContext, 'useSettings');
export const useLocation = () => useRequired(LocationContext, 'useLocation');
export const useEmergency = () => useRequired(EmergencyContext, 'useEmergency');
