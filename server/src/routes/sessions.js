import { Router } from 'express';
import * as db from '../db.js';
import * as qdrant from '../qdrant.js';
import { HttpError } from '../errors.js';
import { indexSession, isIndexing } from '../services/ingest.js';

export const sessionsRouter = Router();

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requireSession(id) {
  const session = db.getSession(id);
  if (!session) throw new HttpError(404, 'Session not found');
  return session;
}

function cleanTitle(value) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'title must be a non-empty string');
  return value.trim().slice(0, 120);
}

function parseSegments(input) {
  if (!Array.isArray(input) || input.length === 0) throw new HttpError(400, 'segments must be a non-empty array');
  if (input.length > 500) throw new HttpError(400, 'Too many segments in one request (max 500)');
  return input.map((s, i) => {
    const seq = Number(s?.seq);
    const startMs = Number(s?.startMs);
    const endMs = s?.endMs === undefined ? startMs : Number(s.endMs);
    const text = typeof s?.text === 'string' ? s.text.replace(/\s+/g, ' ').trim() : '';
    if (!Number.isInteger(seq) || seq < 0) throw new HttpError(400, `segments[${i}].seq must be a non-negative integer`);
    if (!Number.isFinite(startMs) || startMs < 0) throw new HttpError(400, `segments[${i}].startMs must be a number >= 0`);
    if (!Number.isFinite(endMs) || endMs < startMs) throw new HttpError(400, `segments[${i}].endMs must be >= startMs`);
    if (!text) throw new HttpError(400, `segments[${i}].text is empty`);
    return { seq, startMs: Math.round(startMs), endMs: Math.round(endMs), text: text.slice(0, 5000) };
  });
}

sessionsRouter.get('/', (req, res) => {
  res.json({ sessions: db.listSessions({ q: String(req.query.q || '') }) });
});

sessionsRouter.post('/', (req, res) => {
  const title = req.body?.title === undefined ? undefined : cleanTitle(req.body.title);
  res.status(201).json({ session: db.createSession({ title }) });
});

sessionsRouter.get('/:id', (req, res) => {
  const session = requireSession(req.params.id);
  res.json({ session, segments: db.getSegments(session.id) });
});

sessionsRouter.patch('/:id', (req, res) => {
  requireSession(req.params.id);
  res.json({ session: db.renameSession(req.params.id, cleanTitle(req.body?.title)) });
});

sessionsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const session = requireSession(req.params.id);
    if (isIndexing(session.id)) throw new HttpError(409, 'This session is being indexed right now. Try again in a moment');
    // Remove vectors first and refuse if that fails, so a deleted conversation never lingers in the index.
    if (session.chunkCount > 0 || session.status === 'index_failed') await qdrant.deleteSession(session.id);
    db.deleteSession(session.id);
    res.json({ ok: true });
  }),
);

sessionsRouter.post('/:id/segments', (req, res) => {
  const session = requireSession(req.params.id);
  if (session.status === 'processing') throw new HttpError(409, 'Session is already being finalized');
  const segments = parseSegments(req.body?.segments);
  const inserted = db.appendSegments(session.id, segments, Number(req.body?.durationMs) || 0);
  res.json({ ok: true, inserted, session: db.getSession(session.id) });
});

// Ends a recording and indexes it in the background. Poll GET /:id until status leaves "processing".
sessionsRouter.post('/:id/finish', (req, res) => {
  const session = requireSession(req.params.id);
  if (session.status === 'processing') return res.status(202).json({ session });
  const finished = db.finishSession(session.id, Math.max(0, Number(req.body?.durationMs) || 0));
  void indexSession(session.id);
  res.status(202).json({ session: finished });
});

sessionsRouter.post('/:id/reindex', (req, res) => {
  const session = requireSession(req.params.id);
  if (session.status === 'processing' || session.status === 'recording') {
    return res.status(202).json({ session });
  }
  db.setProcessing(session.id);
  void indexSession(session.id);
  res.status(202).json({ session: db.getSession(session.id) });
});
