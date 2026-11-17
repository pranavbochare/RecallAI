import { config } from '../config.js';
import * as db from '../db.js';
import * as ollama from '../ollama.js';
import * as qdrant from '../qdrant.js';

export const NOT_FOUND_ANSWER = "I couldn't find that in your recorded conversations.";
export const EMPTY_LIBRARY_ANSWER =
  "You don't have any indexed recordings yet. Record a conversation first, then ask me about it.";

const SYSTEM_PROMPT = `You are RecallAI, an assistant that answers questions about the user's own recorded conversations.

Rules:
1. Use ONLY the numbered excerpts provided in the user's message. Never use outside knowledge.
2. If the excerpts do not contain the answer, reply with exactly: ${NOT_FOUND_ANSWER}
3. Cite the excerpts you used with their numbers, like [1] or [2][3], directly after the claim.
4. Be concise and factual. Never invent names, numbers, dates, or quotes.
5. The excerpts come from speech recognition and may contain small errors. Quietly interpret obvious mistakes, and say so only if it matters.
6. Answer in the same language as the question.`;

const formatWhen = (iso) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export function formatOffset(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** A short follow-up like "and who said that?" is useless to embed alone, so borrow the previous question. */
function retrievalQuery(question, history) {
  const words = question.trim().split(/\s+/).length;
  if (words <= 6) {
    const previous = [...history].reverse().find((m) => m.role === 'user');
    if (previous) return `${previous.content} ${question}`.slice(-600);
  }
  return question;
}

export async function retrieve({ question, sessionId, history = [], signal }) {
  const t0 = Date.now();
  const vector = await ollama.embedQuery(retrievalQuery(question, history), { signal });
  const hits = await qdrant.search(vector, {
    limit: config.rag.topK,
    sessionId,
    minScore: config.rag.minScore,
  });

  const titles = new Map();
  const sources = [];
  for (const hit of hits) {
    const p = hit.payload || {};
    if (!titles.has(p.session_id)) titles.set(p.session_id, db.getSession(p.session_id));
    const session = titles.get(p.session_id);
    if (!session) continue; // stale vector for a session that no longer exists
    sources.push({
      sessionId: p.session_id,
      sessionTitle: session.title,
      sessionStartedAt: p.session_started_at,
      chunkIndex: p.chunk_index,
      startMs: p.start_ms,
      endMs: p.end_ms,
      chunkStartedAt: p.chunk_started_at,
      score: Number(hit.score.toFixed(4)),
      text: p.text,
    });
  }

  // Number excerpts chronologically so the model (and the user) read them in the order they happened.
  sources.sort((a, b) => a.sessionStartedAt.localeCompare(b.sessionStartedAt) || a.startMs - b.startMs);
  sources.forEach((s, i) => (s.n = i + 1));
  return { sources, retrievalMs: Date.now() - t0 };
}

function buildMessages({ question, sources, history }) {
  const context = sources
    .map(
      (s) =>
        `[${s.n}] "${s.sessionTitle}" - recorded ${formatWhen(s.sessionStartedAt)}, at ${formatOffset(s.startMs)} into the recording\n${s.text}`,
    )
    .join('\n\n');

  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const m of history.slice(-config.rag.historyTurns * 2)) {
    // Citation numbers from old turns would point at excerpts that are no longer in context.
    messages.push({ role: m.role, content: m.content.replace(/\[\d+\]/g, '').slice(0, 800) });
  }
  messages.push({
    role: 'user',
    content: `Excerpts from recorded conversations:\n\n${context}\n\nQuestion: ${question}`,
  });
  return messages;
}

const citedNumbers = (answer) => [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))];

function looksLikeNotFound(answer) {
  const text = answer.replace(/[‘’]/g, "'").trim();
  return text.length < 220 && /\b(couldn'?t|could not|can'?t|cannot|unable to|did not|didn'?t) (find|locate)\b/i.test(text);
}

/**
 * Full RAG turn as an async event stream:
 *   { type: 'sources', sources }  - retrieved chunks (before the answer starts)
 *   { type: 'token', text }       - answer fragments
 *   { type: 'done', grounded, cited, ... }
 */
export async function* answer({ question, sessionId, history = [], signal }) {
  const { sources, retrievalMs } = await retrieve({ question, sessionId, history, signal });

  if (sources.length === 0) {
    const empty = !sessionId && db.getStats().chunks === 0;
    yield { type: 'sources', sources: [] };
    yield { type: 'token', text: empty ? EMPTY_LIBRARY_ANSWER : NOT_FOUND_ANSWER };
    yield { type: 'done', grounded: false, cited: [], retrievalMs, generationMs: 0, model: null };
    return;
  }

  yield { type: 'sources', sources };

  const t1 = Date.now();
  let text = '';
  for await (const fragment of ollama.chatStream(buildMessages({ question, sources, history }), { signal })) {
    text += fragment;
    yield { type: 'token', text: fragment };
  }

  const grounded = !looksLikeNotFound(text);
  const cited = grounded ? citedNumbers(text).filter((n) => n >= 1 && n <= sources.length) : [];
  yield {
    type: 'done',
    grounded,
    cited,
    retrievalMs,
    generationMs: Date.now() - t1,
    model: ollama.models.llmModel,
  };
}
