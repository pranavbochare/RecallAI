import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkSegments } from '../src/chunker.js';

const opts = { targetChars: 600, maxChars: 900, overlapChars: 120, minChars: 200, gapMs: 45_000 };

/** n segments of ~`len` chars, `step` ms apart. */
function makeSegments(n, { len = 90, step = 6000, start = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    text: `Segment ${i} ` + 'word '.repeat(Math.floor((len - 10) / 5)).trim(),
    startMs: start + i * step,
    endMs: start + i * step + 4000,
  }));
}

test('returns no chunks for empty or whitespace-only input', () => {
  assert.deepEqual(chunkSegments([], opts), []);
  assert.deepEqual(chunkSegments([{ text: '   ', startMs: 0, endMs: 1 }], opts), []);
});

test('short transcripts become a single chunk covering the whole recording', () => {
  const segs = makeSegments(3);
  const chunks = chunkSegments(segs, opts);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].startMs, 0);
  assert.equal(chunks[0].endMs, segs[2].endMs);
  assert.equal(chunks[0].index, 0);
});

test('long transcripts are split near the target size with ordered, valid timestamps', () => {
  const chunks = chunkSegments(makeSegments(40), opts);
  assert.ok(chunks.length >= 5, `expected several chunks, got ${chunks.length}`);
  chunks.forEach((c, i) => {
    assert.equal(c.index, i);
    assert.ok(c.text.length <= opts.maxChars + opts.overlapChars + 20, `chunk ${i} too large: ${c.text.length}`);
    assert.ok(c.startMs <= c.endMs);
    if (i > 0) assert.ok(c.startMs >= chunks[i - 1].startMs, 'chunks must move forward in time');
  });
});

test('consecutive chunks overlap so an answer on a boundary stays retrievable', () => {
  const segs = makeSegments(30);
  const chunks = chunkSegments(segs, opts);
  for (let i = 1; i < chunks.length; i++) {
    const lastSegmentOfPrev = segs.map((s) => s.text).filter((t) => chunks[i - 1].text.endsWith(t)).pop();
    assert.ok(lastSegmentOfPrev, 'previous chunk should end on a whole segment');
    assert.ok(chunks[i].text.startsWith(lastSegmentOfPrev), `chunk ${i} should start with the tail of chunk ${i - 1}`);
  }
});

test('a long silence acts as a topic break: no overlap is carried across it', () => {
  const before = makeSegments(8, { len: 100 }); // ~800 chars -> forces a flush before the gap
  const after = makeSegments(8, { len: 100, start: before.at(-1).endMs + 90_000 });
  const chunks = chunkSegments([...before, ...after], opts);
  const boundary = chunks.find((c) => c.startMs >= after[0].startMs);
  assert.ok(boundary, 'a chunk should start after the gap');
  assert.ok(boundary.startMs === after[0].startMs, 'chunk after a gap starts exactly at the first segment after it');
  assert.ok(!boundary.text.includes(before.at(-1).text), 'no pre-gap text may leak into the post-gap chunk');
});

test('oversized single segments are split with interpolated timestamps', () => {
  const sentence = 'The quick brown fox jumps over the lazy dog near the river bank today. ';
  const text = sentence.repeat(40); // ~2800 chars
  const chunks = chunkSegments([{ text, startMs: 10_000, endMs: 70_000 }], opts);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].startMs, 10_000);
  assert.ok(chunks.at(-1).endMs <= 70_000);
  chunks.forEach((c) => assert.ok(c.text.length <= opts.maxChars + opts.overlapChars + 20));
});

test('a tiny trailing remainder is folded into the previous chunk', () => {
  const segs = [...makeSegments(7, { len: 90 }), { text: 'Okay bye.', startMs: 7 * 6000, endMs: 7 * 6000 + 1500 }];
  const chunks = chunkSegments(segs, opts);
  assert.ok(chunks.at(-1).text.includes('Okay bye.'));
  assert.ok(chunks.at(-1).text.length > 100, 'the remainder must not become a chunk of its own');
});
