import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, CloudOff, Loader2, Mic, MicOff, Square, TriangleAlert } from 'lucide-react';
import { LANGUAGES, useRecorder } from '../hooks/useRecorder';
import { useHealth } from '../hooks/useHealth';
import { formatClock } from '../lib/format';
import LevelMeter from '../components/LevelMeter';

function SaveIndicator({ state }) {
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    );
  }
  if (state === 'unsaved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600" title="Kept in your browser and retried automatically">
        <CloudOff className="h-3.5 w-3.5" /> Server unreachable, retrying (transcript is safe)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
      <CheckCircle2 className="h-3.5 w-3.5" /> Saved
    </span>
  );
}

export default function Record() {
  const r = useRecorder();
  const { health } = useHealth();
  const location = useLocation();
  const navigate = useNavigate();
  const endRef = useRef(null);
  const autostarted = useRef(false);

  const recording = r.phase === 'recording';
  const busy = r.phase === 'starting' || r.phase === 'saving';

  // "Quick record" from the dashboard starts immediately.
  useEffect(() => {
    if (location.state?.autostart && !autostarted.current && r.phase === 'idle' && r.supported) {
      autostarted.current = true;
      navigate('.', { replace: true, state: null });
      r.start();
    }
  }, [location.state, r, navigate]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [r.segments.length, r.interim]);

  const indexingDown = health && !health.ready;

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-4 py-6 sm:px-8 sm:py-9">
      <div className="animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Record a conversation</h1>
        <p className="mt-1 text-sm text-zinc-500">Your browser transcribes live. When you stop, RecallAI embeds and stores it so you can ask questions later.</p>
      </div>

      {!r.supported && (
        <div className="mt-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Speech recognition isn&apos;t available in this browser</p>
            <p className="mt-0.5 text-amber-800">Open RecallAI in Google Chrome or Microsoft Edge to record. You can still browse and chat with existing conversations.</p>
          </div>
        </div>
      )}

      {r.startError && (
        <div className="mt-5 flex animate-pop-in gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
          <MicOff className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">{r.startError.message}</p>
            {r.startError.hint && <p className="mt-0.5 text-red-800/90">{r.startError.hint}</p>}
          </div>
        </div>
      )}

      {indexingDown && !recording && (
        <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-sm text-blue-900">
          <p className="font-medium">You can still record.</p>
          <p className="mt-0.5 text-blue-800">{health.problems[0]} The transcript is saved immediately and can be indexed later with the Reindex button.</p>
        </div>
      )}

      <div className="card mt-6 animate-fade-up overflow-hidden" style={{ animationDelay: '60ms' }}>
        <div className="relative bg-gradient-to-b from-ink-900 to-ink-800 px-6 py-8 text-center">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgba(99,102,241,0.25),transparent)]" />
          <p className="relative font-mono text-5xl font-light tabular-nums tracking-tight text-white sm:text-6xl">{formatClock(r.elapsedMs)}</p>
          <p className="relative mt-2 flex h-5 items-center justify-center gap-2 text-sm text-zinc-400">
            {recording ? (
              <>
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                {r.listening ? 'Listening…' : 'Reconnecting…'}
              </>
            ) : r.phase === 'saving' ? (
              'Saving and indexing…'
            ) : r.phase === 'starting' ? (
              'Waiting for microphone permission…'
            ) : (
              'Ready'
            )}
          </p>

          <div className="relative mt-5">
            <LevelMeter stream={r.stream} active={recording} />
          </div>

          <div className="relative mt-5 flex items-center justify-center">
            {recording ? (
              <button onClick={() => r.stop()} className="group relative grid h-[72px] w-[72px] place-items-center rounded-full bg-red-500 text-white shadow-lg shadow-red-900/40 transition hover:bg-red-400 active:scale-95" aria-label="Stop recording">
                <span className="absolute inset-0 animate-ring-pulse rounded-full bg-red-500" />
                <Square className="relative h-6 w-6 fill-current" />
              </button>
            ) : (
              <button
                onClick={r.start}
                disabled={busy || !r.supported}
                className="grid h-[72px] w-[72px] place-items-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-lg shadow-indigo-900/50 transition hover:brightness-110 active:scale-95 disabled:opacity-50"
                aria-label="Start recording"
              >
                {busy ? <Loader2 className="h-7 w-7 animate-spin" /> : <Mic className="h-7 w-7" />}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-4 py-2.5">
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            Language
            <select
              value={r.lang}
              onChange={(e) => r.setLang(e.target.value)}
              disabled={recording || busy}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 disabled:opacity-60"
            >
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {(recording || r.segments.length > 0) && <SaveIndicator state={r.saveState} />}
        </div>
      </div>

      {r.speechError && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-amber-700">
          <TriangleAlert className="h-4 w-4" /> {r.speechError.message}
        </p>
      )}

      <section className="card mt-5 flex min-h-[14rem] flex-1 animate-fade-up flex-col overflow-hidden" style={{ animationDelay: '120ms' }} aria-label="Live transcript">
        <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-900">Live transcript</h2>
          <span className="text-xs text-zinc-400">{r.segments.length} phrase{r.segments.length === 1 ? '' : 's'}</span>
        </header>
        <div className="max-h-[26rem] min-h-0 flex-1 overflow-y-auto">
          {r.segments.length === 0 && !r.interim ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-400">{recording ? 'Start speaking: words appear here as you talk.' : 'Press the microphone button and start talking.'}</p>
          ) : (
            <ol className="divide-y divide-zinc-100">
              {r.segments.map((s) => (
                <li key={s.seq} className="flex animate-fade-in gap-4 px-4 py-2.5">
                  <span className="mt-0.5 w-14 shrink-0 font-mono text-xs tabular-nums text-zinc-400">{formatClock(s.startMs)}</span>
                  <p className="text-[14.5px] leading-relaxed text-zinc-800">{s.text}</p>
                </li>
              ))}
              {r.interim && (
                <li className="flex gap-4 px-4 py-2.5">
                  <span className="mt-0.5 w-14 shrink-0 font-mono text-xs tabular-nums text-zinc-300">···</span>
                  <p className="text-[14.5px] italic leading-relaxed text-zinc-400">{r.interim}</p>
                </li>
              )}
            </ol>
          )}
          <div ref={endRef} />
        </div>
      </section>
    </div>
  );
}
