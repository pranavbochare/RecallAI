import { config } from './config.js';
import { ServiceError } from './errors.js';

const { url: BASE, embedModel, llmModel, keepAlive, embedBatchSize } = config.ollama;

// nomic-embed-text was trained with task prefixes; using them noticeably improves retrieval.
const usesTaskPrefix = /^nomic-embed/i.test(embedModel);

function unreachable(cause) {
  return new ServiceError('ollama', `Cannot reach Ollama at ${BASE}`, {
    hint: 'Start Ollama (on Windows it runs from the system tray) and try again',
    cause,
  });
}

/** fetch() wrapper: timeouts, caller abort, and friendly connection errors. Returns the Response. */
async function request(path, { method = 'POST', body, signal, timeoutMs = 120_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => ctrl.abort(signal.reason);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetch(BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (ctrl.signal.aborted) {
      throw new ServiceError('ollama', `Ollama did not respond within ${Math.round(timeoutMs / 1000)}s`, {
        hint: 'The model may still be loading. Try again in a moment',
        cause: err,
      });
    }
    throw unreachable(err);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function errorMessage(res) {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text).error || text;
  } catch {
    return text;
  }
}

const isModelMissing = (res, message) => res.status === 404 && /model/i.test(message) && /not found/i.test(message);

function failureFrom(status, message, model) {
  if (isModelMissing({ status }, message)) {
    return new ServiceError('ollama', `Ollama model "${model}" is not installed`, { hint: `Run: ollama pull ${model}` });
  }
  return new ServiceError('ollama', `Ollama returned ${status}: ${String(message).slice(0, 300)}`, { status: 502 });
}

async function failure(res, model) {
  return failureFrom(res.status, await errorMessage(res), model);
}

// ------------------------------------------------------------------ embeddings

let useLegacyEmbeddings = false;

async function embedBatch(batch, signal) {
  if (!useLegacyEmbeddings) {
    const res = await request('/api/embed', { body: { model: embedModel, input: batch, keep_alive: keepAlive }, signal });
    if (res.ok) {
      const json = await res.json();
      if (!Array.isArray(json.embeddings) || json.embeddings.length !== batch.length) {
        throw new ServiceError('ollama', 'Ollama returned an unexpected embeddings response', { status: 502 });
      }
      return json.embeddings;
    }
    const message = await errorMessage(res);
    if (res.status !== 404 || isModelMissing(res, message)) throw failureFrom(res.status, message, embedModel);
    useLegacyEmbeddings = true; // older Ollama without /api/embed
  }
  const out = [];
  for (const prompt of batch) {
    const res = await request('/api/embeddings', { body: { model: embedModel, prompt, keep_alive: keepAlive }, signal });
    if (!res.ok) throw await failure(res, embedModel);
    out.push((await res.json()).embedding);
  }
  return out;
}

async function embed(texts, signal) {
  const out = [];
  for (let i = 0; i < texts.length; i += embedBatchSize) {
    out.push(...(await embedBatch(texts.slice(i, i + embedBatchSize), signal)));
  }
  return out;
}

export const embedDocuments = (texts, { signal } = {}) =>
  embed(usesTaskPrefix ? texts.map((t) => `search_document: ${t}`) : texts, signal);

export const embedQuery = async (text, { signal } = {}) =>
  (await embed([usesTaskPrefix ? `search_query: ${text}` : text], signal))[0];

// ------------------------------------------------------------------------ chat

/** Streams the assistant's reply as text fragments. */
export async function* chatStream(messages, { signal } = {}) {
  const res = await request('/api/chat', {
    body: {
      model: llmModel,
      messages,
      stream: true,
      keep_alive: keepAlive,
      options: { temperature: 0.1, top_p: 0.9, num_ctx: 4096, num_predict: 600 },
    },
    signal,
    timeoutMs: 240_000, // first call may need to load the model from disk
  });
  if (!res.ok) throw await failure(res, llmModel);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = function* (line) {
    if (!line.trim()) return;
    let json;
    try {
      json = JSON.parse(line);
    } catch {
      return;
    }
    if (json.error) throw new ServiceError('ollama', String(json.error), { status: 502 });
    if (json.message?.content) yield json.message.content;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        yield* handle(line);
      }
    }
    yield* handle(buffer);
  } catch (err) {
    if (signal?.aborted || err instanceof ServiceError) throw err;
    throw unreachable(err);
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ---------------------------------------------------------------------- status

const hasModel = (names, wanted) =>
  names.some((n) => n === wanted || n === `${wanted}:latest` || (!wanted.includes(':') && n.startsWith(`${wanted}:`)));

export async function status() {
  try {
    const res = await request('/api/tags', { method: 'GET', timeoutMs: 4000 });
    if (!res.ok) throw new ServiceError('ollama', `Ollama returned ${res.status}`, { status: 502 });
    const names = ((await res.json()).models || []).map((m) => m.name || m.model);
    return {
      ok: true,
      url: BASE,
      embedModel: { name: embedModel, installed: hasModel(names, embedModel) },
      llmModel: { name: llmModel, installed: hasModel(names, llmModel) },
    };
  } catch (err) {
    return {
      ok: false,
      url: BASE,
      error: err.message,
      hint: err.hint || 'Start Ollama and refresh',
      embedModel: { name: embedModel, installed: false },
      llmModel: { name: llmModel, installed: false },
    };
  }
}

export const models = { embedModel, llmModel };
