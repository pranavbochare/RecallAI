/*
 * TEST-ONLY stand-in for an Ollama server. NOT used by the application.
 *
 * - /api/embed and /api/embeddings return deterministic bag-of-words hash vectors (768-d, like
 *   nomic-embed-text), so lexically related text lands close together. That is enough to verify
 *   the plumbing (prefixes, batching, dimension handling, filters) but says NOTHING about the
 *   retrieval quality of the real model.
 * - /api/chat streams NDJSON like Ollama does. Its "LLM" is a trivial extractive stub that quotes
 *   the best-matching excerpt; it exists to exercise prompt construction and streaming, not to
 *   judge answer quality.
 * - Models can be removed and the legacy embeddings API toggled to test error handling.
 */
import http from 'node:http';

const DIM = 768;
const STOP = new Set('a an the is are was were be been of to in on at for and or but with about what who when where which how did do does that this it its they them their he she his her we our you your i me my from by as not'.split(' '));

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const tokens = (text) =>
  (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => !STOP.has(t)).map((t) => (t.length > 3 ? t.replace(/s$/, '') : t));

export function embedText(text) {
  const v = new Array(DIM).fill(0);
  for (const t of tokens(text.replace(/^search_(document|query):\s*/, ''))) {
    const h = fnv1a(t);
    v[h % DIM] += h & 0x10000 ? 1 : -1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function startFakeOllama(port, { models = ['nomic-embed-text:latest', 'qwen2.5:1.5b'] } = {}) {
  const state = { models: [...models], legacyEmbeddings: false, embedRequests: [], chatRequests: [] };

  const json = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const installed = (name) => state.models.some((m) => m === name || m === `${name}:latest`);
  const modelMissing = (res, name) => json(res, 404, { error: `model "${name}" not found, try pulling it first` });

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const path = new URL(req.url, 'http://x').pathname;
      let body = {};
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      } catch {
        return json(res, 400, { error: 'invalid JSON' });
      }

      if (req.method === 'GET' && path === '/api/tags') return json(res, 200, { models: state.models.map((name) => ({ name, model: name })) });

      if (req.method === 'POST' && path === '/api/embed') {
        if (state.legacyEmbeddings) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('404 page not found');
        }
        if (!installed(body.model)) return modelMissing(res, body.model);
        const input = Array.isArray(body.input) ? body.input : [body.input];
        state.embedRequests.push({ model: body.model, input });
        return json(res, 200, { model: body.model, embeddings: input.map(embedText) });
      }

      if (req.method === 'POST' && path === '/api/embeddings') {
        if (!installed(body.model)) return modelMissing(res, body.model);
        state.embedRequests.push({ model: body.model, input: [body.prompt], legacy: true });
        return json(res, 200, { embedding: embedText(body.prompt) });
      }

      if (req.method === 'POST' && path === '/api/chat') {
        if (!installed(body.model)) return modelMissing(res, body.model);
        state.chatRequests.push(body);
        const user = [...body.messages].reverse().find((m) => m.role === 'user')?.content || '';
        const question = (user.match(/Question:\s*([\s\S]*)$/) || [])[1] || '';
        const excerpts = [...user.matchAll(/\[(\d+)\] [^\n]*\n([\s\S]*?)(?=\n\n\[\d+\] |\n\nQuestion:)/g)].map((m) => ({ n: m[1], text: m[2] }));

        const q = new Set(tokens(question));
        let best = null;
        for (const e of excerpts) {
          for (const sentence of e.text.match(/[^.!?]+[.!?]*/g) || []) {
            const score = tokens(sentence).filter((t) => q.has(t)).length;
            if (score > (best?.score ?? 0)) best = { score, n: e.n, sentence: sentence.trim() };
          }
        }
        const reply = best
          ? `${best.sentence} [${best.n}]`
          : "I couldn't find that in your recorded conversations.";

        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        const words = reply.split(/(?<=\s)/);
        let i = 0;
        const tick = () => {
          if (res.destroyed) return;
          if (i < words.length) {
            res.write(JSON.stringify({ model: body.model, message: { role: 'assistant', content: words[i++] }, done: false }) + '\n');
            setTimeout(tick, 2);
          } else {
            res.end(JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }) + '\n');
          }
        };
        return tick();
      }

      return json(res, 404, { error: 'not found' });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({ port, state, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) }),
    );
  });
}
