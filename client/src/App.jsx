import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, Link, useLocation } from 'react-router-dom';
import { AudioLines, History, LayoutDashboard, Menu, Mic, Search, Sparkles, X, TriangleAlert } from 'lucide-react';
import { useRecorder } from './hooks/useRecorder';
import { useHealth } from './hooks/useHealth';
import { formatClock } from './lib/format';
import Dashboard from './pages/Dashboard';
import Record from './pages/Record';
import Sessions from './pages/Sessions';
import SessionDetail from './pages/SessionDetail';
import Ask from './pages/Ask';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/record', label: 'Record', icon: Mic },
  { to: '/sessions', label: 'Conversations', icon: History },
  { to: '/ask', label: 'Ask AI', icon: Sparkles },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 shadow-lg shadow-indigo-900/40">
        <AudioLines className="h-[18px] w-[18px] text-white" />
      </div>
      <div className="leading-tight">
        <p className="text-[15px] font-semibold tracking-tight text-white">RecallAI</p>
        <p className="text-[11px] text-zinc-500">Conversation memory</p>
      </div>
    </Link>
  );
}

function RecordingPill({ onNavigate }) {
  const { phase, elapsedMs } = useRecorder();
  if (phase !== 'recording' && phase !== 'saving') return null;
  return (
    <Link
      to="/record"
      onClick={onNavigate}
      className="mx-3 mb-3 flex animate-pop-in items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 transition hover:bg-red-500/15"
    >
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ring-pulse rounded-full bg-red-500" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      </span>
      <span className="font-medium">{phase === 'saving' ? 'Saving…' : 'Recording'}</span>
      <span className="ml-auto font-mono text-xs tabular-nums">{formatClock(elapsedMs)}</span>
    </Link>
  );
}

function SidebarBody({ onNavigate }) {
  const { health, serverDown } = useHealth();
  const ok = health?.ready && !serverDown;
  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pb-5 pt-5">
        <Logo />
      </div>
      <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? 'bg-white/10 text-white shadow-inner' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`h-[18px] w-[18px] transition ${isActive ? 'text-indigo-300' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <RecordingPill onNavigate={onNavigate} />
      <div className="border-t border-white/5 p-3">
        <Link to="/" onClick={onNavigate} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-400 transition hover:bg-white/5">
          <span className={`h-2 w-2 rounded-full ${health == null && !serverDown ? 'bg-zinc-500' : ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          {health == null && !serverDown ? 'Checking services…' : ok ? 'All local services running' : 'Setup needed — view status'}
        </Link>
      </div>
    </div>
  );
}

function ServiceBanner() {
  const { health, serverDown } = useHealth();
  const location = useLocation();
  if (location.pathname === '/') return null; // the dashboard has the full status card
  if (!serverDown && (!health || health.ready)) return null;
  const msg = serverDown ? 'Cannot reach the RecallAI server. Start it with npm run dev.' : health.problems[0];
  return (
    <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <TriangleAlert className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{msg}</span>
      <Link to="/" className="shrink-0 font-medium underline underline-offset-2">
        Details
      </Link>
    </div>
  );
}

export default function App() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="flex h-full bg-zinc-50">
      <aside className="hidden w-60 shrink-0 bg-gradient-to-b from-ink-900 to-ink-950 lg:block">
        <SidebarBody />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-ink-950/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 animate-slide-in bg-ink-900 shadow-2xl">
            <button className="absolute right-3 top-4 rounded-lg p-1.5 text-zinc-400 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <SidebarBody onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2.5 lg:hidden">
          <button className="btn-icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">RecallAI</span>
        </header>
        <ServiceBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/record" element={<Record />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/sessions/:id" element={<SessionDetail />} />
            <Route path="/ask" element={<Ask />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
