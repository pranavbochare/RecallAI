import { config } from './config.js';

/*
 * Turns speech-recognition segments into retrieval chunks.
 *
 * Goals: chunks big enough to carry context (~600 chars / ~150 tokens), small enough to stay on
 * one topic, with a little overlap so an answer straddling a boundary is still retrievable, and
 * accurate start/end offsets so every answer can point back to a moment in the recording.
 * A long silence (default 45s) is treated as a topic break: no overlap is carried across it.
 */

function splitLongText(text, maxChars) {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
  const pieces = [];
  let current = '';
  const flush = () => {
    if (current.trim()) pieces.push(current.trim());
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      flush();
      let line = '';
      for (const word of sentence.split(/\s+/).filter(Boolean)) {
        if (line && `${line} ${word}`.length > maxChars) {
          pieces.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) pieces.push(line);
      continue;
    }
    if (current && (current + sentence).length > maxChars) flush();
    current += sentence;
  }
  flush();
  return pieces;
}

/** Cleans segments and splits oversized ones, interpolating timestamps by character position. */
export function normalizeSegments(segments, maxChars) {
  const out = [];
  for (const s of segments) {
    const text = String(s.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = Math.max(0, Number(s.startMs) || 0);
    const end = Math.max(start, Number(s.endMs) || start);
    if (text.length <= maxChars) {
      out.push({ text, startMs: start, endMs: end });
      continue;
    }
    let offset = 0;
    for (const piece of splitLongText(text, maxChars)) {
      const a = start + Math.round(((end - start) * offset) / text.length);
      offset += piece.length + 1;
      const b = start + Math.round(((end - start) * Math.min(offset, text.length)) / text.length);
      out.push({ text: piece, startMs: a, endMs: b });
    }
  }
  return out;
}

const size = (parts) => parts.reduce((n, p) => n + p.text.length + 1, 0);

function build(parts) {
  const fresh = parts.filter((p) => !p.carry);
  return {
    text: parts.map((p) => p.text).join(' '),
    freshText: fresh.map((p) => p.text).join(' '),
    startMs: parts[0].startMs,
    endMs: parts[parts.length - 1].endMs,
  };
}

export function chunkSegments(segments, opts = config.chunk) {
  const { targetChars, maxChars, overlapChars, minChars, gapMs } = opts;
  const parts = normalizeSegments(segments, maxChars);
  const chunks = [];
  let cur = []; // entries flagged `carry` are overlap copied from the previous chunk

  const flush = (carryOverlap) => {
    if (!cur.some((p) => !p.carry)) {
      cur = [];
      return;
    }
    chunks.push(build(cur));
    const tail = [];
    if (carryOverlap) {
      let n = 0;
      for (let i = cur.length - 1; i >= 0; i--) {
        n += cur[i].text.length + 1;
        if (n > overlapChars) break;
        tail.unshift({ ...cur[i], carry: true });
      }
    }
    cur = tail;
  };

  for (const part of parts) {
    const last = cur[cur.length - 1];
    if (last && cur.some((p) => !p.carry)) {
      const total = size(cur);
      const next = total + part.text.length + 1;
      if (part.startMs - last.endMs > gapMs && total >= minChars) flush(false);
      else if (next > targetChars && total >= minChars) flush(true);
      else if (next > maxChars) flush(true);
    }
    cur.push({ ...part });
  }
  flush(false);

  // A tiny trailing chunk is mostly overlap: fold its new text into the previous chunk instead.
  if (chunks.length > 1) {
    const tail = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (tail.freshText.length < minChars / 2 && prev.text.length + tail.freshText.length <= maxChars * 1.3) {
      prev.text = `${prev.text} ${tail.freshText}`;
      prev.freshText = `${prev.freshText} ${tail.freshText}`;
      prev.endMs = tail.endMs;
      chunks.pop();
    }
  }

  return chunks.map((c, index) => ({ index, text: c.text, startMs: c.startMs, endMs: c.endMs }));
}
