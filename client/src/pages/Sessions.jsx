import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mic, Search, SearchX, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync } from '../hooks/useSessions';
import { useToast } from '../components/Toast';
import { useRecorder } from '../hooks/useRecorder';
import SessionCard from '../components/SessionCard';
import EmptyState from '../components/EmptyState';
import { ConfirmDialog, RenameDialog } from '../components/Modal';

export default function Sessions() {
  const toast = useToast();
  const { phase } = useRecorder();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  // Reload when a recording finishes so the new conversation appears.
  const { data, loading, error, reload } = useAsync(() => api.listSessions(debounced), [debounced, phase], {
    pollWhile: (d) => d.sessions.some((s) => s.status === 'processing'),
  });
  const sessions = data?.sessions || [];

  const rename = async (title) => {
    try {
      await api.renameSession(renaming.id, title);
      setRenaming(null);
      reload(true);
      toast.success('Renamed');
    } catch (e) {
      toast.error('Could not rename', { message: e.message });
    }
  };

  const remove = async () => {
    try {
      await api.deleteSession(deleting.id);
      setDeleting(null);
      reload(true);
      toast.success('Conversation deleted', { message: 'Its transcript and vectors were removed.' });
    } catch (e) {
      setDeleting(null);
      toast.error('Could not delete', { message: [e.message, e.hint].filter(Boolean).join('. ') });
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-9">
      <div className="flex animate-fade-up flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Conversations</h1>
          <p className="mt-1 text-sm text-zinc-500">Every recording, newest first. Open one to read the transcript or chat with it.</p>
        </div>
        <Link to="/record" className="btn-primary">
          <Mic className="h-4 w-4" />
          New recording
        </Link>
      </div>

      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input className="input pl-9 pr-9" placeholder="Search titles and transcripts…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search conversations" />
        {query && (
          <button className="btn-icon absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2" onClick={() => setQuery('')} aria-label="Clear search">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {error ? (
          <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">{error.message}</p>
            {error.hint && <p className="mt-1">{error.hint}</p>}
          </div>
        ) : loading && !data ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-32" />)
        ) : sessions.length === 0 ? (
          <div className="card">
            {debounced ? (
              <EmptyState icon={SearchX} title="No matches">Nothing matches &ldquo;{debounced}&rdquo; in any title or transcript.</EmptyState>
            ) : (
              <EmptyState
                icon={Mic}
                title="No conversations yet"
                action={
                  <Link to="/record" className="btn-primary">
                    <Mic className="h-4 w-4" />
                    Start recording
                  </Link>
                }
              >
                Recordings you make will show up here.
              </EmptyState>
            )}
          </div>
        ) : (
          sessions.map((s, i) => <SessionCard key={s.id} session={s} onRename={setRenaming} onDelete={setDeleting} delay={Math.min(i, 8) * 40} />)
        )}
      </div>

      {renaming && <RenameDialog initial={renaming.title} onSubmit={rename} onCancel={() => setRenaming(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this conversation?"
          message={`“${deleting.title}” and its ${deleting.chunkCount} indexed chunks will be permanently removed from this computer. This can't be undone.`}
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
