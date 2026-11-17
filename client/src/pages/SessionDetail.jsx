import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Clock, Download, Layers, Loader2, Pencil, RefreshCw, SearchX, Trash2, TriangleAlert, Type } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync } from '../hooks/useSessions';
import { useToast } from '../components/Toast';
import { downloadText, formatDate, formatDuration, plural, safeFilename, transcriptText } from '../lib/format';
import ChatPanel from '../components/ChatPanel';
import TranscriptView from '../components/TranscriptView';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { ConfirmDialog, RenameDialog } from '../components/Modal';

export default function SessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [tab, setTab] = useState('transcript'); // mobile only: transcript | chat
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  const { data, loading, error, reload } = useAsync(() => api.getSession(id), [id], {
    pollWhile: (d) => d.session.status === 'processing',
  });

  const highlight = useMemo(() => {
    const start = Number(params.get('t'));
    const end = Number(params.get('e'));
    return params.has('t') && Number.isFinite(start) ? { start, end: Number.isFinite(end) && end >= start ? end : start } : null;
  }, [params]);

  if (error?.status === 404) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState icon={SearchX} title="Conversation not found" action={<Link to="/sessions" className="btn-secondary">Back to conversations</Link>}>
          It may have been deleted.
        </EmptyState>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState icon={TriangleAlert} title={error.message} action={<button className="btn-secondary" onClick={() => reload()}>Try again</button>}>
          {error.hint}
        </EmptyState>
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-8">
        <div className="skeleton h-9 w-72" />
        <div className="skeleton h-96" />
      </div>
    );
  }

  const { session, segments } = data;
  const canChat = session.status === 'ready' && session.chunkCount > 0;
  const chatBlocked =
    session.status === 'processing' || session.status === 'recording'
      ? 'This conversation is still being processed. Chat unlocks when indexing finishes.'
      : session.status === 'index_failed'
        ? 'This conversation is not indexed yet. Use Reindex above (Ollama and Qdrant must be running).'
        : session.chunkCount === 0
          ? 'There is no transcript text to chat with.'
          : session.status === 'interrupted'
            ? 'This recording was interrupted. Reindex it to chat with what was saved.'
            : undefined;

  const reindex = async () => {
    setReindexing(true);
    try {
      await api.reindexSession(session.id);
      await reload(true);
    } catch (e) {
      toast.error('Could not start indexing', { message: e.message });
    } finally {
      setReindexing(false);
    }
  };

  const rename = async (title) => {
    try {
      await api.renameSession(session.id, title);
      setRenaming(false);
      reload(true);
    } catch (e) {
      toast.error('Could not rename', { message: e.message });
    }
  };

  const remove = async () => {
    try {
      await api.deleteSession(session.id);
      toast.success('Conversation deleted');
      navigate('/sessions', { replace: true });
    } catch (e) {
      setDeleting(false);
      toast.error('Could not delete', { message: [e.message, e.hint].filter(Boolean).join('. ') });
    }
  };

  const needsIndex = session.status === 'index_failed' || session.status === 'interrupted';

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4 py-5 sm:px-8 sm:py-7">
      <Link to="/sessions" className="inline-flex w-fit items-center gap-1 text-sm text-zinc-500 transition hover:text-zinc-900">
        <ArrowLeft className="h-4 w-4" /> Conversations
      </Link>

      <header className="mt-3 flex animate-fade-up flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-900">{session.title}</h1>
            {/* <StatusBadge status={session.status} /> */}
          </div>
          <p className="mt-1 text-sm text-zinc-500">{formatDate(session.startedAt)}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="chip"><Clock className="h-3 w-3" />{formatDuration(session.durationMs)}</span>
            {/* <span className="chip"><Layers className="h-3 w-3" />{plural(session.chunkCount, 'chunk')}</span> */}
            <span className="chip"><Type className="h-3 w-3" />{plural(session.wordCount, 'word')}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {needsIndex && (
            <button className="btn-primary" onClick={reindex} disabled={reindexing}>
              {reindexing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Reindex
            </button>
          )}
          <button className="btn-secondary" onClick={() => setRenaming(true)}>
            <Pencil className="h-4 w-4" /> Rename
          </button>
          <button
            className="btn-secondary"
            disabled={segments.length === 0}
            onClick={() => downloadText(`${safeFilename(session.title)}.txt`, transcriptText(session, segments))}
          >
            <Download className="h-4 w-4" /> Export
          </button>
          <button className="btn-secondary text-red-600 hover:border-red-200 hover:bg-red-50" onClick={() => setDeleting(true)}>
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      </header>

      {session.status === 'index_failed' && session.indexError && (
        <div className="mt-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-900" role="alert">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Indexing failed, but your transcript is safe.</p>
            <p className="mt-0.5 text-red-800/90">{session.indexError}</p>
          </div>
        </div>
      )}

      <div className="mt-5 flex rounded-lg bg-zinc-200/60 p-1 lg:hidden">
        {[['transcript', 'Transcript'], ['chat', 'Chat']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`flex-1 rounded-md py-1.5 text-sm font-medium transition ${tab === key ? 'bg-white text-zinc-900 shadow-card' : 'text-zinc-500'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid min-h-0 flex-1 gap-5 lg:grid-cols-[1fr_26rem]">
        <section className={`card min-h-[20rem] animate-fade-up overflow-hidden lg:block lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto ${tab === 'transcript' ? '' : 'hidden'}`} aria-label="Transcript">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 bg-white/90 px-4 py-2.5 backdrop-blur">
            <h2 className="text-sm font-semibold text-zinc-900">Transcript</h2>
            <span className="text-xs text-zinc-400">{plural(segments.length, 'phrase')}</span>
          </div>
          <TranscriptView segments={segments} startedAt={session.startedAt} highlight={highlight} />
        </section>

        <div className={`lg:block ${tab === 'chat' ? '' : 'hidden'}`}>
          <ChatPanel
            key={session.id}
            scope={session.id}
            sessionId={session.id}
            title="Chat with this recording"
            subtitle={canChat ? 'Answers only from this conversation' : undefined}
            disabledReason={chatBlocked}
            className="h-[34rem] lg:sticky lg:top-4 lg:h-[calc(100vh-14rem)]"
            suggestions={['Summarize this conversation', 'What decisions were made?', 'List any action items or deadlines']}
          />
        </div>
      </div>

      {renaming && <RenameDialog initial={session.title} onSubmit={rename} onCancel={() => setRenaming(false)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this conversation?"
          message="The transcript and all of its indexed vectors will be permanently removed from this computer. This can't be undone."
          onConfirm={remove}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
