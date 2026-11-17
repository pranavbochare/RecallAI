import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

const STYLES = {
  success: { icon: CheckCircle2, color: 'text-emerald-500' },
  error: { icon: TriangleAlert, color: 'text-red-500' },
  info: { icon: Info, color: 'text-indigo-500' },
};

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (type, title, opts = {}) => {
      const id = ++nextId.current;
      setItems((list) => [...list.slice(-3), { id, type, title, ...opts }]);
      setTimeout(() => dismiss(id), opts.duration ?? (type === 'error' ? 9000 : 5500));
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (title, opts) => push('success', title, opts),
      error: (title, opts) => push('error', title, opts),
      info: (title, opts) => push('info', title, opts),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => {
          const { icon: Icon, color } = STYLES[t.type];
          return (
            <div key={t.id} className="pointer-events-auto flex animate-slide-in items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3.5 shadow-lift">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900">{t.title}</p>
                {t.message && <p className="mt-0.5 text-sm text-zinc-500">{t.message}</p>}
                {t.action && (
                  <Link to={t.action.to} onClick={() => dismiss(t.id)} className="mt-1.5 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500">
                    {t.action.label}
                  </Link>
                )}
              </div>
              <button className="btn-icon -mr-1 -mt-1 h-7 w-7" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
