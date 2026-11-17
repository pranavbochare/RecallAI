import { Link } from 'react-router-dom';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { formatClock, formatShortDate } from '../lib/format';

/** One retrieved passage: which recording, which moment, and the text the answer is based on. */
export default function SourceCard({ source, cited, open, onToggle }) {
  const href = `/sessions/${source.sessionId}?t=${source.startMs}&e=${source.endMs}`;
  return (
    <div
      id={`source-${source.n}`}
      className={`overflow-hidden rounded-lg border text-left transition ${cited ? 'border-indigo-200 bg-indigo-50/60' : 'border-zinc-200 bg-white'}`}
    >
      <button onClick={onToggle} className="flex w-full items-start gap-2.5 p-2.5 text-left" aria-expanded={open}>
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-gradient-to-br from-blue-500 to-violet-500 text-[11px] font-semibold text-white">
          {source.n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="max-w-[16rem] truncate font-medium text-zinc-800">{source.sessionTitle}</span>
            <span className="rounded bg-white/80 px-1 font-mono text-[11px] text-indigo-700 ring-1 ring-indigo-100">
              {formatClock(source.startMs)}–{formatClock(source.endMs)}
            </span>
            <span className="text-zinc-400">{formatShortDate(source.chunkStartedAt)}</span>
            {cited && <span className="rounded bg-indigo-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Cited</span>}
          </span>
          <span className={`mt-1 block text-[13px] leading-relaxed text-zinc-600 ${open ? '' : 'line-clamp-2'}`}>{source.text}</span>
        </span>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="flex items-center justify-between border-t border-zinc-200/70 px-2.5 py-1.5 text-xs">
          <span className="text-zinc-400">Match score {source.score.toFixed(2)}</span>
          <Link to={href} className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500">
            Open at {formatClock(source.startMs)}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}
