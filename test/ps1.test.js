import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanEnvForPS51 } from '../src/windows.js';
import { startMockStore } from './support/mock-store.js';

const scriptPath = fileURLToPath(new URL('../scripts/ghostget.ps1', import.meta.url));
const text = readFileSync(scriptPath, 'utf8');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const win = process.platform === 'win32';

/** Async on purpose: the mock server lives in this process and must keep answering. */
function powershell(args, env = {}) {
  return new Promise((resolve) => {
    // -ExecutionPolicy Bypass, cleanEnvForPS51: see the module-level comment in src/windows.js.
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
      env: cleanEnvForPS51({ ...process.env, ...env }),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

test('the PowerShell edition reports the same version as the package', () => {
  assert.ok(text.includes(`$script:Version = '${version}'`), `scripts/ghostget.ps1 must say $script:Version = '${version}'`);
});

test('the PowerShell edition is pure ASCII (5.1 misreads UTF-8 files without a BOM)', () => {
  const bad = [...text].filter((c) => c.charCodeAt(0) > 127);
  assert.deepEqual(bad, []);
});

test('the PowerShell edition implements every command its help lists', () => {
  for (const command of ['search', 'show', 'install', 'download', 'url']) {
    assert.match(text, new RegExp(`'${command}'`), command);
  }
});

let mock;
before(async () => {
  mock = await startMockStore();
});
after(() => mock.close());

test('version and url work offline under Windows PowerShell', { skip: !win }, async () => {
  const v = await powershell(['version']);
  assert.deepEqual([v.status, v.stdout], [0, version]);
  const u = await powershell(['url', 'https://apps.microsoft.com/detail/9n8cj4w95tbz?hl=en-US']);
  assert.deepEqual([u.status, u.stdout], [0, 'https://get.microsoft.com/installer/download/9N8CJ4W95TBZ?cid=website_cta_psi']);
});

test('exit codes: unknown command is 2, unknown product is 3', { skip: !win }, async () => {
  assert.equal((await powershell(['frobnicate'])).status, 2);
  assert.equal((await powershell(['show', '9ZZZZZZZZZZZ'], mock.env)).status, 3);
});

test('a paid app is refused with exit 8 and -Force lets it through', { skip: !win }, async () => {
  const refused = await powershell(['install', '9PGLL77C201J', '-DryRun'], mock.env);
  assert.equal(refused.status, 8);
  assert.match(refused.stdout, /paid app \(59\.99 USD\)/);
  const forced = await powershell(['install', '9PGLL77C201J', '-DryRun', '-Force'], mock.env);
  assert.equal(forced.status, 0);
});

test('an ambiguous name is never guessed (exit 4)', { skip: !win }, async () => {
  const r = await powershell(['install', 'music', '-DryRun'], mock.env);
  assert.equal(r.status, 4);
  assert.match(r.stdout, /matches 3 apps/);
});

test('download -NoVerify saves the file under the server-provided name', { skip: !win }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ghostget-ps-'));
  try {
    const r = await powershell(['download', '9N8CJ4W95TBZ', '-Dir', dir, '-NoVerify'], mock.env);
    assert.equal(r.status, 0, r.stdout);
    assert.ok(existsSync(path.join(dir, 'ChatGPT (Beta) Installer.exe')));
    assert.ok(r.stdout.endsWith('ChatGPT (Beta) Installer.exe'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('download of an unsigned file is rejected (exit 7) and deleted', { skip: !win }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ghostget-ps-'));
  try {
    const r = await powershell(['download', '9N8CJ4W95TBZ', '-Dir', dir], mock.env);
    assert.equal(r.status, 7, r.stdout);
    assert.match(r.stdout, /not signed by Microsoft/);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
