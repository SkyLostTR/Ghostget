import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startMockStore } from './support/mock-store.js';

// Win32 (`XP...`) apps are unknown to the display catalog, and a paid one still lists a numeric price of 0.
// The PowerShell edition must handle both exactly like the npm edition does.

const scriptPath = fileURLToPath(new URL('../scripts/ghostget.ps1', import.meta.url));
const win = process.platform === 'win32';

function powershell(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-File', scriptPath, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.on('close', (status) => resolve({ status, stdout: stdout.trim() }));
  });
}

let mock;
before(async () => {
  mock = await startMockStore();
});
after(() => mock.close());

test('a free Win32 app installs (dry run) through the Store product API', { skip: !win }, async () => {
  const r = await powershell(['install', 'XP9KHM4BK9FZ7Q', '-DryRun'], mock.env);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /Found Visual Studio Code \[XP9KHM4BK9FZ7Q\] - Microsoft Corporation - Free/);
});

test('a paid Win32 app is refused even though its numeric price is 0', { skip: !win }, async () => {
  const r = await powershell(['install', 'XPFD4T9N395QN6', '-DryRun'], mock.env);
  assert.equal(r.status, 8, r.stdout);
  assert.match(r.stdout, /Adobe Photoshop is a paid app\./);
});

test('show works for a Win32 app', { skip: !win }, async () => {
  const r = await powershell(['show', 'XP9KHM4BK9FZ7Q'], mock.env);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /Visual Studio Code \[XP9KHM4BK9FZ7Q\]/);
});
