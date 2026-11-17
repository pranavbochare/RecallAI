// Browser end-to-end test: drives the REAL UI (record -> stop -> auto-index -> chat -> history -> delete).
// Speech recognition is replaced by an injected fake (headless Chromium cannot reach Google's speech service)
// and Ollama/Qdrant by the protocol stand-ins in server/test/fakes. Run: npm run test:ui  (needs: npm i -D playwright)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'recallai-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const { startFakeQdrant } = await import(pathToFileURL(path.join(ROOT, 'server/test/fakes/fake-qdrant.mjs')).href);
const { startFakeOllama } = await import(pathToFileURL(path.join(ROOT, 'server/test/fakes/fake-ollama.mjs')).href);

const P = { app: 18790, q: 16334, o: 21435 };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recallai-ui-'));
const fq = await startFakeQdrant(P.q);
const fo = await startFakeOllama(P.o);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  cwd: path.join(ROOT, 'server'), stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: P.app, DATA_DIR: dataDir, OLLAMA_URL: `http://127.0.0.1:${P.o}`, QDRANT_URL: `http://127.0.0.1:${P.q}`, QDRANT_COLLECTION: 'ui_test', RAG_MIN_SCORE: '0.15' },
});
const slog = []; server.stdout.on('data', d => slog.push(String(d))); server.stderr.on('data', d => slog.push(String(d)));
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${P.app}/api/stats`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }

const results = [];
const check = (name, cond, extra = '') => { results.push([cond, name]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
const base = `http://127.0.0.1:${P.app}`;
let browser;
try {
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1, permissions: ['microphone'] });
  await ctx.addInitScript(() => {
    class FakeSR {
      constructor() { window.__sr = this; this.running = false; }
      start() { this.running = true; setTimeout(() => this.onstart?.(), 10); }
      stop() { this.running = false; setTimeout(() => this.onend?.(), 20); }
      abort() { this.running = false; setTimeout(() => this.onend?.(), 5); }
    }
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
    const emit = (text, isFinal) => { const r = [{ transcript: text }]; r.isFinal = isFinal; window.__sr.onresult({ resultIndex: 0, results: [r] }); };
    window.__speak = (text) => { const words = text.split(' '); emit(words.slice(0, Math.ceil(words.length / 2)).join(' '), false); setTimeout(() => emit(text, true), 120); };
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));

  // Dashboard (empty)
  await page.goto(base); await page.getByText('Your conversation memory').waitFor();
  await page.getByText('No recordings yet').waitFor();
  await page.waitForTimeout(600);
  check('dashboard shows empty state + services healthy', await page.getByText('All local services running').isVisible());
  await page.screenshot({ path: `${SHOTS}/01-dashboard-empty.png` });

  // Record
  await page.getByRole('link', { name: 'Record' }).first().click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByText('Listening…').waitFor({ timeout: 5000 });
  check('recording starts (mic granted, recognition listening)', true);
  const phrases = [
    "Okay everyone, let's start the weekly project sync.",
    'The Falcon launch was planned for February 28 but the payment gateway integration is behind schedule.',
    'So the new launch date for Falcon is March 14 and Anita will announce it to the customers tomorrow.',
    'Rohan said the support team needs at least ten days of training before launch.',
    'Priya owns the database migration and she expects to finish the staging migration by Friday.',
    'Dev will handle the read replica setup before the production cutover on Sunday night.',
  ];
  for (const p of phrases) { await page.evaluate(t => window.__speak(t), p); await page.waitForTimeout(1100); }
  check('live transcript shows spoken phrases', await page.getByText('new launch date for Falcon is March 14').isVisible());
  const timer = await page.locator('p.font-mono').first().innerText();
  check('recording timer is running', /^00:0[5-9]|^00:[1-5]\d/.test(timer), timer);
  await page.waitForTimeout(4500); // let an autosave fire
  const saved = await page.getByText('Saved', { exact: true }).isVisible();
  const mid = await (await fetch(`${base}/api/sessions`)).json();
  check('transcript autosaved to server while still recording', mid.sessions.length === 1 && mid.sessions[0].segmentCount === phrases.length && mid.sessions[0].status === 'recording', `segments=${mid.sessions[0]?.segmentCount} status=${mid.sessions[0]?.status} indicator=${saved}`);
  await page.screenshot({ path: `${SHOTS}/02-recording.png` });

  // Stop -> auto-index -> detail page
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.waitForURL(/\/sessions\/[0-9a-f-]{36}/, { timeout: 15000 });
  const sid = page.url().match(/sessions\/([0-9a-f-]{36})/)[1];
  await page.getByText('Indexed', { exact: true }).first().waitFor({ timeout: 15000 });
  check('stop -> navigates to session, status becomes Indexed automatically', true);
  const pts = (await (await fetch(`http://127.0.0.1:${P.q}/collections/ui_test/points/scroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 50 }) })).json()).result.points;
  check('vectors + text + timestamps + session id are in Qdrant', pts.length >= 1 && pts.every(p => p.payload.session_id === sid && p.payload.text && Number.isInteger(p.payload.start_ms)), `${pts.length} point(s)`);
  check('full transcript readable on detail page', await page.getByText('Dev will handle the read replica setup').isVisible());

  // Chat with this session
  const ask = async (q) => {
    await page.getByLabel('Your question').fill(q); await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText('Retrieved passages').or(page.getByText(/^Sources · /)).first().waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('.animate-blink'), null, { timeout: 15000 });
  };
  await ask('When is the new launch date for Falcon?');
  const panel = page.locator('section[aria-label="Chat"]');
  const text = await panel.innerText();
  check('session chat answers accurately (March 14)', /March 14/.test(text.split('Sources')[0]));
  check('answer shows source session title + mm:ss timestamps', /Recording ·/.test(text) && /\d\d:\d\d–\d\d:\d\d/.test(text), (text.match(/\d\d:\d\d–\d\d:\d\d/) || [])[0]);
  await panel.getByRole('button', { name: /Recording ·/ }).first().click();
  await page.getByRole('link', { name: /Open at/ }).first().click();
  await page.waitForURL(/\?t=\d+&e=\d+/);
  await page.locator('li.bg-indigo-50').first().waitFor({ timeout: 5000 }).catch(() => {});
  check('"Open at" jumps to transcript with highlighted passage', await page.locator('li.bg-indigo-50').count() > 0);
  await page.screenshot({ path: `${SHOTS}/03-session-chat.png` });

  await ask('What did the landlord say about rent?');
  const t2 = await panel.innerText();
  check("out-of-scope question is refused, not hallucinated", t2.includes("I couldn't find that in your recorded conversations."));

  // Global chat
  await page.getByRole('link', { name: 'Ask AI' }).first().click();
  await page.getByRole('heading', { name: 'Ask AI', level: 1 }).waitFor();
  await page.getByLabel('Your question').fill('Who owns the database migration?'); await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('section[aria-label="Chat"]').getByText(/Priya owns the database migration/).first().waitFor({ timeout: 15000 });
  await page.getByText('Cited', { exact: true }).waitFor({ timeout: 15000 });
  check('global chat searches across sessions and cites a source', /sources · \d/i.test(await page.locator('section[aria-label="Chat"]').innerText()));
  await page.screenshot({ path: `${SHOTS}/04-ask-global.png` });

  // History: rename + search + delete
  await page.getByRole('link', { name: 'Conversations' }).first().click();
  await page.getByRole('heading', { name: 'Conversations', level: 1 }).waitFor();
  await page.getByRole('button', { name: /^Rename Recording/ }).click({ force: true });
  const input = page.getByLabel('Conversation title'); await input.fill('Weekly sync: Falcon'); await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Weekly sync: Falcon').first().waitFor();
  check('rename works', true);
  await page.getByLabel('Search conversations').fill('gateway'); await page.waitForTimeout(600);
  check('search finds session by transcript text', await page.getByText('Weekly sync: Falcon').first().isVisible());
  await page.getByLabel('Search conversations').fill('zzzzqqq'); await page.getByText('No matches').waitFor();
  await page.getByLabel('Search conversations').fill('');
  await page.screenshot({ path: `${SHOTS}/05-sessions.png` });
  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  await page.getByText('Weekly sync: Falcon').first().waitFor();
  const stats = await page.locator('.card.animate-fade-up p.tabular-nums').allInnerTexts();
  check('dashboard stats populated', stats[0] === '1' && Number(stats[2]) >= 1, stats.join(' | '));
  await page.screenshot({ path: `${SHOTS}/06-dashboard.png` });

  await page.getByRole('link', { name: 'Conversations' }).first().click();
  await page.getByRole('button', { name: /^Delete Weekly/ }).click({ force: true });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText('No conversations yet').waitFor();
  const left = (await (await fetch(`http://127.0.0.1:${P.q}/collections/ui_test/points/count`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).result.count;
  check('delete removes session and its vectors from Qdrant', left === 0, `points left=${left}`);

  // mobile layout
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole('link', { name: 'Record' }).or(page.getByRole('button', { name: 'Open menu' })).first().waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('no horizontal overflow at 390px', !overflow);
  await page.screenshot({ path: `${SHOTS}/07-mobile.png` });
  check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FAIL  exception: ' + e.message.split('\n')[0]); results.push([false, 'exception']);
  try { const pg = browser.contexts()[0]?.pages()[0]; await pg?.screenshot({ path: `${SHOTS}/zz-failure.png` }); } catch {}
  console.log('--- server log ---\n' + slog.join('').slice(-1500));
} finally {
  await browser?.close(); server.kill(); await fo.close(); await fq.close(); fs.rmSync(dataDir, { recursive: true, force: true });
}
const failed = results.filter(r => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
