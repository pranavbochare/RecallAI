/*
 * End-to-end test of the RecallAI backend.
 *
 * The real Express server runs as a child process, using its real SQLite file and its real
 * Qdrant / Ollama REST clients. Only the two external servers are stand-ins (test/fakes/*), because
 * Ollama and Qdrant are not installed in CI. See those files for what they do and do not prove.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeQdrant } from './fakes/fake-qdrant.mjs';
import { startFakeOllama } from './fakes/fake-ollama.mjs';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTS = { app: 18787, app2: 18788, qdrant: 16333, ollama: 21434 };
const COLLECTION = 'recallai_test';
const NOT_FOUND = "I couldn't find that in your recorded conversations.";

let fq, fo, app, dataDir;

// ------------------------------------------------------------------ helpers

function startApp({ port = PORTS.app, collection = COLLECTION, dir = dataDir } = {}) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dir,
      OLLAMA_URL: `http://127.0.0.1:${PORTS.ollama}`,
      QDRANT_URL: `http://127.0.0.1:${PORTS.qdrant}`,
      QDRANT_COLLECTION: collection,
      RAG_MIN_SCORE: '0.15', // stand-in embedder: relevant pairs score 0.3-0.55, unrelated pairs are hash noise (<0.1)
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${logs.join('')}`)), 10_000);
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/stats`);
        if (r.ok) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve({ child, port, logs, base: `http://127.0.0.1:${port}`, stop: () => stopChild(child) });
        }
      } catch { /* not up yet */ }
    }, 100);
    child.once('exit', (code) => reject(new Error(`server exited (${code}):\n${logs.join('')}`)));
  });
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 3000).unref();
  });
}

const call = async (a, method, p, body) => {
  const res = await fetch(a.base + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json };
};

async function waitFor(a, id, wanted, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { json } = await call(a, 'GET', `/api/sessions/${id}`);
    if (wanted.includes(json.session.status)) return json;
    if (Date.now() > deadline) throw new Error(`session ${id} stuck in "${json.session.status}" (wanted ${wanted})`);
    await new Promise((r) => setTimeout(r, 60));
  }
}

async function ask(a, body) {
  const res = await fetch(`${a.base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const events = [];
  for (const block of (await res.text()).split('\n\n')) {
    const ev = block.match(/^event: (.+)$/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
  }
  const tokens = events.filter((e) => e.event === 'token');
  return {
    events,
    sources: events.find((e) => e.event === 'sources')?.data.sources ?? [],
    answer: tokens.map((e) => e.data.text).join(''),
    tokenCount: tokens.length,
    done: events.find((e) => e.event === 'done')?.data,
    error: events.find((e) => e.event === 'error')?.data,
  };
}

async function record(a, title, segments) {
  const { json } = await call(a, 'POST', '/api/sessions', { title });
  const id = json.session.id;
  const r = await call(a, 'POST', `/api/sessions/${id}/segments`, { segments: segments.map(([startMs, text], seq) => ({ seq, startMs, endMs: startMs + 4000, text })) });
  assert.equal(r.status, 200);
  return id;
}

async function scroll(id) {
  const res = await fetch(`http://127.0.0.1:${PORTS.qdrant}/collections/${COLLECTION}/points/scroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter: { must: [{ key: 'session_id', match: { value: id } }] }, limit: 100, with_payload: true }),
  });
  return (await res.json()).result.points;
}

const TEAM_SYNC = [
  [0, "Okay everyone, let's get started with the weekly project sync."],
  [6000, 'First topic is the Falcon launch. We had planned for February 28 but the payment gateway integration is behind schedule.'],
  [16000, 'So the new launch date for Falcon is March 14, and Anita will announce it to the customers tomorrow.'],
  [27000, 'Any concerns about that date? Rohan said the support team needs at least ten days of training before launch.'],
  [37000, 'That works, training starts March 3 so we have eleven days.'],
  [45000, 'Great. Next topic is the database migration.'],
  [52000, 'Priya owns the database migration and she expects to finish the staging migration by Friday.'],
  [63000, 'The production cutover will happen on a Sunday night to keep downtime under thirty minutes.'],
  [74000, 'Priya also asked for read replicas to be provisioned before the cutover, and Dev will handle the replica setup.'],
  [86000, "OK, that's the engineering side."],
  // 74 seconds of silence -> topic break
  [160000, 'Now the budget. The marketing budget for this quarter is forty five thousand dollars.'],
  [170000, 'Rohan wants to cut it by ten percent and move the money to customer support hiring.'],
  [182000, 'Anita disagrees because the Falcon launch campaign needs the full amount.'],
  [194000, 'We agreed to revisit the budget in the next sync after the finance review on Thursday.'],
  [205000, 'Last thing, the team lunch is on Wednesday at the Italian place near the office.'],
  [213000, "Alright thanks everyone, that's all for today."],
];

const LANDLORD = [
  [0, 'Hello Mr. Deshmukh, thanks for calling me back about the flat.'],
  [5000, 'Yes, as per the new agreement the monthly rent will increase to twenty two thousand rupees from next month.'],
  [15000, "That's an increase of two thousand rupees compared to the current rent."],
  [24000, 'Also the plumbing leak in the bathroom will be repaired on Tuesday morning, the plumber will come around ten.'],
  [36000, 'Please keep the maintenance deposit of five thousand rupees ready by the end of the month.'],
  [46000, 'Okay I will transfer the deposit on the twenty eighth. Thank you.'],
];

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recallai-test-'));
  fq = await startFakeQdrant(PORTS.qdrant);
  fo = await startFakeOllama(PORTS.ollama);
  app = await startApp();
});

after(async () => {
  await app?.stop();
  await fo?.close();
  await fq?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// -------------------------------------------------------------------- tests

describe('recording -> indexing -> Qdrant', () => {
  let teamId, landlordId;

  test('health reports every dependency as ready', async () => {
    const { json } = await call(app, 'GET', '/api/health');
    assert.equal(json.ready, true, JSON.stringify(json.problems));
    assert.equal(json.ollama.embedModel.installed, true);
    assert.equal(json.ollama.llmModel.installed, true);
    assert.equal(json.qdrant.ok, true);
  });

  test('a recording is saved incrementally and finished into a searchable session', async () => {
    const created = await call(app, 'POST', '/api/sessions', { title: 'Team sync' });
    assert.equal(created.status, 201);
    teamId = created.json.session.id;
    assert.equal(created.json.session.status, 'recording');

    // The browser autosaves in batches; the same batch may be retried after a network blip.
    const first = TEAM_SYNC.slice(0, 8).map(([startMs, text], seq) => ({ seq, startMs, endMs: startMs + 4000, text }));
    const second = TEAM_SYNC.slice(8).map(([startMs, text], i) => ({ seq: i + 8, startMs, endMs: startMs + 4000, text }));
    assert.equal((await call(app, 'POST', `/api/sessions/${teamId}/segments`, { segments: first })).json.inserted, 8);
    assert.equal((await call(app, 'POST', `/api/sessions/${teamId}/segments`, { segments: first })).json.inserted, 0, 'retries are idempotent');
    assert.equal((await call(app, 'POST', `/api/sessions/${teamId}/segments`, { segments: second })).json.inserted, 8);

    const fin = await call(app, 'POST', `/api/sessions/${teamId}/finish`, { durationMs: 220_000 });
    assert.equal(fin.status, 202);
    const done = await waitFor(app, teamId, ['ready', 'index_failed']);
    assert.equal(done.session.status, 'ready', done.session.indexError);
    assert.equal(done.session.durationMs, 220_000);
    assert.ok(done.session.chunkCount >= 2, `expected multiple chunks, got ${done.session.chunkCount}`);
    assert.equal(done.segments.length, 16);
  });

  test('Qdrant holds one point per chunk with vectors, text, timestamps and session id', async () => {
    const col = fq.collections.get(COLLECTION);
    assert.ok(col, 'collection was created');
    assert.equal(col.size, 768);
    assert.equal(col.distance, 'Cosine');
    assert.ok(col.indexes.has('session_id'), 'session_id payload index exists');

    const { json } = await call(app, 'GET', `/api/sessions/${teamId}`);
    const points = await scroll(teamId);
    assert.equal(points.length, json.session.chunkCount);

    const started = Date.parse(json.session.startedAt);
    for (const { payload: p } of points) {
      assert.equal(p.session_id, teamId);
      assert.ok(p.text.length > 20);
      assert.ok(Number.isInteger(p.start_ms) && p.end_ms >= p.start_ms);
      assert.equal(p.chunk_started_at, new Date(started + p.start_ms).toISOString());
      assert.equal(p.session_started_at, json.session.startedAt);
    }
    const all = points.map((p) => p.payload.text).join(' ');
    assert.match(all, /March 14/);
    assert.match(all, /Priya owns the database migration/);

    const topicBreak = points.filter((p) => p.payload.start_ms >= 160_000);
    assert.ok(topicBreak.length > 0 && topicBreak.every((p) => !p.payload.text.includes('engineering side')), 'the 74s silence split the topics');
  });

  test('embedding requests use the nomic task prefixes', async () => {
    const inputs = fo.state.embedRequests.flatMap((r) => r.input);
    assert.ok(inputs.length > 0 && inputs.every((t) => t.startsWith('search_document: ')));
  });

  test('a second recording is indexed alongside the first', async () => {
    landlordId = await record(app, 'Call with landlord', LANDLORD);
    await call(app, 'POST', `/api/sessions/${landlordId}/finish`, { durationMs: 52_000 });
    const done = await waitFor(app, landlordId, ['ready', 'index_failed']);
    assert.equal(done.session.status, 'ready', done.session.indexError);
    assert.equal(fq.collections.get(COLLECTION).points.size, (await scroll(teamId)).length + (await scroll(landlordId)).length);
  });

  describe('RAG chat', () => {
    test('session chat: answers from the transcript and cites the right moment', async () => {
      const r = await ask(app, { question: 'When is the new launch date for Falcon?', sessionId: teamId });
      assert.equal(r.events[0].event, 'sources', 'sources arrive before the answer');
      assert.equal(r.events.at(-1).event, 'done');
      assert.ok(r.tokenCount > 1, 'answer is streamed token by token');
      assert.match(r.answer, /March 14/);
      assert.equal(r.done.grounded, true);

      assert.ok(r.sources.length > 0 && r.sources.every((s) => s.sessionId === teamId));
      const hit = r.sources.find((s) => s.text.includes('March 14'));
      assert.ok(hit, 'the chunk containing the answer was retrieved');
      assert.equal(hit.sessionTitle, 'Team sync');
      assert.ok(hit.startMs <= 16_000 && hit.endMs >= 16_000, `timestamps ${hit.startMs}-${hit.endMs} should bracket the 0:16 mark`);
      assert.ok(Date.parse(hit.chunkStartedAt) > 0);
      assert.ok(r.done.cited.includes(hit.n), 'the answer cites the chunk that contains the fact');
    });

    test('the prompt is strict and contains the retrieved excerpts', async () => {
      const req = fo.state.chatRequests.at(-1);
      assert.equal(req.stream, true);
      assert.ok(req.options.temperature <= 0.2);
      assert.equal(req.messages[0].role, 'system');
      assert.match(req.messages[0].content, /ONLY the numbered excerpts/);
      assert.ok(req.messages[0].content.includes(NOT_FOUND));
      const user = req.messages.at(-1).content;
      assert.match(user, /\[\d+\] "Team sync" - recorded .* at \d\d:\d\d into the recording/);
      assert.match(user, /March 14/);
      assert.match(user, /Question: When is the new launch date for Falcon\?/);
    });

    test('global chat searches across every session', async () => {
      const a = await ask(app, { question: 'Who owns the database migration?' });
      assert.match(a.answer, /Priya/);
      assert.equal(a.sources.find((s) => s.text.includes('Priya owns')).sessionId, teamId);

      const b = await ask(app, { question: 'How much will the rent increase to?' });
      assert.match(b.answer, /twenty two thousand/);
      assert.equal(b.sources.find((s) => s.text.includes('twenty two thousand')).sessionId, landlordId);
      assert.equal(b.sources.find((s) => s.text.includes('twenty two thousand')).sessionTitle, 'Call with landlord');
    });

    test('session-scoped chat never leaks other sessions and says so when the answer is absent', async () => {
      const before = fo.state.chatRequests.length;
      const r = await ask(app, { question: 'What did the landlord say about the plumbing leak?', sessionId: teamId });
      assert.deepEqual(r.sources, []);
      assert.equal(r.answer, NOT_FOUND);
      assert.equal(r.done.grounded, false);
      assert.equal(fo.state.chatRequests.length, before, 'no LLM call is made without evidence');
    });

    test('questions unrelated to any recording are refused instead of hallucinated', async () => {
      const r = await ask(app, { question: 'What is the capital of France?' });
      assert.equal(r.answer, NOT_FOUND);
      assert.deepEqual(r.sources, []);
      assert.equal(r.done.grounded, false);
    });

    test('follow-up questions reuse the previous question for retrieval and carry history', async () => {
      const history = [
        { role: 'user', content: 'Who owns the database migration?' },
        { role: 'assistant', content: 'Priya owns the database migration. [1]' },
      ];
      const r = await ask(app, { question: 'and who handles the replicas?', history });
      assert.match(r.answer, /Dev/);
      const req = fo.state.chatRequests.at(-1);
      assert.deepEqual(req.messages.slice(1, 3).map((m) => m.role), ['user', 'assistant']);
      assert.ok(!/\[\d+\]/.test(req.messages[2].content), 'stale citation numbers are stripped from history');
      const queries = fo.state.embedRequests.flatMap((x) => x.input).filter((t) => t.startsWith('search_query: '));
      assert.match(queries.at(-1), /database migration.*replicas/);
    });

    test('rejects bad chat input', async () => {
      assert.equal((await call(app, 'POST', '/api/chat', { question: '   ' })).status, 400);
      assert.equal((await call(app, 'POST', '/api/chat', { question: 'hi', sessionId: 'nope' })).status, 404);
    });

    test('retrieval-only endpoint exposes scored chunks', async () => {
      const { json } = await call(app, 'POST', '/api/chat/search', { query: 'training for the support team' });
      assert.ok(json.sources.length > 0);
      assert.ok(json.sources.every((s) => typeof s.score === 'number'));
    });
  });

  describe('history management', () => {
    test('list, search by transcript text, and read full transcript', async () => {
      const list = await call(app, 'GET', '/api/sessions');
      assert.ok(list.json.sessions.length >= 2);
      assert.ok(list.json.sessions[0].preview.length > 0);

      const byTitle = await call(app, 'GET', '/api/sessions?q=landlord');
      assert.deepEqual(byTitle.json.sessions.map((s) => s.id), [landlordId]);
      const byText = await call(app, 'GET', '/api/sessions?q=gateway');
      assert.deepEqual(byText.json.sessions.map((s) => s.id), [teamId]);

      const full = await call(app, 'GET', `/api/sessions/${teamId}`);
      assert.equal(full.json.segments.length, 16);
      assert.equal(full.json.segments[2].text, TEAM_SYNC[2][1]);
    });

    test('rename updates the title everywhere, including chat sources', async () => {
      assert.equal((await call(app, 'PATCH', `/api/sessions/${landlordId}`, { title: '  Flat: rent & repairs  ' })).json.session.title, 'Flat: rent & repairs');
      assert.equal((await call(app, 'PATCH', `/api/sessions/${landlordId}`, { title: '   ' })).status, 400);
      const r = await ask(app, { question: 'What did he say about the maintenance deposit?', sessionId: landlordId });
      assert.equal(r.sources[0].sessionTitle, 'Flat: rent & repairs');
    });

    test('stats add up', async () => {
      const { json } = await call(app, 'GET', '/api/stats');
      assert.equal(json.recordings, 2);
      assert.equal(json.chunks, fq.collections.get(COLLECTION).points.size);
      assert.equal(json.totalDurationMs, 220_000 + 52_000);
      assert.equal(json.recent.length, 2);
    });

    test('input validation', async () => {
      const bad = (segments) => call(app, 'POST', `/api/sessions/${teamId}/segments`, { segments });
      assert.equal((await bad([])).status, 400);
      assert.equal((await bad([{ seq: -1, startMs: 0, text: 'x' }])).status, 400);
      assert.equal((await bad([{ seq: 99, startMs: 0, text: '  ' }])).status, 400);
      assert.equal((await call(app, 'GET', '/api/sessions/does-not-exist')).status, 404);
      assert.equal((await call(app, 'GET', '/api/nope')).status, 404);
    });
  });

  describe('failure handling: transcripts are never lost', () => {
    test('Ollama down while finishing -> transcript kept, session marked failed, reindex recovers', async () => {
      const id = await record(app, 'Offline test', [[0, 'The offsite will be in Lisbon in September.'], [8000, 'Marta is booking the venue this week.']]);
      await fo.close();
      await call(app, 'POST', `/api/sessions/${id}/finish`, { durationMs: 12_000 });
      const failed = await waitFor(app, id, ['ready', 'index_failed']);
      assert.equal(failed.session.status, 'index_failed');
      assert.match(failed.session.indexError, /Cannot reach Ollama/);
      assert.equal(failed.segments.length, 2, 'transcript is intact');
      assert.equal((await scroll(id)).length, 0);

      const health = await call(app, 'GET', '/api/health');
      assert.equal(health.json.ready, false);
      assert.equal(health.json.ollama.ok, false);

      const chat = await ask(app, { question: 'Where is the offsite?' });
      assert.ok(chat.error, 'chat reports the outage as an error event');
      assert.match(chat.error.message, /Cannot reach Ollama/);
      assert.match(chat.error.hint, /Start Ollama/);

      fo = await startFakeOllama(PORTS.ollama);
      await call(app, 'POST', `/api/sessions/${id}/reindex`);
      const ok = await waitFor(app, id, ['ready', 'index_failed']);
      assert.equal(ok.session.status, 'ready', ok.session.indexError);
      assert.equal(ok.session.indexError, null);
      assert.equal((await scroll(id)).length, ok.session.chunkCount);
      assert.match((await ask(app, { question: 'Where is the offsite?' })).answer, /Lisbon/);
    });

    test('missing Ollama model gives an actionable error', async () => {
      fo.state.models = ['qwen2.5:1.5b'];
      const id = await record(app, 'No model', [[0, 'The quarterly review moves to Thursday afternoon.']]);
      await call(app, 'POST', `/api/sessions/${id}/finish`, {});
      const failed = await waitFor(app, id, ['ready', 'index_failed']);
      assert.equal(failed.session.status, 'index_failed');
      assert.match(failed.session.indexError, /ollama pull nomic-embed-text/);
      const health = await call(app, 'GET', '/api/health');
      assert.ok(health.json.problems.some((p) => p.includes('ollama pull nomic-embed-text')));

      fo.state.models = ['nomic-embed-text:latest', 'qwen2.5:1.5b'];
      await call(app, 'POST', `/api/sessions/${id}/reindex`);
      assert.equal((await waitFor(app, id, ['ready', 'index_failed'])).session.status, 'ready');
    });

    test('a failed reindex does not destroy the existing index', async () => {
      const before = (await scroll(teamId)).length;
      fo.state.models = ['qwen2.5:1.5b'];
      await call(app, 'POST', `/api/sessions/${teamId}/reindex`);
      assert.equal((await waitFor(app, teamId, ['ready', 'index_failed'])).session.status, 'index_failed');
      assert.equal((await scroll(teamId)).length, before, 'old vectors are still there');
      fo.state.models = ['nomic-embed-text:latest', 'qwen2.5:1.5b'];
      await call(app, 'POST', `/api/sessions/${teamId}/reindex`);
      assert.equal((await waitFor(app, teamId, ['ready'])).session.status, 'ready');
      assert.equal((await scroll(teamId)).length, before, 'reindexing replaces rather than duplicates');
    });

    test('collection deleted behind the server is recreated on the next upsert', async () => {
      fq.collections.delete(COLLECTION);
      const id = await record(app, 'After wipe', [[0, 'The warehouse inventory count finished on Monday.']]);
      await call(app, 'POST', `/api/sessions/${id}/finish`, {});
      const done = await waitFor(app, id, ['ready', 'index_failed']);
      assert.equal(done.session.status, 'ready', done.session.indexError);
      assert.equal((await scroll(id)).length, 1);
      // Sessions indexed before the wipe can be rebuilt from SQLite.
      await call(app, 'POST', `/api/sessions/${teamId}/reindex`);
      await call(app, 'POST', `/api/sessions/${landlordId}/reindex`);
      await waitFor(app, teamId, ['ready']);
      await waitFor(app, landlordId, ['ready']);
      assert.match((await ask(app, { question: 'Who owns the database migration?' })).answer, /Priya/);
    });

    test('empty recordings finish cleanly with zero chunks', async () => {
      const { json } = await call(app, 'POST', '/api/sessions', {});
      await call(app, 'POST', `/api/sessions/${json.session.id}/finish`, { durationMs: 3000 });
      const done = await waitFor(app, json.session.id, ['ready', 'index_failed']);
      assert.equal(done.session.status, 'ready');
      assert.equal(done.session.chunkCount, 0);
    });

    test('deleting is refused while Qdrant is down, so nothing lingers in the index', async () => {
      const id = await record(app, 'To delete', [[0, 'This conversation should disappear completely.']]);
      await call(app, 'POST', `/api/sessions/${id}/finish`, {});
      await waitFor(app, id, ['ready']);
      const collections = fq.collections;
      await fq.close();
      const refused = await call(app, 'DELETE', `/api/sessions/${id}`);
      assert.equal(refused.status, 503);
      assert.match(refused.json.error.hint, /Start Qdrant/);
      assert.equal((await call(app, 'GET', `/api/sessions/${id}`)).status, 200, 'session is still there');

      fq = await startFakeQdrant(PORTS.qdrant, { collections }); // same "disk", server restarted
      assert.equal((await call(app, 'DELETE', `/api/sessions/${id}`)).status, 200);
      assert.equal((await call(app, 'GET', `/api/sessions/${id}`)).status, 404);
      assert.equal((await scroll(id)).length, 0, 'vectors are gone from Qdrant');
      const after = await ask(app, { question: 'Did this conversation disappear completely?' });
      assert.ok(after.sources.every((s) => s.sessionId !== id));
    });
  });

  describe('persistence and crash recovery', () => {
    test('everything survives a server restart; interrupted recordings can be resumed and finished', async () => {
      const id = await record(app, 'Mid-recording', [[0, 'We are halfway through describing the new onboarding flow.']]);
      const files = fs.readdirSync(dataDir);
      assert.ok(files.some((f) => f.startsWith('recallai.sqlite')));

      await app.stop();
      app = await startApp();

      const interrupted = await call(app, 'GET', `/api/sessions/${id}`);
      assert.equal(interrupted.json.session.status, 'interrupted');
      assert.equal(interrupted.json.segments.length, 1);

      assert.match((await ask(app, { question: 'Who owns the database migration?' })).answer, /Priya/, 'index persisted');

      // The browser reconnects and keeps appending: the session is live again.
      await call(app, 'POST', `/api/sessions/${id}/segments`, { segments: [{ seq: 1, startMs: 9000, endMs: 12_000, text: 'The onboarding flow has three steps.' }] });
      assert.equal((await call(app, 'GET', `/api/sessions/${id}`)).json.session.status, 'recording');
      await call(app, 'POST', `/api/sessions/${id}/finish`, {});
      assert.equal((await waitFor(app, id, ['ready', 'index_failed'])).session.status, 'ready');
    });
  });

  describe('older Ollama without /api/embed', () => {
    test('falls back to /api/embeddings', async () => {
      fo.state.legacyEmbeddings = true;
      fo.state.embedRequests.length = 0;
      const id = await record(app, 'Legacy', [[0, 'The shipment of blue widgets arrives on Friday.']]);
      await call(app, 'POST', `/api/sessions/${id}/finish`, {});
      const done = await waitFor(app, id, ['ready', 'index_failed']);
      assert.equal(done.session.status, 'ready', done.session.indexError);
      assert.ok(fo.state.embedRequests.some((r) => r.legacy));
      fo.state.legacyEmbeddings = false;
    });
  });
});
