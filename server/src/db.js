import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

/*
 * SQLite holds session metadata and the raw transcript segments.
 * Segments are the source of truth for transcripts: they are saved while the user is still
 * speaking, so a transcript survives even if Ollama or Qdrant is down. Qdrant only holds the
 * derived, searchable index, which can always be rebuilt from here ("reindex").
 */

let db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'recording', -- recording | processing | ready | index_failed | interrupted
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  index_error  TEXT,
  indexed_at   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS segments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  start_ms    INTEGER NOT NULL,
  end_ms      INTEGER NOT NULL,
  text        TEXT NOT NULL,
  words       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
`;

export function initDb(file = config.sqlitePath) {
  if (db) return db;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  return db;
}

export function closeDb() {
  if (db) db.close();
  db = undefined;
}

const now = () => new Date().toISOString();
const countWords = (text) => (text.match(/\S+/g) || []).length;

const SESSION_SELECT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM segments g WHERE g.session_id = s.id) AS segment_count,
    (SELECT COALESCE(SUM(words), 0) FROM segments g WHERE g.session_id = s.id) AS word_count
  FROM sessions s`;

function toSession(row, { withPreview = false } = {}) {
  if (!row) return null;
  const session = {
    id: row.id,
    title: row.title,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    chunkCount: row.chunk_count,
    segmentCount: row.segment_count ?? 0,
    wordCount: row.word_count ?? 0,
    indexError: row.index_error,
    indexedAt: row.indexed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (withPreview) session.preview = (row.preview || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  return session;
}

export function defaultTitle(date = new Date()) {
  const when = date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `Recording · ${when}`;
}

// ---------------------------------------------------------------- sessions

export function createSession({ title } = {}) {
  const id = crypto.randomUUID();
  const t = now();
  db.prepare(
    `INSERT INTO sessions (id, title, status, started_at, created_at, updated_at)
     VALUES (?, ?, 'recording', ?, ?, ?)`,
  ).run(id, (title || '').trim() || defaultTitle(), t, t, t);
  return getSession(id);
}

export function getSession(id) {
  return toSession(db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id));
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function listSessions({ q = '', limit = 200 } = {}) {
  const preview = `(SELECT group_concat(text, ' ') FROM (SELECT text FROM segments WHERE session_id = s.id ORDER BY seq LIMIT 3)) AS preview`;
  const base = `SELECT s.*,
      (SELECT COUNT(*) FROM segments g WHERE g.session_id = s.id) AS segment_count,
      (SELECT COALESCE(SUM(words), 0) FROM segments g WHERE g.session_id = s.id) AS word_count,
      ${preview}
    FROM sessions s`;
  const term = q.trim();
  let rows;
  if (term) {
    const like = `%${escapeLike(term)}%`;
    rows = db
      .prepare(
        `${base}
         WHERE s.title LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM segments g WHERE g.session_id = s.id AND g.text LIKE ? ESCAPE '\\')
         ORDER BY s.started_at DESC LIMIT ?`,
      )
      .all(like, like, limit);
  } else {
    rows = db.prepare(`${base} ORDER BY s.started_at DESC LIMIT ?`).all(limit);
  }
  return rows.map((r) => toSession(r, { withPreview: true }));
}

export function renameSession(id, title) {
  db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, now(), id);
  return getSession(id);
}

export function deleteSession(id) {
  return db.prepare('DELETE FROM sessions WHERE id = ?').run(id).changes > 0;
}

/** Append transcript segments. Idempotent per (session, seq) so client retries are safe. */
export function appendSegments(sessionId, segments, durationMs = 0) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO segments (session_id, seq, start_ms, end_ms, text, words) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  let maxEnd = durationMs;
  db.exec('BEGIN');
  try {
    for (const s of segments) {
      const r = insert.run(sessionId, s.seq, s.startMs, s.endMs, s.text, countWords(s.text));
      inserted += Number(r.changes);
      maxEnd = Math.max(maxEnd, s.endMs);
    }
    db.prepare(
      `UPDATE sessions
         SET duration_ms = MAX(duration_ms, ?),
             status = CASE WHEN status = 'interrupted' THEN 'recording' ELSE status END,
             updated_at = ?
       WHERE id = ?`,
    ).run(maxEnd, now(), sessionId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return inserted;
}

export function getSegments(sessionId) {
  return db
    .prepare('SELECT seq, start_ms, end_ms, text FROM segments WHERE session_id = ? ORDER BY seq')
    .all(sessionId)
    .map((r) => ({ seq: r.seq, startMs: r.start_ms, endMs: r.end_ms, text: r.text }));
}

export function finishSession(id, durationMs = 0) {
  const t = now();
  const lastEnd = db.prepare('SELECT COALESCE(MAX(end_ms), 0) AS m FROM segments WHERE session_id = ?').get(id).m;
  db.prepare(
    `UPDATE sessions
       SET status = 'processing', index_error = NULL, ended_at = COALESCE(ended_at, ?),
           duration_ms = MAX(duration_ms, ?, ?), updated_at = ?
     WHERE id = ?`,
  ).run(t, durationMs, lastEnd, t, id);
  return getSession(id);
}

export function setProcessing(id) {
  db.prepare(`UPDATE sessions SET status = 'processing', index_error = NULL, updated_at = ? WHERE id = ?`).run(now(), id);
}

export function markIndexed(id, chunkCount) {
  const t = now();
  db.prepare(
    `UPDATE sessions SET status = 'ready', chunk_count = ?, index_error = NULL, indexed_at = ?, updated_at = ? WHERE id = ?`,
  ).run(chunkCount, t, t, id);
}

export function markIndexFailed(id, message) {
  db.prepare(`UPDATE sessions SET status = 'index_failed', index_error = ?, updated_at = ? WHERE id = ?`).run(
    String(message).slice(0, 1000),
    now(),
    id,
  );
}

/** Called on boot: nothing can still be recording or indexing after a restart. */
export function recoverStaleSessions() {
  const a = db.prepare(`UPDATE sessions SET status = 'interrupted' WHERE status = 'recording'`).run().changes;
  const b = db
    .prepare(
      `UPDATE sessions SET status = 'index_failed', index_error = 'Indexing was interrupted by a restart. Use Reindex to retry.'
       WHERE status = 'processing'`,
    )
    .run().changes;
  return { interrupted: Number(a), indexFailed: Number(b) };
}

export function getStats() {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS recordings,
              COALESCE(SUM(duration_ms), 0) AS duration_ms,
              COALESCE(SUM(chunk_count), 0) AS chunks,
              COALESCE(SUM(status = 'ready'), 0) AS ready
         FROM sessions`,
    )
    .get();
  const words = db.prepare('SELECT COALESCE(SUM(words), 0) AS w FROM segments').get().w;
  return {
    recordings: row.recordings,
    totalDurationMs: row.duration_ms,
    chunks: row.chunks,
    readyRecordings: row.ready,
    words,
  };
}
