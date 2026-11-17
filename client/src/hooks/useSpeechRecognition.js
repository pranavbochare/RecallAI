import { useCallback, useEffect, useRef, useState } from 'react';

const SpeechRecognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;

export class MicError extends Error {
  constructor(message, hint = '') {
    super(message);
    this.name = 'MicError';
    this.hint = hint;
  }
}

function micErrorFrom(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new MicError(
        'Microphone access is blocked',
        'Click the lock icon in the address bar, allow the microphone for this site, and try again. On Windows also check Settings → Privacy & security → Microphone.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new MicError('No microphone found', 'Connect a microphone (or enable it in Windows Sound settings) and try again.');
    case 'NotReadableError':
    case 'AbortError':
      return new MicError('The microphone is busy', 'Close other apps that may be using it (Teams, Zoom, Discord…) and try again.');
    default:
      return new MicError('Could not access the microphone', err?.message || '');
  }
}

/**
 * Continuous speech-to-text on top of the Web Speech API.
 *
 * - Emits one segment per finalized phrase: { text, startMs, endMs } relative to `epoch`.
 * - Chrome/Edge end a session on silence or after a while; we transparently restart while the user
 *   still wants to record, and give up with a clear error if it keeps failing.
 * - Anything still "interim" when recognition ends unexpectedly is emitted rather than dropped.
 * - All exposed functions are referentially stable.
 */
export function useSpeechRecognition({ lang, onSegment }) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState(null); // { message, hint, fatal }
  const [stream, setStream] = useState(null);

  const s = useRef({
    rec: null,
    want: false,
    running: false,
    epoch: 0,
    utterStart: null,
    lastInterim: '',
    restarts: [],
    netErrors: 0,
    waiters: [],
    media: null,
  });
  const onSegmentRef = useRef(onSegment);
  const langRef = useRef(lang);
  useEffect(() => {
    onSegmentRef.current = onSegment;
    langRef.current = lang;
  });

  const releaseMic = useCallback(() => {
    s.current.media?.getTracks().forEach((t) => t.stop());
    s.current.media = null;
    setStream(null);
  }, []);

  const requestMic = useCallback(async () => {
    if (!SpeechRecognition) {
      throw new MicError('Speech recognition is not supported in this browser', 'Open RecallAI in Google Chrome or Microsoft Edge.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicError('This page cannot access the microphone', 'Open RecallAI at http://localhost:5173 (or :8787), which browsers treat as a secure context.');
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      s.current.media?.getTracks().forEach((t) => t.stop());
      s.current.media = media;
      setStream(media);
      return media;
    } catch (err) {
      throw micErrorFrom(err);
    }
  }, []);

  const emit = useCallback((text, startMs, endMs) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean) onSegmentRef.current?.({ text: clean, startMs: Math.max(0, startMs), endMs: Math.max(startMs, endMs) });
  }, []);

  const fail = useCallback((message, hint = '') => {
    const st = s.current;
    st.want = false;
    setError({ message, hint, fatal: true });
    try {
      st.rec?.abort();
    } catch {
      /* already stopped */
    }
    st.running = false;
    setListening(false);
    st.waiters.splice(0).forEach((f) => f());
  }, []);

  const create = useCallback(() => {
    const st = s.current;
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = langRef.current;

    rec.onstart = () => {
      st.running = true;
      setListening(true);
    };

    rec.onresult = (event) => {
      st.netErrors = 0;
      setError((e) => (e?.fatal ? e : null));
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        const now = Date.now() - st.epoch;
        if (result.isFinal) {
          emit(text, st.utterStart ?? now, now);
          st.utterStart = null;
          st.lastInterim = '';
        } else {
          if (st.utterStart == null) st.utterStart = now;
          interimText += `${text} `;
        }
      }
      st.lastInterim = interimText.trim();
      setInterim(st.lastInterim);
    };

    rec.onerror = (event) => {
      switch (event.error) {
        case 'no-speech':
        case 'aborted':
          return; // normal: silence, or we stopped it
        case 'not-allowed':
        case 'service-not-allowed':
          return fail(
            'Speech recognition was blocked',
            'Allow the microphone for this site. Chrome also blocks the speech service in some private or managed browser profiles.',
          );
        case 'audio-capture':
          return fail('No audio input detected', 'Check that a microphone is connected and set as the default input device.');
        case 'language-not-supported':
          return fail(`The language "${langRef.current}" is not supported`, 'Choose another language and try again.');
        case 'network':
          st.netErrors += 1;
          if (st.netErrors >= 4) {
            return fail(
              "Can't reach the browser's speech service",
              'Chrome and Edge send audio to an online speech service. Check your internet connection and try again.',
            );
          }
          return setError({ message: 'Speech service unreachable, retrying…', hint: '', fatal: false });
        default:
          return setError({ message: `Speech recognition error: ${event.error}`, hint: '', fatal: false });
      }
    };

    rec.onend = () => {
      st.running = false;
      setListening(false);
      const now = Date.now() - st.epoch;
      if (st.lastInterim) emit(st.lastInterim, st.utterStart ?? now, now); // never drop words that were not finalized
      st.lastInterim = '';
      st.utterStart = null;
      setInterim('');

      if (!st.want) {
        st.waiters.splice(0).forEach((f) => f());
        return;
      }
      // Ended on its own (silence timeout, network blip): restart, unless it is clearly stuck in a loop.
      const t = Date.now();
      st.restarts = st.restarts.filter((x) => t - x < 10_000);
      st.restarts.push(t);
      if (st.restarts.length > 8) {
        fail('Speech recognition keeps stopping', 'Check your microphone and internet connection, then start a new recording.');
        return;
      }
      setTimeout(() => {
        if (!st.want) return;
        try {
          st.rec.start();
        } catch {
          /* "already started" can be ignored */
        }
      }, 250 + st.netErrors * 600);
    };

    return rec;
  }, [emit, fail]);

  const start = useCallback(
    (epoch) => {
      const st = s.current;
      st.epoch = epoch;
      st.want = true;
      st.netErrors = 0;
      st.restarts = [];
      st.utterStart = null;
      st.lastInterim = '';
      setError(null);
      setInterim('');
      st.rec = create();
      try {
        st.rec.start();
      } catch (err) {
        fail('Could not start speech recognition', err?.message || '');
      }
    },
    [create, fail],
  );

  /** Resolves once recognition has ended and the last phrase has been delivered. */
  const stop = useCallback(
    () =>
      new Promise((resolve) => {
        const st = s.current;
        if (!st.rec || !st.want) return resolve();
        st.want = false;
        if (!st.running) {
          // Between automatic restarts: nothing is listening, so nothing more will arrive.
          const now = Date.now() - st.epoch;
          if (st.lastInterim) emit(st.lastInterim, st.utterStart ?? now, now);
          st.lastInterim = '';
          setInterim('');
          return resolve();
        }
        const timer = setTimeout(resolve, 2500);
        st.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
        try {
          st.rec.stop();
        } catch {
          clearTimeout(timer);
          resolve();
        }
      }),
    [emit],
  );

  useEffect(
    () => () => {
      const st = s.current;
      st.want = false;
      try {
        st.rec?.abort();
      } catch {
        /* noop */
      }
      st.media?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return { supported: Boolean(SpeechRecognition), listening, interim, error, stream, requestMic, releaseMic, start, stop };
}
