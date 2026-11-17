import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/** Loads a list from the API and keeps polling while any session is still being indexed. */
export function useAsync(loader, deps, { pollWhile } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await loaderRef.current();
      setState({ data, loading: false, error: null });
      return data;
    } catch (error) {
      setState((s) => ({ data: silent ? s.data : null, loading: false, error }));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const shouldPoll = Boolean(state.data && pollWhile?.(state.data));
  useEffect(() => {
    if (!shouldPoll) return undefined;
    const id = setInterval(() => reload(true), 1500);
    return () => clearInterval(id);
  }, [shouldPoll, reload]);

  return { ...state, reload };
}

export const useStats = () =>
  useAsync(() => api.stats(), [], { pollWhile: (d) => d.recent.some((s) => s.status === 'processing' || s.status === 'recording') });
