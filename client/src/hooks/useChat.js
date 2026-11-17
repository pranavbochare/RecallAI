import { useCallback, useEffect, useRef, useState } from 'react';
import { streamChat } from '../lib/api';

const storageKey = (scope) => `recallai:chat:${scope}`;

function load(scope) {
  try {
    return (JSON.parse(localStorage.getItem(storageKey(scope))) || []).map((m) => (m.status === 'streaming' ? { ...m, status: 'done' } : m));
  } catch {
    return [];
  }
}

function persist(scope, messages) {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(messages.slice(-40)));
  } catch {
    /* storage unavailable */
  }
}

let counter = 0;
const uid = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Chat state for one scope ("global" or a session id). Key the component by scope so each scope
 * gets its own state (and stored history). Answers stream in; sources arrive before the first token.
 */
export function useChat({ scope, sessionId }) {
  const [messages, setMessages] = useState(() => load(scope));
  const [busy, setBusy] = useState(false);
  const messagesRef = useRef(messages);
  const busyRef = useRef(false);
  const abortRef = useRef(null);

  useEffect(() => {
    messagesRef.current = messages;
    if (!busy) persist(scope, messages);
  }, [messages, busy, scope]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (rawQuestion) => {
      const question = rawQuestion.trim();
      if (!question || busyRef.current) return;

      const history = messagesRef.current
        .filter((m) => m.status === 'done' && m.content && !m.error)
        .slice(-8)
        .map(({ role, content }) => ({ role, content }));

      const botId = uid();
      setMessages((list) => [
        ...list,
        { id: uid(), role: 'user', content: question, status: 'done' },
        { id: botId, role: 'assistant', content: '', sources: [], cited: [], grounded: true, status: 'streaming' },
      ]);
      busyRef.current = true;
      setBusy(true);

      const patch = (fn) => setMessages((list) => list.map((m) => (m.id === botId ? fn(m) : m)));
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Tokens arrive far faster than React needs to paint: batch them per animation frame.
      let buffer = '';
      let raf = 0;
      const drain = () => {
        raf = 0;
        const text = buffer;
        buffer = '';
        if (text) patch((m) => ({ ...m, content: m.content + text }));
      };
      const settle = () => {
        if (raf) cancelAnimationFrame(raf);
        drain();
      };

      try {
        await streamChat({
          question,
          sessionId,
          history,
          signal: ctrl.signal,
          onSources: (sources) => patch((m) => ({ ...m, sources })),
          onToken: (text) => {
            buffer += text;
            if (!raf) raf = requestAnimationFrame(drain);
          },
          onDone: (info) => {
            settle();
            patch((m) => ({ ...m, status: 'done', grounded: info.grounded, cited: info.cited || [], ms: (info.retrievalMs || 0) + (info.generationMs || 0) }));
          },
          onError: (error) => {
            settle();
            patch((m) => ({ ...m, status: 'error', error }));
          },
        });
      } catch (err) {
        settle();
        if (err?.name === 'AbortError') patch((m) => ({ ...m, status: 'done', stopped: true }));
        else patch((m) => ({ ...m, status: 'error', error: { message: err.message, hint: err.hint } }));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [sessionId],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    try {
      localStorage.removeItem(storageKey(scope));
    } catch {
      /* storage unavailable */
    }
  }, [scope]);

  return { messages, busy, send, stop, clear };
}
