import crypto from 'node:crypto';
import { config } from './config.js';
import { ServiceError } from './errors.js';

const { url: BASE, apiKey, collection: COLLECTION } = config.qdrant;

let collectionReady = false;

function unreachable(cause) {
  return new ServiceError('qdrant', `Cannot reach Qdrant at ${BASE}`, {
    hint: 'Start Qdrant (npm run qdrant, or run qdrant.exe) and try again',
    cause,
  });
}

/** Low-level REST call. Returns { status, json } and never throws on HTTP errors. */
async function request(path, { method = 'GET', body, timeoutMs = 20_000 } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (apiKey) headers['api-key'] = apiKey;
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw unreachable(err);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* plain-text error body */
  }
  return { status: res.status, ok: res.ok, json, text };
}

const errorText = (r) => r.json?.status?.error || r.json?.error || r.text || `HTTP ${r.status}`;
const isCollectionMissing = (r) => r.status === 404 && /collection/i.test(errorText(r)) && /not found|doesn't exist/i.test(errorText(r));

function must(r, what) {
  if (!r.ok) throw new ServiceError('qdrant', `Qdrant ${what} failed (${r.status}): ${String(errorText(r)).slice(0, 300)}`, { status: 502 });
  return r;
}

/** Deterministic UUID per (session, chunk) so re-indexing overwrites instead of duplicating. */
export function pointId(sessionId, chunkIndex) {
  const h = crypto.createHash('sha1').update(`${sessionId}:${chunkIndex}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function ensureCollection(dim) {
  if (collectionReady) return;
  const path = `/collections/${COLLECTION}`;
  const existing = await request(path);
  if (existing.ok) {
    const vectors = existing.json?.result?.config?.params?.vectors;
    const size = vectors?.size;
    if (typeof size === 'number' && size !== dim) {
      throw new ServiceError('qdrant', `Collection "${COLLECTION}" stores ${size}-dimension vectors but the embedding model produces ${dim}`, {
        hint: 'You changed the embedding model. Delete the collection (or set QDRANT_COLLECTION to a new name) and reindex your sessions',
        status: 409,
      });
    }
    collectionReady = true;
    return;
  }
  if (!isCollectionMissing(existing)) must(existing, 'collection lookup');

  const created = await request(path, {
    method: 'PUT',
    body: { vectors: { size: dim, distance: 'Cosine' }, on_disk_payload: true },
  });
  if (!created.ok && created.status !== 409) must(created, 'collection creation');

  // Index the field we filter on so single-session search stays fast on large collections.
  must(
    await request(`${path}/index?wait=true`, { method: 'PUT', body: { field_name: 'session_id', field_schema: 'keyword' } }),
    'payload index creation',
  );
  collectionReady = true;
}

export async function upsertPoints(points) {
  const BATCH = 64;
  for (let i = 0; i < points.length; i += BATCH) {
    const body = { points: points.slice(i, i + BATCH) };
    let r = await request(`/collections/${COLLECTION}/points?wait=true`, { method: 'PUT', body });
    if (isCollectionMissing(r)) {
      collectionReady = false; // collection was removed behind our back
      await ensureCollection(points[0].vector.length);
      r = await request(`/collections/${COLLECTION}/points?wait=true`, { method: 'PUT', body });
    }
    must(r, 'upsert');
  }
}

const sessionFilter = (sessionId) => ({ must: [{ key: 'session_id', match: { value: sessionId } }] });

export async function deleteSession(sessionId) {
  const r = await request(`/collections/${COLLECTION}/points/delete?wait=true`, {
    method: 'POST',
    body: { filter: sessionFilter(sessionId) },
  });
  if (isCollectionMissing(r)) return; // nothing was ever indexed
  must(r, 'delete');
}

/** Returns [{ id, score, payload }] sorted by similarity. */
export async function search(vector, { limit = 6, sessionId, minScore } = {}) {
  const filter = sessionId ? sessionFilter(sessionId) : undefined;
  const common = { limit, with_payload: true, filter, score_threshold: minScore };

  let r = await request(`/collections/${COLLECTION}/points/query`, { method: 'POST', body: { query: vector, ...common } });
  if (isCollectionMissing(r)) return [];
  if (r.status === 404 || r.status === 405) {
    // Qdrant older than 1.10 has no Query API; fall back to the classic search endpoint.
    r = await request(`/collections/${COLLECTION}/points/search`, { method: 'POST', body: { vector, ...common } });
    if (isCollectionMissing(r)) return [];
    must(r, 'search');
    return r.json?.result || [];
  }
  must(r, 'search');
  return r.json?.result?.points || [];
}

export async function countPoints(sessionId) {
  const r = await request(`/collections/${COLLECTION}/points/count`, {
    method: 'POST',
    body: { exact: true, filter: sessionId ? sessionFilter(sessionId) : undefined },
  });
  if (isCollectionMissing(r)) return 0;
  return must(r, 'count').json?.result?.count ?? 0;
}

export async function status() {
  try {
    const r = await request('/collections', { timeoutMs: 4000 });
    if (!r.ok) throw new ServiceError('qdrant', `Qdrant returned ${r.status}`, { status: 502 });
    const info = await request(`/collections/${COLLECTION}`, { timeoutMs: 4000 });
    return {
      ok: true,
      url: BASE,
      collection: COLLECTION,
      exists: info.ok,
      points: info.ok ? (info.json?.result?.points_count ?? 0) : 0,
    };
  } catch (err) {
    return { ok: false, url: BASE, collection: COLLECTION, exists: false, points: 0, error: err.message, hint: err.hint || 'Start Qdrant and refresh' };
  }
}

export const collectionName = COLLECTION;
export const resetCollectionCache = () => {
  collectionReady = false;
};
