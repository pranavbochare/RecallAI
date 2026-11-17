import { CheckCircle2, CircleAlert, Database, HardDrive, Mic, RefreshCw, Cpu } from 'lucide-react';
import { useHealth } from '../hooks/useHealth';
import { useRecorder } from '../hooks/useRecorder';

function Row({ icon: Icon, name, ok, detail, hint, loading }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${loading ? 'bg-zinc-100 text-zinc-400' : ok ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-800">
          {name}
          {!loading && (ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <CircleAlert className="h-3.5 w-3.5 text-red-500" />)}
        </p>
        <p className="truncate text-xs text-zinc-500">{loading ? 'Checking…' : detail}</p>
        {!loading && !ok && hint && <p className="mt-0.5 break-words text-xs text-red-600">{hint}</p>}
      </div>
    </li>
  );
}

export default function SystemStatus() {
  const { health, serverDown, loading, refresh } = useHealth();
  const { supported } = useRecorder();
  const o = health?.ollama;
  const q = health?.qdrant;

  const ollamaHint = !o
    ? ''
    : !o.ok
      ? o.hint
      : [!o.embedModel.installed && `ollama pull ${o.embedModel.name}`, !o.llmModel.installed && `ollama pull ${o.llmModel.name}`].filter(Boolean).join('  ·  ');

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">System status</h2>
        <button className="btn-icon h-7 w-7" onClick={refresh} aria-label="Re-check" title="Re-check">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="mt-1 divide-y divide-zinc-100">
        <Row icon={Mic} name="Speech recognition" ok={supported} detail={supported ? 'Web Speech API available' : 'Not supported in this browser'} hint="Use Google Chrome or Microsoft Edge." />
        <Row
          icon={Cpu}
          name="Ollama"
          loading={loading}
          ok={Boolean(o?.ok && o.embedModel.installed && o.llmModel.installed)}
          detail={o?.ok ? `${o.embedModel.name} · ${o.llmModel.name}` : serverDown ? 'Server unreachable' : o?.error}
          hint={ollamaHint}
        />
        <Row
          icon={Database}
          name="Qdrant"
          loading={loading}
          ok={Boolean(q?.ok)}
          detail={q?.ok ? `${q.points.toLocaleString()} vectors · ${q.collection}` : serverDown ? 'Server unreachable' : q?.error}
          hint={q?.hint}
        />
        <Row icon={HardDrive} name="SQLite" loading={loading} ok={Boolean(health?.sqlite?.ok)} detail={health?.sqlite?.path || 'Session metadata'} hint="The API server is not reachable." />
      </ul>
    </div>
  );
}
