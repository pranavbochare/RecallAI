import { useEffect, useRef } from 'react';
import { FileText } from 'lucide-react';
import { formatClock, wallClock } from '../lib/format';
import EmptyState from './EmptyState';

/** Full transcript with a timestamp per phrase. `highlight` ({ start, end } in ms) marks a retrieved passage. */
export default function TranscriptView({ segments, startedAt, highlight }) {
  const firstHit = useRef(null);
  const hitKey = highlight ? `${highlight.start}-${highlight.end}` : '';

  useEffect(() => {
    if (hitKey) firstHit.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [hitKey, segments.length]);

  if (segments.length === 0) {
    return <EmptyState icon={FileText} title="No transcript yet">Nothing was captured in this recording.</EmptyState>;
  }

  let marked = false;
  return (
    <ol className="divide-y divide-zinc-100">
      {segments.map((s) => {
        const hit = highlight && s.endMs >= highlight.start && s.startMs <= highlight.end;
        const attachRef = hit && !marked;
        if (attachRef) marked = true;
        return (
          <li
            key={s.seq}
            ref={attachRef ? firstHit : undefined}
            className={`flex gap-4 px-4 py-2.5 transition-colors ${hit ? 'bg-indigo-50' : 'hover:bg-zinc-50/70'}`}
          >
            <span
              className={`mt-0.5 w-14 shrink-0 select-none font-mono text-xs tabular-nums ${hit ? 'font-semibold text-indigo-700' : 'text-zinc-400'}`}
              title={wallClock(startedAt, s.startMs)}
            >
              {formatClock(s.startMs)}
            </span>
            <p className="text-[14.5px] leading-relaxed text-zinc-800">{s.text}</p>
          </li>
        );
      })}
    </ol>
  );
}
