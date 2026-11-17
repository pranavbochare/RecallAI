import { Router } from 'express';
import * as db from '../db.js';
import * as ollama from '../ollama.js';
import * as qdrant from '../qdrant.js';
import { config } from '../config.js';

export const systemRouter = Router();

systemRouter.get('/health', async (_req, res) => {
  const [o, q] = await Promise.all([ollama.status(), qdrant.status()]);
  const problems = [];
  if (!o.ok) problems.push(`Ollama is not reachable at ${o.url}`);
  else {
    if (!o.embedModel.installed) problems.push(`Missing embedding model. Run: ollama pull ${o.embedModel.name}`);
    if (!o.llmModel.installed) problems.push(`Missing chat model. Run: ollama pull ${o.llmModel.name}`);
  }
  if (!q.ok) problems.push(`Qdrant is not reachable at ${q.url}`);
  res.json({
    ready: problems.length === 0,
    problems,
    sqlite: { ok: true, path: config.sqlitePath },
    ollama: o,
    qdrant: q,
  });
});

systemRouter.get('/stats', (_req, res) => {
  res.json({ ...db.getStats(), recent: db.listSessions({ limit: 5 }) });
});
