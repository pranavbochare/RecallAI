export class ApiError extends Error {
  constructor(message, { status = 0, hint = '', service } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.hint = hint;
    this.service = service;
  }
}

const unreachable = () =>
  new ApiError('Cannot reach the RecallAI server', {
    hint: 'Make sure it is running (npm run dev) and refresh the page.',
  });

async function request(method, path, body, { keepalive = false, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive,
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw unreachable();
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(e?.message || `Request failed (${res.status})`, { status: res.status, hint: e?.hint, service: e?.service });
  }
  return data;
}

export const api = {
  health: () => request('GET', '/health'),
  stats: () => request('GET', '/stats'),
  listSessions: (q = '') => request('GET', `/sessions${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getSession: (id) => request('GET', `/sessions/${id}`),
  createSession: (title) => request('POST', '/sessions', title ? { title } : {}),
  renameSession: (id, title) => request('PATCH', `/sessions/${id}`, { title }),
  deleteSession: (id) => request('DELETE', `/sessions/${id}`),
  appendSegments: (id, segments, durationMs, opts) => request('POST', `/sessions/${id}/segments`, { segments, durationMs }, opts),
  finishSession: (id, durationMs) => request('POST', `/sessions/${id}/finish`, { durationMs }),
  reindexSession: (id) => request('POST', `/sessions/${id}/reindex`, {}),
};

/**
 * Streams a RAG answer over Server-Sent Events (fetch + ReadableStream, because EventSource cannot POST).
 * Callbacks: onSources(sources), onToken(text), onDone(info), onError({message, hint}).
 */
export async function streamChat({ question, sessionId, history, signal, onSources, onToken, onDone, onError }) {
  let res;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, sessionId, history }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw unreachable();
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.error?.message || `Request failed (${res.status})`, { status: res.status, hint: data?.error?.hint });
  }

  const dispatch = (event, data) => {
    if (event === 'sources') onSources?.(data.sources);
    else if (event === 'token') onToken?.(data.text);
    else if (event === 'done') onDone?.(data);
    else if (event === 'error') onError?.(data);
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  const parse = (block) => {
    const event = block.match(/^event: (.+)$/m)?.[1];
    const raw = block.match(/^data: (.+)$/m)?.[1];
    if (!event || !raw) return;
    try {
      dispatch(event, JSON.parse(raw));
      if (event === 'done' || event === 'error') finished = true;
    } catch {
      /* ignore malformed frame */
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      parse(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  if (buffer.trim()) parse(buffer);
  if (!finished) onError?.({ message: 'The connection closed before the answer finished', hint: 'Check that Ollama is still running.' });
}
