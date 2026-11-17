import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Clock, FileAudio, Layers, Mic, MessagesSquare, Type } from 'lucide-react';
import { useStats } from '../hooks/useSessions';
import { useRecorder } from '../hooks/useRecorder';
import { formatDuration, formatNumber, greeting } from '../lib/format';
import StatCard from '../components/StatCard';
import SessionCard from '../components/SessionCard';
import SystemStatus from '../components/SystemStatus';
import EmptyState from '../components/EmptyState';

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, loading, error } = useStats();
  const { phase } = useRecorder();
  const recording = phase === 'recording' || phase === 'saving';

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-9">
      <div className="flex animate-fade-up flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-indigo-600">{greeting()}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">Your conversation memory</h1>
          <p className="mt-1 text-sm text-zinc-500">Record once, then ask questions about anything that was said.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/ask" className="btn-secondary">
            <MessagesSquare className="h-4 w-4" />
            Ask AI
          </Link>
          <button className="btn-primary" onClick={() => navigate('/record', { state: { autostart: !recording } })}>
            <Mic className="h-4 w-4" />
            {recording ? 'Back to recording' : 'Quick record'}
          </button>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={FileAudio} label="Recordings" value={formatNumber(data?.recordings)} hint={data ? `${data.readyRecordings} indexed` : undefined} loading={loading} delay={0} />
        <StatCard icon={Clock} label="Total duration" value={formatDuration(data?.totalDurationMs)} tone="from-violet-500 to-fuchsia-500" loading={loading} delay={60} />
        <StatCard icon={Layers} label="Transcript chunks" value={formatNumber(data?.chunks)} hint="Vectors stored in Qdrant" tone="from-indigo-500 to-blue-500" loading={loading} delay={120} />
        <StatCard icon={Type} label="Words captured" value={formatNumber(data?.words)} tone="from-sky-500 to-cyan-500" loading={loading} delay={180} />
      </div>

      <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Recent conversations</h2>
            <Link to="/sessions" className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {error ? (
            <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-medium">{error.message}</p>
              {error.hint && <p className="mt-1 text-red-700/80">{error.hint}</p>}
            </div>
          ) : loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-28" />
              ))}
            </div>
          ) : data.recent.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Mic}
                title="No recordings yet"
                action={
                  <button className="btn-primary" onClick={() => navigate('/record', { state: { autostart: true } })}>
                    <Mic className="h-4 w-4" />
                    Start your first recording
                  </button>
                }
              >
                Hit record, talk, and RecallAI will transcribe, index and remember the conversation, entirely on this computer.
              </EmptyState>
            </div>
          ) : (
            <div className="space-y-3">
              {data.recent.map((s, i) => (
                <SessionCard key={s.id} session={s} delay={i * 50} />
              ))}
            </div>
          )}
        </section>

        {/* <aside className="space-y-4">
          <SystemStatus />
          <div className="card animate-fade-up bg-gradient-to-br from-blue-600 to-violet-700 p-4 text-white" style={{ animationDelay: '120ms' }}>
            <p className="text-sm font-semibold">100% local</p>
            <p className="mt-1 text-xs leading-relaxed text-white/80">
              Speech is transcribed by your browser, embeddings and answers come from Ollama on this machine, and vectors live in your local Qdrant. No paid APIs, no cloud database.
            </p>
          </div>
        </aside> */}
      </div>
    </div>
  );
}
