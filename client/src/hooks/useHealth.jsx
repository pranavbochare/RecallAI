import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

const HealthContext = createContext(null);
export const useHealth = () => useContext(HealthContext);

/** Polls /api/health so the whole app can show whether Ollama and Qdrant are up. */
export function HealthProvider({ children }) {
  const [health, setHealth] = useState(null);
  const [serverDown, setServerDown] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setHealth(await api.health());
      setServerDown(false);
    } catch {
      setServerDown(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const value = useMemo(() => ({ health, serverDown, loading, refresh }), [health, serverDown, loading, refresh]);
  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}
