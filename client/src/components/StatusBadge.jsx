import { CheckCircle2, CircleAlert, Loader2, PauseCircle } from 'lucide-react';

const MAP = {
  recording: { label: 'Recording', cls: 'bg-red-50 text-red-700 ring-red-200' },
  processing: { label: 'Indexing', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  ready: { label: 'Indexed', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  index_failed: { label: 'Not indexed', cls: 'bg-red-50 text-red-700 ring-red-200' },
  interrupted: { label: 'Interrupted', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
};

function Glyph({ status }) {
  if (status === 'processing') return <Loader2 className="h-3 w-3 animate-spin" />;
  if (status === 'ready') return <CheckCircle2 className="h-3 w-3" />;
  if (status === 'index_failed') return <CircleAlert className="h-3 w-3" />;
  if (status === 'interrupted') return <PauseCircle className="h-3 w-3" />;
  return <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />;
}

export default function StatusBadge({ status }) {
  const { label, cls } = MAP[status] || MAP.ready;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      <Glyph status={status} />
      {label}
    </span>
  );
}
