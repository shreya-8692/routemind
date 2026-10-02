import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs `fn` whenever `deps` change (unless `enabled` is false) and exposes
 * { data, error, loading, reload }. Stale responses are ignored.
 */
export function useAsync(fn, deps, { enabled = true, keepData = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: false });
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const id = ++run.current;
    const controller = new AbortController();
    Promise.resolve()
      .then(() => {
        if (id === run.current) setState((s) => ({ data: keepData ? s.data : null, error: null, loading: true }));
        return fnRef.current({ signal: controller.signal });
      })
      .then(
        (data) => id === run.current && setState({ data, error: null, loading: false }),
        (error) => id === run.current && error.code !== 'ABORTED' && setState((s) => ({ data: keepData ? s.data : null, error, loading: false })),
      );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
