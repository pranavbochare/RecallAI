import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Project root (the folder that contains /server, /client and /qdrant). */
export const ROOT = path.resolve(here, '..', '..');

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const env = process.env;
const num = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const trimUrl = (value, fallback) => (value || fallback).replace(/\/+$/, '');

const dataDir = env.DATA_DIR ? path.resolve(ROOT, env.DATA_DIR) : path.join(ROOT, 'data');

export const config = {
  port: num(env.PORT, 8787),
  host: env.HOST || '127.0.0.1',
  root: ROOT,
  dataDir,
  sqlitePath: env.SQLITE_PATH ? path.resolve(ROOT, env.SQLITE_PATH) : path.join(dataDir, 'recallai.sqlite'),
  clientDist: path.join(ROOT, 'client', 'dist'),

  ollama: {
    url: trimUrl(env.OLLAMA_URL, 'http://127.0.0.1:11434'),
    embedModel: env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
    llmModel: env.OLLAMA_LLM_MODEL || 'qwen2.5:1.5b',
    keepAlive: env.OLLAMA_KEEP_ALIVE || '10m',
    embedBatchSize: 16,
  },

  qdrant: {
    url: trimUrl(env.QDRANT_URL, 'http://127.0.0.1:6333'),
    apiKey: env.QDRANT_API_KEY || '',
    collection: env.QDRANT_COLLECTION || 'recallai_chunks',
  },

  // Transcript chunking (characters, not tokens: ~4 chars per token)
  chunk: {
    targetChars: num(env.CHUNK_TARGET_CHARS, 600),
    maxChars: num(env.CHUNK_MAX_CHARS, 900),
    overlapChars: num(env.CHUNK_OVERLAP_CHARS, 120),
    minChars: num(env.CHUNK_MIN_CHARS, 200),
    gapMs: num(env.CHUNK_GAP_MS, 45_000), // a long silence is treated as a topic break
  },

  rag: {
    topK: num(env.RAG_TOP_K, 6),
    minScore: num(env.RAG_MIN_SCORE, 0.3),
    historyTurns: 4,
  },
};
