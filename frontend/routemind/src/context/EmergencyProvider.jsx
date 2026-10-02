import { useCallback, useEffect, useRef, useState } from 'react';
import { EmergencyContext, useLocation, useSettings } from './contexts';
import { useRouteMonitor } from '../hooks/useRouteMonitor';
import * as api from '../services/routemindApi';
import { session as sessionStore } from '../utils/storage';

const KEY = 'routemind.trip';

const EMPTY_TRIP = {
  emergencyType: null,
  destination: null, // { lat, lng, name, address } chosen by the user; null = agent picks nearest suitable facility
  plan: null,
  selectedRouteId: null,
  emergencyRequestId: null,
  sessionId: null,
  status: 'idle',
  startedAt: null,
  rerouteCount: 0,
  events: [],
};

const MAX_EVENTS = 30;

function event(type, message) {
  return { type, message, at: new Date().toISOString() };
}

function defaultRouteId(plan) {
  return plan.recommendedRouteId || plan.evaluation?.evaluations?.[0]?.routeId || plan.routes?.[0]?.id || null;
}

export default function EmergencyProvider({ children }) {
  const { settings } = useSettings();
  const { origin } = useLocation();
  const [trip, setTrip] = useState(() => ({ ...EMPTY_TRIP, ...sessionStore.get(KEY, {}) }));
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState(null);
  const [monitor, setMonitor] = useState({ last: null, error: null, offRoute: false, routeUpdate: null });
  const busy = useRef(false);
  const handledHazards = useRef(new Set());

  useEffect(() => {
    // Monitoring state is not restored after a reload: the user restarts it explicitly.
    const persisted = trip.status === 'monitoring' || trip.status === 'rerouting' ? { ...trip, status: 'ready' } : trip;
    sessionStore.set(KEY, persisted);
  }, [trip]);

  const pushEvent = useCallback((type, message) => {
    setTrip((t) => ({ ...t, events: [event(type, message), ...t.events].slice(0, MAX_EVENTS) }));
  }, []);

  const selectedRoute = trip.plan?.routes.find((r) => r.id === trip.selectedRouteId) || null;
  const selectedEvaluation = trip.plan?.evaluation?.evaluations.find((e) => e.routeId === trip.selectedRouteId) || null;

  // ----- trip lifecycle -----

  const startTrip = useCallback((emergencyType) => {
    handledHazards.current = new Set();
    setPlanError(null);
    setMonitor({ last: null, error: null, offRoute: false, routeUpdate: null });
    setTrip({ ...EMPTY_TRIP, emergencyType, startedAt: new Date().toISOString(), events: [event('start', 'Emergency route session started.')] });
  }, []);

  const setEmergencyType = useCallback((emergencyType) => {
    setTrip((t) => ({ ...t, emergencyType }));
  }, []);

  const applyPlan = useCallback((response, { rerouted = false, reason } = {}) => {
    const { plan } = response;
    (plan.hazards || []).forEach((h) => handledHazards.current.add(String(h.id)));
    setTrip((t) => ({
      ...t,
      plan,
      destination: plan.destination,
      selectedRouteId: defaultRouteId(plan),
      emergencyRequestId: response.emergencyRequestId || t.emergencyRequestId,
      sessionId: response.sessionId || t.sessionId,
      rerouteCount: rerouted ? t.rerouteCount + 1 : t.rerouteCount,
      status: rerouted && t.status === 'rerouting' ? 'monitoring' : t.status === 'monitoring' ? 'monitoring' : 'ready',
      events: [
        event(
          rerouted ? 'reroute' : 'plan',
          plan.recommendedRouteId
            ? `${rerouted ? 'Route recalculated' : 'Route calculated'}${reason ? ` (${reason})` : ''}: ${plan.evaluation.recommendedRoute}, ${plan.evaluation.distanceText}, ${plan.evaluation.estimatedTimeText}.`
            : 'No viable route: every candidate passes a reported blocking hazard.',
        ),
        ...(response.persisted === false && response.note ? [event('warning', response.note)] : []),
        ...t.events,
      ].slice(0, MAX_EVENTS),
    }));
  }, []);

  /** Plan a route from the current origin. destination=null lets the agent choose the nearest suitable facility. */
  const planRoute = useCallback(
    async (destination = null) => {
      if (busy.current) return;
      if (!origin) {
        setPlanError({ message: 'Your starting location is not known yet. Allow location access or choose a starting point.' });
        return;
      }
      if (!trip.emergencyType) {
        setPlanError({ message: 'Select an emergency type first.' });
        return;
      }
      busy.current = true;
      setPlanning(true);
      setPlanError(null);
      setTrip((t) => ({ ...t, destination, status: t.status === 'monitoring' ? 'monitoring' : 'planning' }));
      try {
        const response = await api.calculateRoute({
          emergencyType: trip.emergencyType,
          origin,
          destination,
          includeSimulated: settings.simulationMode,
          emergencyRequestId: trip.emergencyRequestId,
        });
        applyPlan(response);
      } catch (err) {
        setPlanError(err);
        setTrip((t) => ({ ...t, status: t.plan ? (t.status === 'planning' ? 'ready' : t.status) : 'idle' }));
      } finally {
        busy.current = false;
        setPlanning(false);
      }
    },
    [origin, trip.emergencyType, trip.emergencyRequestId, settings.simulationMode, applyPlan],
  );

  /** Recalculate from the current position to the current destination. */
  const recalculate = useCallback(
    async (reason = 'Recalculation requested', { hazard = false } = {}) => {
      if (busy.current || !trip.plan || !origin) return false;
      busy.current = true;
      setPlanning(true);
      setPlanError(null);
      setTrip((t) => ({ ...t, status: t.status === 'monitoring' ? 'rerouting' : t.status }));
      setMonitor((m) => ({ ...m, routeUpdate: { phase: 'calculating', reason, hazard }, offRoute: false }));
      try {
        const response = await api.recalculateRoute({
          emergencyType: trip.emergencyType,
          origin,
          destination: trip.plan.destination,
          includeSimulated: settings.simulationMode,
          emergencyRequestId: trip.emergencyRequestId,
          reason,
        });
        applyPlan(response, { rerouted: true, reason });
        const ev = response.plan.evaluation;
        setMonitor((m) => ({
          ...m,
          routeUpdate: {
            phase: ev.allRoutesBlocked ? 'blocked' : 'done',
            reason,
            hazard,
            message: ev.allRoutesBlocked
              ? 'No alternative avoids every reported blocking hazard. Consider another destination.'
              : `New route: ${ev.recommendedRoute} — ${ev.distanceText}, ${ev.estimatedTimeText}.`,
          },
        }));
        return true;
      } catch (err) {
        setPlanError(err);
        setMonitor((m) => ({ ...m, routeUpdate: { phase: 'failed', reason, hazard, message: err.message } }));
        setTrip((t) => ({ ...t, status: t.status === 'rerouting' ? 'monitoring' : t.status }));
        return false;
      } finally {
        busy.current = false;
        setPlanning(false);
      }
    },
    [trip.plan, trip.emergencyType, trip.emergencyRequestId, origin, settings.simulationMode, applyPlan],
  );

  const selectRoute = useCallback(
    (routeId) => {
      const route = trip.plan?.routes.find((r) => r.id === routeId);
      const ev = trip.plan?.evaluation.evaluations.find((e) => e.routeId === routeId);
      if (!route) return;
      setTrip((t) => ({ ...t, selectedRouteId: routeId }));
      if (trip.emergencyRequestId) {
        api
          .updateEmergencyRequest(trip.emergencyRequestId, {
            route: { label: route.label, provider: route.provider, summary: route.summary || '', riskLevel: ev?.riskLevel },
            estimatedTime: ev?.adjustedDuration ?? route.duration,
            distance: route.distance,
          })
          .catch(() => {});
      }
    },
    [trip.plan, trip.emergencyRequestId],
  );

  const setRequestStatus = useCallback(
    (status) => {
      if (trip.emergencyRequestId) api.updateEmergencyRequest(trip.emergencyRequestId, { status }).catch(() => {});
    },
    [trip.emergencyRequestId],
  );

  const startMonitoring = useCallback(() => {
    if (!selectedRoute) return;
    setMonitor({ last: null, error: null, offRoute: false, routeUpdate: null });
    setTrip((t) => ({ ...t, status: 'monitoring', events: [event('monitor', 'Route monitoring started.'), ...t.events].slice(0, MAX_EVENTS) }));
    setRequestStatus('Active');
  }, [selectedRoute, setRequestStatus]);

  const stopMonitoring = useCallback(() => {
    setTrip((t) => ({ ...t, status: t.plan ? 'ready' : 'idle', events: [event('monitor', 'Route monitoring paused.'), ...t.events].slice(0, MAX_EVENTS) }));
  }, []);

  const completeTrip = useCallback(() => {
    setRequestStatus('Completed');
    setTrip((t) => ({ ...t, status: 'completed', events: [event('complete', 'Trip marked as completed.'), ...t.events].slice(0, MAX_EVENTS) }));
  }, [setRequestStatus]);

  const cancelTrip = useCallback(() => {
    setRequestStatus('Cancelled');
    setTrip((t) => ({ ...t, status: 'cancelled', events: [event('cancel', 'Trip cancelled.'), ...t.events].slice(0, MAX_EVENTS) }));
  }, [setRequestStatus]);

  const resetTrip = useCallback(() => {
    handledHazards.current = new Set();
    setPlanError(null);
    setMonitor({ last: null, error: null, offRoute: false, routeUpdate: null });
    setTrip(EMPTY_TRIP);
  }, []);

  const clearDestination = useCallback(() => {
    setTrip((t) => ({ ...t, plan: null, destination: null, selectedRouteId: null, status: 'idle' }));
  }, []);

  const dismissRouteUpdate = useCallback(() => setMonitor((m) => ({ ...m, routeUpdate: null })), []);

  // ----- monitoring -----

  const monitoringActive = trip.status === 'monitoring' && Boolean(selectedRoute) && Boolean(origin);

  const handleMonitorResult = useCallback(
    (result) => {
      setMonitor((m) => ({ ...m, last: result, error: null, offRoute: result.status === 'off-route' }));
      if (result.status === 'arrived') {
        setRequestStatus('Completed');
        setTrip((t) => ({ ...t, status: 'arrived', events: [event('arrived', 'Arrived at the destination.'), ...t.events].slice(0, MAX_EVENTS) }));
        return;
      }
      if (result.status === 'off-route') {
        setMonitor((m) => (m.routeUpdate?.phase === 'done' ? { ...m, routeUpdate: null } : m));
        pushEvent('off-route', `Off route (${result.distanceFromRoute} m from the planned route).`);
        return;
      }
      if (result.status === 'reroute-recommended') {
        const fresh = result.hazardsAhead.filter((h) => h.blocking && !handledHazards.current.has(String(h.id)));
        if (!fresh.length) return; // Already handled: the last recalculation could not avoid it.
        fresh.forEach((h) => handledHazards.current.add(String(h.id)));
        pushEvent('hazard', result.rerouteReason);
        if (settings.autoReroute) {
          recalculate(result.rerouteReason, { hazard: true });
        } else {
          setMonitor((m) => ({ ...m, routeUpdate: { phase: 'suggested', reason: result.rerouteReason, hazard: true } }));
        }
      }
    },
    [pushEvent, recalculate, setRequestStatus, settings.autoReroute],
  );

  useRouteMonitor({
    active: monitoringActive,
    intervalSec: settings.monitorIntervalSec,
    getInput: () =>
      selectedRoute && origin
        ? {
            route: selectedRoute,
            destination: trip.plan.destination,
            position: origin,
            accuracy: origin.accuracy,
            offRouteThreshold: settings.offRouteThreshold,
            knownHazardIds: [...handledHazards.current],
            includeSimulated: settings.simulationMode,
            sessionId: trip.sessionId,
          }
        : null,
    onResult: handleMonitorResult,
    onError: (err) => setMonitor((m) => ({ ...m, error: err.message })),
  });

  const value = {
    trip,
    planning,
    planError,
    clearPlanError: () => setPlanError(null),
    monitor,
    selectedRoute,
    selectedEvaluation,
    startTrip,
    setEmergencyType,
    planRoute,
    recalculate,
    selectRoute,
    startMonitoring,
    stopMonitoring,
    completeTrip,
    cancelTrip,
    resetTrip,
    clearDestination,
    dismissRouteUpdate,
  };

  return <EmergencyContext.Provider value={value}>{children}</EmergencyContext.Provider>;
}
