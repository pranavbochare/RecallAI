import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Clock, FileAudio, Layers, Mic, MessagesSquare, Type } from "lucide-react";
import { useStats } from "../hooks/useSessions";
import { useRecorder } from "../hooks/useRecorder";
import { formatDuration, formatNumber, greeting } from "../lib/format";
import StatCard from "../components/StatCard";
import SessionCard from "../components/SessionCard";
// import SystemStatus from '../components/SystemStatus';
import EmptyState from "../components/EmptyState";

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, loading, error } = useStats();
  const { phase } = useRecorder();
  const recording = phase === "recording" || phase === "saving";

  return (
    <div className="mx-auto max-w-7xl px-4 py-7 sm:px-8 sm:py-10">
      <div className="flex animate-fade-up flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          {/* <p className="text-sm font-semibold tracking-wide text-indigo-600">{greeting()}</p> */}
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
            Your conversation memory
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-500">
            Record once, then ask questions about anything that was said.
          </p>
        </div>

        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
          <Link
            to="/ask"
            className="btn-secondary inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 sm:flex-none">
            <MessagesSquare className="h-4 w-4" />
            Ask AI
          </Link>

          <button
            className="btn-primary inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 shadow-sm sm:flex-none"
            onClick={() => navigate("/record", { state: { autostart: !recording } })}>
            <Mic className="h-4 w-4" />
            {recording ? "Back to recording" : "Quick record"}
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          icon={FileAudio}
          label="Recordings"
          value={formatNumber(data?.recordings)}
          hint={data ? `${data.readyRecordings} indexed` : undefined}
          loading={loading}
          delay={0}
        />

        <StatCard
          icon={Clock}
          label="Total duration"
          value={formatDuration(data?.totalDurationMs)}
          tone="from-violet-500 to-fuchsia-500"
          loading={loading}
          delay={60}
        />

        {/* <StatCard icon={Layers} label="Transcript chunks" value={formatNumber(data?.chunks)} hint="Vectors stored in Qdrant" tone="from-indigo-500 to-blue-500" loading={loading} delay={120} /> */}

        <StatCard
          icon={Type}
          label="Words captured"
          value={formatNumber(data?.words)}
          tone="from-sky-500 to-cyan-500"
          loading={loading}
          delay={180}
        />
      </div>

      <div className="mt-10 grid gap-8">
        <section>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-zinc-900">
                Recent conversations
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Your latest recorded and saved conversations
              </p>
            </div>

            <Link
              to="/sessions"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50 hover:text-indigo-700">
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 shadow-sm">
              <p className="font-semibold">{error.message}</p>
              {error.hint && <p className="mt-1 text-red-700/80">{error.hint}</p>}
            </div>
          ) : loading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-28 rounded-xl" />
              ))}
            </div>
          ) : data.recent.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-5 py-10 shadow-sm sm:py-14">
              <EmptyState
                icon={Mic}
                title="No recordings yet"
                action={
                  <button
                    className="btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-2.5 shadow-sm"
                    onClick={() => navigate("/record", { state: { autostart: true } })}>
                    <Mic className="h-4 w-4" />
                    Start your first recording
                  </button>
                }>
                Hit record, talk, and RecallAI will transcribe, index and remember the conversation,
                entirely on this computer.
              </EmptyState>
            </div>
          ) : (
            <div className="space-y-4">
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
