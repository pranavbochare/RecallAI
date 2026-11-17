/*
 * Browser-side safety net for transcripts.
 * Segments are written here the moment speech recognition finalizes them, and removed only after the
 * server has confirmed them. If the tab crashes or the server is unreachable, nothing is lost: the
 * next time RecallAI opens it uploads whatever is left (the server ignores duplicates by seq).
 */
const KEY = 'recallai:pending:v1';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full or unavailable: the server copy is still the primary one */
  }
}

export function savePending(sessionId, { segments, durationMs, finish = false }) {
  const all = readAll();
  all[sessionId] = { segments, durationMs, finish, savedAt: Date.now() };
  writeAll(all);
}

export function clearPending(sessionId) {
  const all = readAll();
  delete all[sessionId];
  writeAll(all);
}

export const loadAllPending = readAll;
