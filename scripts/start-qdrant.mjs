// Starts a NATIVE Qdrant (no Docker) with RecallAI's config. Cross-platform; made for Windows.
// Looks for the binary in: $QDRANT_BIN, ./bin/qdrant(.exe), then PATH.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? 'qdrant.exe' : 'qdrant';

function findBinary() {
  if (process.env.QDRANT_BIN) return fs.existsSync(process.env.QDRANT_BIN) ? process.env.QDRANT_BIN : null;
  const local = path.join(root, 'bin', exe);
  if (fs.existsSync(local)) return local;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [exe], { encoding: 'utf8' });
  return probe.status === 0 ? probe.stdout.split(/\r?\n/)[0].trim() : null;
}

const bin = findBinary();
if (!bin) {
  console.error(`
Could not find ${exe}.

  1. Download the Windows zip from https://github.com/qdrant/qdrant/releases/latest
     (the file named qdrant-x86_64-pc-windows-msvc.zip)
  2. Extract ${exe} into:  ${path.join(root, 'bin')}
  3. Run this again:       npm run qdrant

Or set QDRANT_BIN to the full path of ${exe}.
`);
  process.exit(1);
}

fs.mkdirSync(path.join(root, 'data', 'qdrant'), { recursive: true });
console.log(`Starting Qdrant: ${bin}`);
console.log('Data folder    : ' + path.join(root, 'data', 'qdrant', 'storage'));
console.log('Dashboard      : http://127.0.0.1:6333/dashboard\n');

const child = spawn(bin, ['--config-path', path.join(root, 'qdrant', 'config.yaml')], { cwd: root, stdio: 'inherit' });
child.on('error', (e) => { console.error('Failed to start Qdrant:', e.message); process.exit(1); });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
