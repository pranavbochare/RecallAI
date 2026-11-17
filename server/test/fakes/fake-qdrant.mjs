/*
 * TEST-ONLY stand-in for a Qdrant server. NOT used by the application.
 *
 * It speaks the subset of Qdrant's REST API that RecallAI uses and mirrors the real server's
 * strictness where it matters (UUID/uint point ids, vector dimension checks, 404 shapes for a
 * missing collection, exact cosine similarity, `must/match` filters), so that the tests catch
 * protocol mistakes in server/src/qdrant.js. It does not replace testing against real Qdrant:
 * run `npm run doctor` for that.
 */
import http from 'node:http';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function startFakeQdrant(port, { collections = new Map() } = {}) {
  const log = [];

  const envelope = (result) => ({ result, status: 'ok', time: 0.0005 });
  const fail = (res, code, message) => send(res, code, { status: { error: message }, time: 0.0001 });
  const send = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const missing = (res, name) => fail(res, 404, `Not found: Collection \`${name}\` doesn't exist!`);

  const matches = (payload, filter) =>
    !filter || (filter.must || []).every((c) => c.match && payload?.[c.key] === c.match.value);

  const cosine = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  };

  function rank(col, body) {
    const vector = body.query ?? body.vector;
    if (!Array.isArray(vector)) return { error: 'Format error in JSON body: query vector missing' };
    if (vector.length !== col.size) return { error: `Wrong input: Vector dimension error: expected dim: ${col.size}, got ${vector.length}` };
    const hits = [];
    for (const [id, p] of col.points) {
      if (!matches(p.payload, body.filter)) continue;
      const score = cosine(vector, p.vector);
      if (body.score_threshold !== undefined && body.score_threshold !== null && score < body.score_threshold) continue;
      hits.push({ id, version: 1, score, payload: body.with_payload ? p.payload : undefined });
    }
    hits.sort((a, b) => b.score - a.score);
    return { hits: hits.slice(0, body.limit ?? 10) };
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const path = url.pathname;
      let body = {};
      if (chunks.length) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          return fail(res, 400, 'Format error in JSON body: invalid JSON');
        }
      }
      log.push(`${req.method} ${path}`);

      if (req.method === 'GET' && path === '/') return send(res, 200, { title: 'qdrant - vector search engine', version: '1.x-fake' });
      if (req.method === 'GET' && path === '/collections') {
        return send(res, 200, envelope({ collections: [...collections.keys()].map((name) => ({ name })) }));
      }

      const m = path.match(/^\/collections\/([^/]+)(?:\/(.*))?$/);
      if (!m) return send(res, 404, '404 page not found');
      const name = decodeURIComponent(m[1]);
      const sub = m[2] || '';
      const col = collections.get(name);

      if (sub === '') {
        if (req.method === 'GET') {
          if (!col) return missing(res, name);
          return send(res, 200, envelope({
            status: 'green',
            points_count: col.points.size,
            config: { params: { vectors: { size: col.size, distance: col.distance } } },
          }));
        }
        if (req.method === 'PUT') {
          if (col) return fail(res, 409, `Wrong input: Collection \`${name}\` already exists!`);
          const v = body.vectors;
          if (!v || !Number.isInteger(v.size) || v.size < 1) return fail(res, 400, 'Format error in JSON body: vectors.size is required');
          if (!['Cosine', 'Dot', 'Euclid', 'Manhattan'].includes(v.distance)) return fail(res, 400, 'Format error in JSON body: unknown distance');
          collections.set(name, { size: v.size, distance: v.distance, points: new Map(), indexes: new Set() });
          return send(res, 200, envelope(true));
        }
        if (req.method === 'DELETE') {
          collections.delete(name);
          return send(res, 200, envelope(true));
        }
      }

      if (!col) return missing(res, name);

      if (sub === 'index' && req.method === 'PUT') {
        if (!body.field_name) return fail(res, 400, 'Format error in JSON body: field_name required');
        col.indexes.add(body.field_name);
        return send(res, 200, envelope({ operation_id: 1, status: 'completed' }));
      }

      if (sub === 'points' && req.method === 'PUT') {
        if (!Array.isArray(body.points)) return fail(res, 400, 'Format error in JSON body: points missing');
        for (const p of body.points) {
          const okId = (Number.isInteger(p.id) && p.id >= 0) || (typeof p.id === 'string' && UUID.test(p.id));
          if (!okId) return fail(res, 400, `Format error in JSON body: value ${JSON.stringify(p.id)} is not a valid point ID, valid values are either an unsigned integer or a UUID`);
          if (!Array.isArray(p.vector) || p.vector.length !== col.size) {
            return fail(res, 400, `Wrong input: Vector dimension error: expected dim: ${col.size}, got ${p.vector?.length}`);
          }
        }
        for (const p of body.points) col.points.set(p.id, { vector: p.vector, payload: p.payload || {} });
        return send(res, 200, envelope({ operation_id: 2, status: 'completed' }));
      }

      if (sub === 'points/query' && req.method === 'POST') {
        const r = rank(col, body);
        if (r.error) return fail(res, 400, r.error);
        return send(res, 200, envelope({ points: r.hits }));
      }
      if (sub === 'points/search' && req.method === 'POST') {
        const r = rank(col, body);
        if (r.error) return fail(res, 400, r.error);
        return send(res, 200, envelope(r.hits));
      }
      if (sub === 'points/delete' && req.method === 'POST') {
        if (!body.filter && !body.points) return fail(res, 400, 'Format error in JSON body: filter or points required');
        for (const [id, p] of [...col.points]) if (body.filter ? matches(p.payload, body.filter) : body.points.includes(id)) col.points.delete(id);
        return send(res, 200, envelope({ operation_id: 3, status: 'completed' }));
      }
      if (sub === 'points/count' && req.method === 'POST') {
        const count = [...col.points.values()].filter((p) => matches(p.payload, body.filter)).length;
        return send(res, 200, envelope({ count }));
      }
      if (sub === 'points/scroll' && req.method === 'POST') {
        const points = [...col.points].filter(([, p]) => matches(p.payload, body.filter)).map(([id, p]) => ({ id, payload: p.payload }));
        return send(res, 200, envelope({ points: points.slice(0, body.limit ?? 10), next_page_offset: null }));
      }

      return send(res, 404, '404 page not found');
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({
        port,
        collections,
        log,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
      }),
    );
  });
}
