import { useEffect, useRef } from 'react';
import { monitorRoute } from '../services/routemindApi';

/**
 * Route monitoring loop. While `active`, sends the current position and the
 * route being followed to the backend every `intervalSec` seconds (and as soon
 * as monitoring starts). The backend checks distance from the route, remaining
 * distance / ETA, arrival and active hazards ahead.
 *
 * Inputs are read through a ref so position updates do not restart the timer.
 */
export function useRouteMonitor({ active, intervalSec, getInput, onResult, onError }) {
  const latest = useRef({ getInput, onResult, onError });
  useEffect(() => {
    latest.current = { getInput, onResult, onError };
  });

  useEffect(() => {
    if (!active) return undefined;
    let inFlight = false;
    let stopped = false;
    const tick = async () => {
      if (inFlight || stopped) return;
      const input = latest.current.getInput();
      if (!input) return;
      inFlight = true;
      try {
        const result = await monitorRoute(input);
        if (!stopped) latest.current.onResult(result, input);
      } catch (err) {
        if (!stopped) latest.current.onError(err);
      } finally {
        inFlight = false;
      }
    };
    tick();
    const id = setInterval(tick, Math.max(3, intervalSec) * 1000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active, intervalSec]);
}
