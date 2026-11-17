import { Link } from 'react-router-dom';
import { Clock, Layers, Pencil, Trash2, Type } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { formatDuration, formatShortDate, plural, timeAgo } from '../lib/format';

export default function SessionCard({ session, onRename, onDelete, compact = false, delay = 0 }) {
  const empty = session.segmentCount === 0;
  return (
    <div
      className="card group relative animate-fade-up transition hover:-translate-y-px hover:border-zinc-300 hover:shadow-lift"
      style={{ animationDelay: `${delay}ms` }}
    >
      <Link to={`/sessions/${session.id}`} className="block rounded-xl p-4">
        <div className="flex items-start justify-between gap-3 pr-0 sm:pr-16">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-zinc-900">{session.title}</h3>
            <p className="mt-0.5 text-xs text-zinc-400" title={formatShortDate(session.startedAt)}>
              {timeAgo(session.startedAt)} · {formatShortDate(session.startedAt)}
            </p>
          </div>
          {/* <StatusBadge status={session.status} /> */}
        </div>

        {!compact && (
          <p className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-zinc-500">
            {session.preview || (empty ? 'No speech was captured in this recording.' : '…')}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="chip">
            <Clock className="h-3 w-3" />
            {formatDuration(session.durationMs)}
          </span>
          {/* <span className="chip">
            <Layers className="h-3 w-3" />
            {plural(session.chunkCount, 'chunk')}
          </span> */}
          <span className="chip">
            <Type className="h-3 w-3" />
            {plural(session.wordCount, 'word')}
          </span>
        </div>
      </Link>

      {(onRename || onDelete) && (
        <div className="absolute bottom-3 right-3 flex gap-0.5 opacity-100 transition sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {onRename && (
            <button className="btn-icon" onClick={() => onRename(session)} aria-label={`Rename ${session.title}`} title="Rename">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {onDelete && (
            <button className="btn-icon hover:bg-red-50 hover:text-red-600" onClick={() => onDelete(session)} aria-label={`Delete ${session.title}`} title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
