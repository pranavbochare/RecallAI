# RecallAI — AI Conversation Memory Assistant

Record a conversation with your microphone, and RecallAI transcribes it, stores it in a **local Qdrant** vector database, and lets you **chat with it** — with answers drawn *only* from what was said, and the exact recording and timestamp shown for every source.

```
Microphone ─▶ Web Speech API ─▶ live transcript ─▶ autosave (SQLite)
                                                        │ stop
                                                        ▼
                         chunk ─▶ Ollama nomic-embed-text ─▶ Qdrant (vectors + text + timestamps + session id)
                                                        │
 Question ─▶ embed ─▶ Qdrant top-K ─▶ Ollama qwen2.5:1.5b (strict prompt) ─▶ streamed answer + sources
```

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 3, Lucide icons |
| Backend | Node.js 22 + Express 5 |
| Speech-to-text | Browser Web Speech API (Chrome / Edge) |
| Embeddings | Ollama `nomic-embed-text` (768-d) |
| LLM | Ollama `qwen2.5:1.5b` |
| Vector DB | Native Qdrant (no Docker) |
| Metadata + transcripts | SQLite (Node's built-in `node:sqlite`) |

No Docker, no paid APIs, no cloud database. Everything except the browser's speech service runs on your PC (see [Privacy](#privacy-and-the-speech-service)).

---

## Windows setup (step by step)

You need about 3 GB of disk space and 8 GB of RAM is comfortable. All commands below are for **PowerShell**.

### 1. Install Node.js 22.13 or newer

Download the **LTS** installer from <https://nodejs.org> and run it. Then check:

```powershell
node -v    # must print v22.13.0 or higher
```

RecallAI uses Node's built-in SQLite, so there is nothing to compile and no Visual Studio build tools are needed.

### 2. Install Ollama and download the two models

1. Download **Ollama for Windows** from <https://ollama.com/download> and install it. It starts automatically and lives in the system tray (it serves `http://localhost:11434`).
2. Pull the models (about 1.3 GB total, one time):

```powershell
ollama pull nomic-embed-text
ollama pull qwen2.5:1.5b
```

If `ollama` is not recognised, open a new PowerShell window. If the tray icon is missing, run `ollama serve` in a separate window.

### 3. Install native Qdrant (no Docker)

1. Open <https://github.com/qdrant/qdrant/releases/latest>.
2. Under **Assets**, download **`qdrant-x86_64-pc-windows-msvc.zip`**.
3. Extract it and put **`qdrant.exe`** into the project's **`bin`** folder (create it if needed):

```
recallai\
  bin\
    qdrant.exe      <-- here
```

If Windows SmartScreen warns about the file, choose *More info → Run anyway* (or right-click the file → Properties → *Unblock*).

Qdrant is configured by `qdrant\config.yaml` and stores its data in `data\qdrant\storage`, so your vectors persist between runs.

### 4. Install the project

```powershell
cd path\to\recallai
npm run setup
```

If PowerShell says *"running scripts is disabled on this system"*, either run the same commands in **Command Prompt (cmd)**, or allow scripts for your user once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### 5. Check that everything is wired up

```powershell
npm run qdrant       # leave this window open (or skip: step 6 starts it for you)
```

In a second window:

```powershell
npm run doctor
```

`doctor` talks to your **real** Ollama and Qdrant: it checks both models are installed, creates embeddings, writes and searches a temporary Qdrant collection, and asks the LLM a question. It also measures how your embedding model scores relevant vs. unrelated questions and tells you if `RAG_MIN_SCORE` should be changed. Fix anything with a ✗ before continuing.

### 6. Run RecallAI

```powershell
npm run dev:all
```

This starts Qdrant, the API (port 8787) and the web app (port 5173) together. Open **<http://localhost:5173>** in **Chrome or Edge**.

(If you already run Qdrant on its own, use `npm run dev` instead.)

**Single-port mode:** `npm run build` then `npm start` serves the built app and API from **<http://localhost:8787>**. Qdrant must be running separately.

### 7. Use it

1. Click **Quick record** (or *Record*) and **allow the microphone** when Chrome asks.
2. Talk. The live transcript and timer update as you speak; the transcript autosaves every 4 seconds.
3. Click the red **Stop** button. You land on the session page; its badge goes *Indexing → Indexed* in a few seconds.
4. Ask questions in the chat panel (this recording only) or on the **Ask AI** page (all recordings). Each answer lists its sources with the recording title and `mm:ss` range; **Open at 00:42** jumps to that spot in the transcript.

---

## Features

- **Live recording** — start/stop, timer, live level meter, interim + final transcript, language picker, automatic recovery when the browser's recognizer restarts itself, clear messages for blocked / missing / busy microphones.
- **Never lose a transcript** — each phrase is written to the browser's storage immediately, uploaded to SQLite every 4 s (idempotent, safe to retry), and re-sent on tab close/crash. If the server is down at stop time it is saved on next launch. If Ollama or Qdrant fails during indexing, the transcript is kept, the session shows *Not indexed*, and **Reindex** retries later. A failed reindex never destroys an existing good index.
- **Smart chunking** — ~600-character chunks cut on phrase boundaries, 120-character overlap, a ≥45 s silence starts a new chunk with no overlap (topic break). Every chunk keeps exact start/end offsets.
- **Qdrant payload** per chunk: `session_id`, `chunk_index`, `text`, `start_ms`, `end_ms`, `session_started_at`, `chunk_started_at`, `chunk_ended_at`, `word_count`. Point IDs are deterministic, so reindexing replaces rather than duplicates.
- **History** — search by title *or* transcript text, open, rename, delete (removes vectors too), export a transcript as `.txt`.
- **RAG chat** — streaming answers, per-session or global scope, follow-up questions, `[1]`-style citations that expand into source cards, "I couldn't find that in your recorded conversations." when nothing relevant is retrieved (the LLM is not even called in that case).
- **Dashboard** — recordings, total duration, chunks, words, recent conversations, quick record, live system status for Speech / Ollama / Qdrant / SQLite.

## How answers stay grounded

1. The question is embedded (`search_query:` prefix, as `nomic-embed-text` expects) and Qdrant returns the top 6 chunks above `RAG_MIN_SCORE`, optionally filtered to one `session_id`.
2. **No chunks → fixed "not found" reply, no LLM call.**
3. Otherwise the chunks are passed as numbered excerpts to `qwen2.5:1.5b` at temperature 0.1 with rules: use only the excerpts, cite numbers, and reply with the fixed "not found" sentence if the answer isn't there.

A 1.5 B-parameter model is small. It is good at pulling a fact out of a short excerpt, weaker at long summaries or multi-step reasoning, and can occasionally ignore the rules. If you want better answers, set `OLLAMA_LLM_MODEL=qwen2.5:3b` (or `7b`) in `.env` after `ollama pull`. The sources are always shown so you can verify an answer.

## Configuration

Copy `.env.example` to `.env` to override anything. Defaults:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | API address (localhost only) |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama server |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Changing it needs a new collection + reindex |
| `OLLAMA_LLM_MODEL` | `qwen2.5:1.5b` | Chat model |
| `QDRANT_URL` / `QDRANT_COLLECTION` | `http://127.0.0.1:6333` / `recallai_chunks` | Vector DB |
| `DATA_DIR` | `./data` | SQLite lives here |
| `RAG_TOP_K` / `RAG_MIN_SCORE` | `6` / `0.3` | Retrieval size and minimum cosine similarity |
| `CHUNK_TARGET_CHARS`, `CHUNK_MAX_CHARS`, `CHUNK_OVERLAP_CHARS`, `CHUNK_GAP_MS` | `600`, `900`, `120`, `45000` | Chunking |

**Tuning `RAG_MIN_SCORE`:** run `npm run doctor` — it prints the scores your model gives relevant and unrelated questions and suggests a value. Raise it if off-topic questions still retrieve passages; lower it if real questions come back "not found".

## Where your data lives

| What | Where |
|---|---|
| Sessions + full transcripts | `data\recallai.sqlite` (source of truth) |
| Vectors + chunk text | `data\qdrant\storage` |

To back up, stop the app and copy the `data` folder. Because transcripts live in SQLite, the whole vector index can always be rebuilt with **Reindex** (for example after switching embedding models).

## Privacy and the speech service

The Web Speech API in **Chrome and Edge sends your microphone audio to the browser vendor's online speech-recognition service** (Google / Microsoft). It is free and needs no API key, but **it is not offline and not fully private**, and it needs an internet connection while recording. Everything after transcription — embedding, storage, search, answers — stays on your computer. Firefox and Safari don't support continuous recognition. If you need fully offline transcription, the speech layer (`client/src/hooks/useSpeechRecognition.js`) is the only part you would replace (for example with a local Whisper server) — the rest of the app consumes plain `{text, startMs, endMs}` segments.

## Project layout

```
recallai/
├─ client/                    React + Vite + Tailwind
│  └─ src/
│     ├─ hooks/               useRecorder (autosave, recovery), useSpeechRecognition, useChat, ...
│     ├─ components/          ChatPanel, SourceCard, TranscriptView, LevelMeter, ...
│     ├─ pages/               Dashboard, Record, Sessions, SessionDetail, Ask
│     └─ lib/                 api (incl. SSE streaming), format, pending (offline safety net)
├─ server/
│  ├─ src/
│  │  ├─ db.js                SQLite: sessions + segments
│  │  ├─ ollama.js            embeddings + streaming chat client
│  │  ├─ qdrant.js            Qdrant REST client
│  │  ├─ chunker.js           transcript → chunks
│  │  ├─ services/ingest.js   chunk → embed → store
│  │  ├─ services/rag.js      retrieve → prompt → stream
│  │  └─ routes/              sessions, chat (SSE), system
│  └─ test/                   unit + end-to-end tests (+ protocol stand-ins in test/fakes)
├─ scripts/                   start-qdrant.mjs, doctor.mjs
├─ qdrant/config.yaml         native Qdrant config
├─ e2e/ui.e2e.mjs             browser test of the real UI
└─ bin/qdrant.exe             (you add this)
```

## API

| | |
|---|---|
| `GET /api/health`, `GET /api/stats` | service status, dashboard numbers |
| `GET/POST /api/sessions` | list (`?q=` searches titles + transcripts), create |
| `GET/PATCH/DELETE /api/sessions/:id` | read with transcript, rename, delete (+ vectors) |
| `POST /api/sessions/:id/segments` | append transcript segments (idempotent by `seq`) |
| `POST /api/sessions/:id/finish` | end recording, start background indexing |
| `POST /api/sessions/:id/reindex` | rebuild the Qdrant index from the saved transcript |
| `POST /api/chat` | RAG answer as Server-Sent Events: `sources` → `token`… → `done` |
| `POST /api/chat/search` | retrieval only, for debugging what Qdrant returns |

## Tests

```powershell
npm test            # chunker unit tests + backend end-to-end tests (32 tests)
npm run test:ui     # drives the real browser UI (needs: npm i -D playwright)
npm run doctor      # checks YOUR real Ollama + Qdrant
```

**What the automated tests do and don't prove.** The test suites run the real Express server, real SQLite and the real Ollama/Qdrant client code, but against small in-repo stand-ins for the Ollama and Qdrant *servers* (`server/test/fakes`), because those programs are not available in CI. The stand-ins enforce the real APIs' rules (UUID point IDs, vector dimensions, 404 shapes, filters, NDJSON streaming), so protocol mistakes are caught, but they cannot judge the **retrieval quality or answer quality of the real models**, and the speech recognizer is simulated in the browser test. `npm run doctor` is the check against your real stack. Real-world accuracy with `qwen2.5:1.5b` and `nomic-embed-text` depends on your audio and the models.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Red banner "Ollama is not reachable" | Start Ollama from the Start menu, or run `ollama serve` |
| "Missing model … ollama pull …" | Run the `ollama pull` command shown |
| "Qdrant is not reachable" | Run `npm run qdrant`; make sure `bin\qdrant.exe` exists and port 6333 is free |
| "Could not find qdrant.exe" | Put it in `bin\` (step 3) or set `QDRANT_BIN` to its full path |
| Microphone blocked | Click the lock icon in the address bar → allow Microphone; also check *Windows Settings → Privacy & security → Microphone* |
| "Can't reach the browser's speech service" | Chrome/Edge need internet for recognition; check your connection / VPN / firewall |
| Speech recognition unsupported | Use Chrome or Edge, and open the app on `localhost` (microphone access requires a secure context) |
| Session says *Not indexed* | Start the missing service, then press **Reindex**; the transcript was never lost |
| Changed embedding model, "dimension" error | Set `QDRANT_COLLECTION` to a new name (or delete the old collection) and **Reindex** each session |
| Port in use | Change `PORT` in `.env` (and `RECALLAI_API` for the Vite proxy) |
| First answer is slow | Ollama is loading the model into memory; later answers are faster |
| `node:sqlite` error | Node is older than 22.13; install the current LTS |
