import * as db from '../db.js';
import * as ollama from '../ollama.js';
import * as qdrant from '../qdrant.js';
import { chunkSegments } from '../chunker.js';
import { describeError } from '../errors.js';

const running = new Set();

export const isIndexing = (sessionId) => running.has(sessionId);

/**
 * Chunk -> embed (Ollama) -> store (Qdrant) for one session.
 *
 * Order matters: we embed FIRST and only then replace the old points, so a failed embedding run
 * (Ollama down, model missing) never wipes a previously good index. The transcript itself lives
 * in SQLite and is never touched here, so any failure leaves it intact and `reindex` can retry.
 * Never throws: the outcome is recorded on the session (ready | index_failed).
 */
export async function indexSession(sessionId) {
  if (running.has(sessionId)) return;
  running.add(sessionId);
  try {
    const session = db.getSession(sessionId);
    if (!session) return;
    db.setProcessing(sessionId);

    const chunks = chunkSegments(db.getSegments(sessionId));

    if (chunks.length === 0) {
      if (session.chunkCount > 0) await qdrant.deleteSession(sessionId);
      db.markIndexed(sessionId, 0);
      return;
    }

    const vectors = await ollama.embedDocuments(chunks.map((c) => c.text));
    await qdrant.ensureCollection(vectors[0].length);
    await qdrant.deleteSession(sessionId);

    const startedMs = Date.parse(session.startedAt);
    const indexedAt = new Date().toISOString();
    await qdrant.upsertPoints(
      chunks.map((c, i) => ({
        id: qdrant.pointId(sessionId, c.index),
        vector: vectors[i],
        payload: {
          session_id: sessionId,
          chunk_index: c.index,
          text: c.text,
          start_ms: c.startMs,
          end_ms: c.endMs,
          session_started_at: session.startedAt,
          chunk_started_at: new Date(startedMs + c.startMs).toISOString(),
          chunk_ended_at: new Date(startedMs + c.endMs).toISOString(),
          word_count: (c.text.match(/\S+/g) || []).length,
          indexed_at: indexedAt,
        },
      })),
    );

    db.markIndexed(sessionId, chunks.length);
  } catch (err) {
    console.error(`[index] session ${sessionId} failed:`, describeError(err));
    if (db.getSession(sessionId)) db.markIndexFailed(sessionId, describeError(err));
  } finally {
    running.delete(sessionId);
  }
}
