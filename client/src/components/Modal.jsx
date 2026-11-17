import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

/** Mount it only while it should be visible; state resets on every mount. */
export function Modal({ onClose, title, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-ink-950/50 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="card relative w-full max-w-md animate-pop-in p-5 shadow-lift">
        <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn-danger" onClick={run} disabled={busy} autoFocus>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function RenameDialog({ initial, onSubmit, onCancel }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const title = value.trim();
    if (!title || title === initial) return onCancel();
    setBusy(true);
    try {
      await onSubmit(title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Rename conversation" onClose={onCancel}>
      <form onSubmit={submit}>
        <input ref={inputRef} className="input mt-3" value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoFocus aria-label="Conversation title" />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !value.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
