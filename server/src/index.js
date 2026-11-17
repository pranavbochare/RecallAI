import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import * as db from './db.js';
import * as ollama from './ollama.js';
import * as qdrant from './qdrant.js';
import { HttpError, ServiceError } from './errors.js';
import { sessionsRouter } from './routes/sessions.js';
import { chatRouter } from './routes/chat.js';
import { systemRouter } from './routes/system.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({ origin: (origin, cb) => cb(null, !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) }),
  );
  app.use(express.json({ limit: '5mb' }));

  app.use('/api', systemRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API route')));

  // Production: serve the built React app from the same port.
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next();
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: { message: err.message } });
    if (err instanceof ServiceError) {
      return res.status(err.status).json({ error: { message: err.message, hint: err.hint, service: err.service } });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { message: 'Invalid JSON body' } });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: { message: 'Request body too large' } });
    console.error('[server] unhandled error:', err);
    res.status(500).json({ error: { message: 'Internal server error' } });
  });

  return app;
}

async function main() {
  db.initDb();
  const recovered = db.recoverStaleSessions();
  if (recovered.interrupted || recovered.indexFailed) {
    console.log(`[boot] recovered sessions: ${recovered.interrupted} interrupted, ${recovered.indexFailed} unfinished indexing`);
  }

  const app = createApp();
  const server = app.listen(config.port, config.host, async () => {
    console.log(`RecallAI API listening on http://${config.host}:${config.port}`);
    const [o, q] = await Promise.all([ollama.status(), qdrant.status()]);
    console.log(`  SQLite : ${config.sqlitePath}`);
    console.log(`  Ollama : ${o.ok ? 'OK' : 'NOT REACHABLE'} (${o.url})`);
    if (o.ok && !o.embedModel.installed) console.log(`           missing model -> ollama pull ${o.embedModel.name}`);
    if (o.ok && !o.llmModel.installed) console.log(`           missing model -> ollama pull ${o.llmModel.name}`);
    console.log(`  Qdrant : ${q.ok ? `OK, ${q.points} vectors` : 'NOT REACHABLE'} (${q.url})`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${config.port} is already in use. Set PORT in .env to use another one.`);
    else console.error(err);
    process.exit(1);
  });

  const shutdown = () => {
    server.close(() => {
      db.closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
