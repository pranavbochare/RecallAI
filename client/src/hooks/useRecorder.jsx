import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { clearPending, loadAllPending, savePending } from '../lib/pending';
import { useToast } from '../components/Toast';
import { useSpeechRecognition } from './useSpeechRecognition';

/*
 * App-wide recorder. It lives above the router, so a recording keeps going while the user browses
 * other pages, and it is the single place that guarantees transcripts are saved:
 *
 *   speech result -> in-memory queue + localStorage -> POST /segments every 4s (idempotent by seq)
 *   stop          -> flush (3 tries) -> POST /finish -> server chunks, embeds (Ollama), stores (Qdrant)
 *
 * If the server is unreachable the queue stays in localStorage and is uploaded on the next app start.
 */

const RecorderContext = createContext(null);
export const useRecorder = () => useContext(RecorderContext);

const AUTOSAVE_MS = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const LANGUAGES = [
  ['en-US', 'English (US)'],
  ['en-IN', 'English (India)'],
  ['en-GB', 'English (UK)'],
  ['hi-IN', 'Hindi'],
  ['mr-IN', 'Marathi'],
  ['es-ES', 'Spanish'],
  ['fr-FR', 'French'],
  ['de-DE', 'German'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['ja-JP', 'Japanese'],
];

function initialLang() {
  try {
    const saved = localStorage.getItem('recallai:lang');
    if (saved) return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = navigator.language || 'en-US';
  return LANGUAGES.some(([code]) => code === nav) ? nav : 'en-US';
}

export function RecorderProvider({ children }) {
  const toast = useToast();
  const navigate = useNavigate();

  const [phase, setPhase] = useState('idle'); // idle | starting | recording | saving
  const [segments, setSegments] = useState([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [saveState, setSaveState] = useState('saved'); // saved | saving | unsaved
  const [sessionId, setSessionId] = useState(null);
  const [startError, setStartError] = useState(null);
  const [lang, setLangState] = useState(initialLang);

  // Mutable recording state. A ref (not React state) so async callbacks never see stale values.
  const rt = useRef({ id: null, epoch: 0, seq: 0, queue: [], chain: Promise.resolve(true), phase: 'idle' });

  const setPhaseBoth = useCallback((p) => {
    rt.current.phase = p;
    setPhase(p);
  }, []);

  const onSegment = useCallback(({ text, startMs, endMs }) => {
    const r = rt.current;
    if (!r.id) return;
    const segment = { seq: r.seq++, startMs: Math.round(startMs), endMs: Math.round(endMs), text };
    r.queue.push(segment);
    setSegments((prev) => [...prev, segment]);
    setSaveState('saving');
    savePending(r.id, { segments: r.queue, durationMs: Date.now() - r.epoch });
  }, []);

  const speech = useSpeechRecognition({ lang, onSegment });
  const { requestMic, releaseMic, start: startRecognition, stop: stopRecognition } = speech;

  /** Uploads whatever is queued. Calls are serialized so batches never overlap. Resolves true when the queue is empty. */
  const flush = useCallback(() => {
    const r = rt.current;
    r.chain = r.chain.then(async () => {
      if (!r.id) return true;
      if (r.queue.length === 0) return true;
      const batch = r.queue.slice();
      try {
        await api.appendSegments(r.id, batch, Date.now() - r.epoch);
        r.queue.splice(0, batch.length);
        if (r.queue.length === 0) clearPending(r.id);
        else savePending(r.id, { segments: r.queue, durationMs: Date.now() - r.epoch });
        setSaveState(r.queue.length === 0 ? 'saved' : 'saving');
        return true;
      } catch {
        setSaveState('unsaved');
        return false;
      }
    });
    return r.chain;
  }, []);

  // Autosave while recording.
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const id = setInterval(flush, AUTOSAVE_MS);
    return () => clearInterval(id);
  }, [phase, flush]);

  // Timer.
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const tick = () => setElapsedMs(Date.now() - rt.current.epoch);
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase]);

  // Last-ditch save when the tab is hidden or closed (keepalive lets the request outlive the page).
  useEffect(() => {
    const save = () => {
      const r = rt.current;
      if (r.phase !== 'recording' || !r.id || r.queue.length === 0) return;
      api.appendSegments(r.id, r.queue.slice(), Date.now() - r.epoch, { keepalive: true }).catch(() => {});
    };
    const onHide = () => document.visibilityState === 'hidden' && save();
    const onBeforeUnload = (e) => {
      if (rt.current.phase === 'recording') {
        save();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  // On startup: upload transcripts a previous tab could not (crash, offline, server down).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let recovered = 0;
      for (const [id, entry] of Object.entries(loadAllPending())) {
        if (cancelled || id === rt.current.id) continue;
        try {
          if (entry.segments?.length) await api.appendSegments(id, entry.segments, entry.durationMs || 0);
          if (entry.finish) await api.finishSession(id, entry.durationMs || 0);
          clearPending(id);
          recovered += 1;
        } catch (err) {
          if (err.status === 404 || err.status === 409) clearPending(id); // session deleted or already finalized
        }
      }
      if (recovered && !cancelled) {
        toast.info('Recovered an unsaved transcript', { message: 'It was stored in your browser and has now been saved.', action: { label: 'Open conversations', to: '/sessions' } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const start = useCallback(async () => {
    const r = rt.current;
    if (r.phase !== 'idle') return;
    setStartError(null);
    setPhaseBoth('starting');
    try {
      await requestMic(); // fail early, before creating a session, with a precise reason
      const { session } = await api.createSession();
      Object.assign(r, { id: session.id, epoch: Date.now(), seq: 0, queue: [], chain: Promise.resolve(true) });
      setSessionId(session.id);
      setSegments([]);
      setElapsedMs(0);
      setSaveState('saved');
      startRecognition(r.epoch);
      setPhaseBoth('recording');
    } catch (err) {
      releaseMic();
      setStartError({ message: err.message, hint: err.hint || '' });
      setPhaseBoth('idle');
    }
  }, [requestMic, releaseMic, startRecognition, setPhaseBoth]);

  const stop = useCallback(
    async (reason = 'user') => {
      const r = rt.current;
      if (r.phase !== 'recording') return;
      setPhaseBoth('saving');
      await stopRecognition(); // delivers the final phrase
      releaseMic();

      const id = r.id;
      const durationMs = Date.now() - r.epoch;
      setElapsedMs(durationMs);

      if (r.seq === 0) {
        // Nothing was said: do not leave an empty recording behind.
        api.deleteSession(id).catch(() => {});
        clearPending(id);
        r.id = null;
        setSessionId(null);
        setPhaseBoth('idle');
        toast.info('No speech was captured', { message: 'The empty recording was discarded. Check your microphone and try again.' });
        return;
      }

      let flushed = false;
      for (let attempt = 0; attempt < 3 && !flushed; attempt++) {
        flushed = await flush();
        if (!flushed) await sleep(700 * (attempt + 1));
      }
      let finished = false;
      if (flushed) {
        for (let attempt = 0; attempt < 3 && !finished; attempt++) {
          try {
            await api.finishSession(id, durationMs);
            finished = true;
          } catch {
            await sleep(700 * (attempt + 1));
          }
        }
      }

      if (finished) {
        clearPending(id);
      } else {
        savePending(id, { segments: r.queue, durationMs, finish: true });
      }

      r.id = null;
      setPhaseBoth('idle');
      if (finished) {
        navigate(`/sessions/${id}`);
        if (reason === 'error') toast.error('Recording stopped early', { message: 'Your transcript so far was saved.' });
      } else {
        toast.error('Could not reach the server', {
          message: 'Your transcript is stored in this browser and will be saved automatically the next time RecallAI opens.',
          duration: 15000,
        });
      }
    },
    [stopRecognition, releaseMic, flush, navigate, toast, setPhaseBoth],
  );

  // A fatal speech error (permission revoked, no mic, service down) ends the recording but keeps the transcript.
  const fatal = speech.error?.fatal ? speech.error : null;
  useEffect(() => {
    if (fatal && rt.current.phase === 'recording') {
      toast.error(fatal.message, { message: fatal.hint, duration: 12000 });
      stop('error');
    }
  }, [fatal, stop, toast]);

  const setLang = useCallback((code) => {
    setLangState(code);
    try {
      localStorage.setItem('recallai:lang', code);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const value = useMemo(
    () => ({
      phase,
      segments,
      elapsedMs,
      saveState,
      sessionId,
      startError,
      lang,
      setLang,
      start,
      stop,
      supported: speech.supported,
      interim: speech.interim,
      listening: speech.listening,
      speechError: speech.error && !speech.error.fatal ? speech.error : null,
      stream: speech.stream,
    }),
    [phase, segments, elapsedMs, saveState, sessionId, startError, lang, setLang, start, stop, speech.supported, speech.interim, speech.listening, speech.error, speech.stream],
  );

  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}
