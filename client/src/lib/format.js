const pad = (n) => String(n).padStart(2, '0');

/** 83000 -> "01:23", 3725000 -> "1:02:05" */
export function formatClock(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 83000 -> "1m 23s", 3725000 -> "1h 02m" */
export function formatDuration(ms) {
  const total = Math.round((ms || 0) / 1000);
  if (total <= 0) return '0s';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

export const formatDate = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export const formatShortDate = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Wall-clock time of a moment inside a recording. */
export const wallClock = (startedAtIso, offsetMs) =>
  new Date(Date.parse(startedAtIso) + offsetMs).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function timeAgo(iso) {
  const diff = Date.now() - Date.parse(iso);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} d ago`;
  return formatShortDate(iso);
}

export const plural = (n, word) => `${new Intl.NumberFormat().format(n || 0)} ${word}${n === 1 ? '' : 's'}`;

export const formatNumber = (n) => new Intl.NumberFormat().format(n || 0);

// export function greeting() {
//   const h = new Date().getHours();
//   if (h < 5) return 'Working late';
//   if (h < 12) return 'Good morning';
//   if (h < 18) return 'Good afternoon';
//   return 'Good evening';
// }

export function transcriptText(session, segments) {
  const head = [
    session.title,
    `Recorded ${formatDate(session.startedAt)} · ${formatDuration(session.durationMs)}`,
    '',
  ];
  return [...head, ...segments.map((s) => `[${formatClock(s.startMs)}] ${s.text}`)].join('\n');
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFilename = (title) => title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'transcript';
