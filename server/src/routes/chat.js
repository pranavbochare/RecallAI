import { Router } from 'express';
import * as db from '../db.js';
import { HttpError, describeError, ServiceError } from '../errors.js';
import { answer, retrieve } from '../services/rag.js';

export const chatRouter = Router();

function parseRequest(body) {
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question) throw new HttpError(400, 'question is required');
  if (question.length > 2000) throw new HttpError(400, 'question is too long (max 2000 characters)');

  let sessionId;
  if (body.sessionId) {
    sessionId = String(body.sessionId);
    if (!db.getSession(sessionId)) throw new HttpError(404, 'Session not found');
  }

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.trim() }));

  return { question, sessionId, history };
}

/** Retrieval only (no LLM): handy for debugging what Qdrant returns for a query. */
chatRouter.post('/search', async (req, res, next) => {
  try {
    const { question, sessionId, history } = parseRequest({ ...req.body, question: req.body?.query ?? req.body?.question });
    res.json(await retrieve({ question, sessionId, history }));
  } catch (err) {
    next(err);
  }
});

/** Server-Sent Events: `sources`, then many `token`, then `done` (or `error`). */
chatRouter.post('/', async (req, res, next) => {
  let input;
  try {
    input = parseRequest(req.body);
  } catch (err) {
    return next(err);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    for await (const event of answer({ ...input, signal: abort.signal })) {
      const { type, ...data } = event;
      send(type, data);
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error('[chat] failed:', describeError(err));
      send('error', {
        message: err instanceof ServiceError ? err.message : 'Something went wrong while answering',
        hint: err instanceof ServiceError ? err.hint : '',
        service: err instanceof ServiceError ? err.service : undefined,
      });
    }
  } finally {
    res.end();
  }
});
