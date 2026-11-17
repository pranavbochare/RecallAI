// `npm run doctor`: checks the REAL Ollama and Qdrant that RecallAI will use, end to end.
// It embeds text, writes/searches/deletes a temporary Qdrant collection, and asks the LLM a question.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(path.join(root, 'server'));
const { config } = await import('../server/src/config.js');
const ollama = await import('../server/src/ollama.js');

const { url: QDRANT, apiKey } = config.qdrant;
let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m, hint) => { failures++; console.log(`  ✗ ${m}${hint ? `\n      -> ${hint}` : ''}`); };
const step = async (name, fn) => { console.log(`\n${name}`); try { await fn(); } catch (e) { bad(e.message, e.hint); } };

const q = (p, opts = {}) => fetch(QDRANT + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'api-key': apiKey } : {}) }, signal: AbortSignal.timeout(15000) });

console.log('RecallAI doctor');
console.log(`  Node     ${process.version}`);
if (Number(process.versions.node.split('.')[0]) < 22) bad('Node 22.13+ is required (built-in SQLite)', 'Install the current LTS from https://nodejs.org');

await step('Ollama', async () => {
  const s = await ollama.status();
  if (!s.ok) return bad(`Not reachable at ${s.url}`, s.hint);
  ok(`Reachable at ${s.url}`);
  s.embedModel.installed ? ok(`Embedding model ${s.embedModel.name}`) : bad(`Embedding model missing`, `ollama pull ${s.embedModel.name}`);
  s.llmModel.installed ? ok(`Chat model ${s.llmModel.name}`) : bad(`Chat model missing`, `ollama pull ${s.llmModel.name}`);
});

let dim;
await step('Embeddings', async () => {
  const [a, b, c] = await ollama.embedDocuments(['The launch date moved to March 14.', 'We pushed the release to mid-March.', 'My cat enjoys sleeping on the sofa.']);
  dim = a.length;
  ok(`${dim}-dimension vectors`);
  const cos = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0) / Math.hypot(...x) / Math.hypot(...y);
  const near = cos(a, b), far = cos(a, c);
  near > far ? ok(`Related text scores higher (${near.toFixed(2)}) than unrelated (${far.toFixed(2)})`) : bad(`Embeddings look wrong: related ${near.toFixed(2)} vs unrelated ${far.toFixed(2)}`);

  // Calibrate RAG_MIN_SCORE with the exact prefixes the app uses (search_query / search_document).
  const [doc] = await ollama.embedDocuments(['Priya owns the database migration and expects to finish the staging migration by Friday. Dev will set up the read replicas.']);
  const score = async (q) => cos(await ollama.embedQuery(q), doc);
  const relevant = [await score('Who is responsible for the database migration?'), await score('When will the staging migration be done?')];
  const unrelated = [await score('What is the capital of France?'), await score('How do I bake sourdough bread?'), await score('What did the landlord say about rent?')];
  const lo = Math.min(...relevant), hi = Math.max(...unrelated);
  console.log(`      relevant questions score ${relevant.map((x) => x.toFixed(2)).join(', ')}; unrelated score ${unrelated.map((x) => x.toFixed(2)).join(', ')}`);
  console.log(`      current RAG_MIN_SCORE = ${config.rag.minScore}`);
  if (lo > hi) {
    const suggested = Math.round(((lo + hi) / 2) * 100) / 100;
    const verdict = config.rag.minScore > hi && config.rag.minScore < lo ? 'good as is' : `set RAG_MIN_SCORE=${suggested} in .env`;
    ok(`Unrelated questions score below relevant ones: ${verdict}`);
  } else {
    console.log(`      note: scores overlap, so the threshold alone can't reject off-topic questions; the chat model's "not found" rule will do that work.`);
  }
});

await step('Qdrant', async () => {
  const r = await q('/collections').catch(() => null);
  if (!r?.ok) return bad(`Not reachable at ${QDRANT}`, 'Start it with: npm run qdrant');
  ok(`Reachable at ${QDRANT}`);
  if (!dim) return;
  const name = `recallai_doctor_${Date.now()}`;
  try {
    let res = await q(`/collections/${name}`, { method: 'PUT', body: JSON.stringify({ vectors: { size: dim, distance: 'Cosine' } }) });
    if (!res.ok) return bad(`Create collection failed: ${await res.text()}`);
    const [v1, v2] = await ollama.embedDocuments(['Priya owns the database migration.', 'Lunch is on Wednesday.']);
    res = await q(`/collections/${name}/points?wait=true`, { method: 'PUT', body: JSON.stringify({ points: [{ id: 1, vector: v1, payload: { text: 'Priya' } }, { id: 2, vector: v2, payload: { text: 'Lunch' } }] }) });
    if (!res.ok) return bad(`Upsert failed: ${await res.text()}`);
    ok('Created collection and stored vectors');
    res = await q(`/collections/${name}/points/query`, { method: 'POST', body: JSON.stringify({ query: await ollama.embedQuery('Who is in charge of the database migration?'), limit: 1, with_payload: true }) });
    const top = (await res.json()).result?.points?.[0];
    top?.payload?.text === 'Priya' ? ok(`Semantic search returned the right passage (score ${top.score.toFixed(2)})`) : bad(`Search returned ${JSON.stringify(top)}`);
  } finally {
    await q(`/collections/${name}`, { method: 'DELETE' }).catch(() => {});
  }
});

await step('Chat model', async () => {
  let text = '';
  const msgs = [{ role: 'system', content: 'Answer using ONLY the excerpt. Be brief.' }, { role: 'user', content: 'Excerpts from recorded conversations:\n\n[1] "Team sync" - recorded Nov 17, 2026, 8:47 AM, at 00:05 into the recording\nPriya owns the database migration and expects to finish by Friday.\n\nQuestion: Who owns the database migration?' }];
  const t0 = Date.now();
  for await (const f of ollama.chatStream(msgs)) text += f;
  /priya/i.test(text) ? ok(`Answered in ${((Date.now() - t0) / 1000).toFixed(1)}s: "${text.trim().slice(0, 80)}"`) : bad(`Unexpected answer: "${text.trim().slice(0, 120)}"`);
});

console.log(failures ? `\n${failures} problem(s) found. Fix them and run "npm run doctor" again.\n` : '\nEverything works. Run "npm run dev" and open http://localhost:5173\n');
process.exit(failures ? 1 : 0);
