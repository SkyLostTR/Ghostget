import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { GhostgetError, buildInstallerUrl, disabledDeploymentServices, downloadInstaller, isTrustedMicrosoftSignature } from '../src/index.js';
import { parseContentDisposition, safeFileName } from '../src/installer.js';
import { REAL_DISPOSITION, fakeExe, startMockStore } from './support/mock-store.js';

test('builds the web installer URL Microsoft itself uses', () => {
  assert.equal(buildInstallerUrl('9N8CJ4W95TBZ', { env: {} }), 'https://get.microsoft.com/installer/download/9N8CJ4W95TBZ?cid=website_cta_psi');
});

test('the URL builder accepts Store URLs, lowercase ids and a custom campaign id', () => {
  assert.equal(
    buildInstallerUrl('https://apps.microsoft.com/detail/9n8cj4w95tbz', { campaignId: 'my.campaign-1', env: {} }),
    'https://get.microsoft.com/installer/download/9N8CJ4W95TBZ?cid=my.campaign-1',
  );
  assert.match(buildInstallerUrl('9n8cj4w95tbz', { env: { GHOSTGET_CID: 'from_env' } }), /cid=from_env$/);
});

test('the URL builder rejects a name and a suspicious campaign id', () => {
  assert.throws(() => buildInstallerUrl('chatgpt', { env: {} }), (e) => e.code === 'E_USAGE');
  assert.throws(() => buildInstallerUrl('9N8CJ4W95TBZ', { campaignId: 'a&b=c', env: {} }), (e) => e.code === 'E_USAGE');
});

test('reads the filename from the real Content-Disposition header', () => {
  assert.equal(parseContentDisposition(REAL_DISPOSITION), 'ChatGPT (Beta) Installer.exe');
  assert.equal(parseContentDisposition('attachment; filename="plain.exe"'), 'plain.exe');
  assert.equal(parseContentDisposition('attachment; filename=bare.exe; size=1'), 'bare.exe');
  assert.equal(parseContentDisposition('attachment; filename="a \\"quoted\\" name.exe"'), 'a "quoted" name.exe');
  assert.equal(parseContentDisposition("attachment; filename*=UTF-8''T%C3%BCrk%C3%A7e.exe"), 'Türkçe.exe');
  assert.equal(parseContentDisposition('inline'), null);
  assert.equal(parseContentDisposition(null), null);
});

test('a server-supplied filename cannot escape the download folder or hit a device name', () => {
  const fallback = 'fallback.exe';
  assert.equal(safeFileName('../../evil.exe', fallback), 'evil.exe');
  assert.equal(safeFileName('..\\..\\evil.exe', fallback), 'evil.exe');
  assert.equal(safeFileName('C:\\Windows\\System32\\x.exe', fallback), 'x.exe');
  assert.equal(safeFileName('a<b>c:d"e|f?g*h.exe', fallback), 'a_b_c_d_e_f_g_h.exe');
  assert.equal(safeFileName('con.exe', fallback), fallback);
  assert.equal(safeFileName('NUL', fallback), fallback);
  assert.equal(safeFileName('lpt1.txt', fallback), fallback);
  assert.equal(safeFileName('', fallback), fallback);
  assert.equal(safeFileName('...', fallback), fallback);
  assert.equal(safeFileName('setup', fallback), 'setup.exe');
  assert.equal(safeFileName('setup.EXE', fallback), 'setup.EXE');
  assert.ok(safeFileName(`${'x'.repeat(300)}.exe`, fallback).length <= 120);
});

test('only a valid Microsoft Corporation signature is trusted', () => {
  const ms = 'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US';
  assert.equal(isTrustedMicrosoftSignature({ status: 'Valid', subject: ms }), true);
  assert.equal(isTrustedMicrosoftSignature({ status: 'Valid', subject: 'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US' }), true);
  assert.equal(isTrustedMicrosoftSignature({ status: 'NotSigned', subject: '' }), false);
  assert.equal(isTrustedMicrosoftSignature({ status: 'HashMismatch', subject: ms }), false);
  assert.equal(isTrustedMicrosoftSignature({ status: 'Valid', subject: 'CN=Evil Corp, O=Evil Corp' }), false);
  assert.equal(isTrustedMicrosoftSignature({ status: 'Valid', subject: 'CN=Microsoft Corporation, O=Microsoft Corporation Ltd' }), false);
  assert.equal(isTrustedMicrosoftSignature({ status: 'Valid', subject: 'CN=Microsoft Corporation, OU=O=Microsoft Corporation' }), false);
  assert.equal(isTrustedMicrosoftSignature(null), false);
  assert.equal(isTrustedMicrosoftSignature({}), false);
});

test('a Disabled Store deployment service is reported, unless the app is WPM', () => {
  const allEnabled = [
    { name: 'InstallService', startType: 'Manual' },
    { name: 'ClipSVC', startType: 'Manual' },
    { name: 'AppXSvc', startType: 'Automatic' },
  ];
  assert.deepEqual(disabledDeploymentServices(allEnabled, 'WindowsUpdate'), []);

  const oneDisabled = [
    { name: 'InstallService', startType: 'Disabled' },
    { name: 'ClipSVC', startType: 'Manual' },
    { name: 'AppXSvc', startType: 'Automatic' },
  ];
  assert.deepEqual(disabledDeploymentServices(oneDisabled, 'WindowsUpdate'), ['InstallService']);
  assert.deepEqual(disabledDeploymentServices(oneDisabled, null), ['InstallService'], 'unknown delivery is treated like WindowsUpdate');
  assert.deepEqual(disabledDeploymentServices(oneDisabled, 'WPM'), [], 'WPM apps use the vendor installer, not Appx deployment');

  const allDisabled = [
    { name: 'InstallService', startType: 'Disabled' },
    { name: 'ClipSVC', startType: 'Disabled' },
    { name: 'AppXSvc', startType: 'Disabled' },
  ];
  assert.deepEqual(disabledDeploymentServices(allDisabled, 'WindowsUpdate'), ['InstallService', 'ClipSVC', 'AppXSvc']);

  assert.deepEqual(disabledDeploymentServices([], 'WindowsUpdate'), [], 'a service ghostget could not read is not assumed Disabled');
});

// --- downloads against the mock server -------------------------------------------------------

let mock;
let dir;
before(async () => {
  mock = await startMockStore();
});
after(() => mock.close());
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ghostget-test-'));
  mock.state.installer.status = 200;
  mock.state.installer.body = fakeExe(4096);
  mock.state.installer.truncateAt = null;
  mock.state.installer.headers = { 'content-type': 'application/octet-stream', 'content-disposition': REAL_DISPOSITION };
});
const cleanup = () => rm(dir, { recursive: true, force: true });
const download = (extra = {}) => downloadInstaller('9N8CJ4W95TBZ', { endpoints: mock.endpoints, env: {}, dir, ...extra });

test('downloads the installer, names it like the server does, and hashes it', async () => {
  try {
    const events = [];
    const file = await download({ onProgress: (p) => events.push(p) });
    assert.equal(file.fileName, 'ChatGPT (Beta) Installer.exe');
    assert.equal(file.path, path.join(dir, 'ChatGPT (Beta) Installer.exe'));
    assert.equal(file.size, 4096);
    assert.equal(file.id, '9N8CJ4W95TBZ');
    const onDisk = await readFile(file.path);
    assert.equal(file.sha256, createHash('sha256').update(onDisk).digest('hex'));
    assert.ok(events.length > 0);
    assert.deepEqual(events.at(-1), { received: 4096, total: 4096 });
    assert.deepEqual(await readdir(dir), ['ChatGPT (Beta) Installer.exe'], 'no .part file is left behind');
    assert.match(mock.state.requests.at(-1), /^GET \/installer\/9N8CJ4W95TBZ\?cid=website_cta_psi$/);
  } finally {
    await cleanup();
  }
});

test('an unknown product is a not-found error', async () => {
  try {
    await assert.rejects(downloadInstaller('9ZZZZZZZZZZZ', { endpoints: mock.endpoints, env: {}, dir }), (e) => e instanceof GhostgetError && e.code === 'E_NOT_FOUND' && e.exitCode === 3);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await cleanup();
  }
});

test('an HTML error page is not saved as an installer', async () => {
  mock.state.installer.headers = { 'content-type': 'text/html; charset=utf-8' };
  mock.state.installer.body = Buffer.from('<html>Access denied</html>');
  try {
    await assert.rejects(download(), (e) => e.code === 'E_BAD_RESPONSE');
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await cleanup();
  }
});

test('a body that is not a Windows executable is discarded', async () => {
  mock.state.installer.body = Buffer.alloc(4096, 65);
  try {
    await assert.rejects(download(), (e) => e.code === 'E_BAD_RESPONSE' && /not a Windows executable/.test(e.message));
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await cleanup();
  }
});

test('a tiny body is discarded even if it starts with MZ', async () => {
  mock.state.installer.body = fakeExe(100);
  try {
    await assert.rejects(download(), (e) => e.code === 'E_BAD_RESPONSE');
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await cleanup();
  }
});

test('a connection cut mid-download leaves nothing behind', async () => {
  mock.state.installer.body = fakeExe(200_000);
  mock.state.installer.truncateAt = 50_000;
  try {
    await assert.rejects(download(), (e) => e instanceof GhostgetError && e.exitCode === 5);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await cleanup();
  }
});

test('a hostile filename is kept inside the target folder', async () => {
  mock.state.installer.headers = { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="..\\..\\..\\evil.exe"' };
  try {
    const file = await download();
    assert.equal(path.dirname(file.path), dir);
    assert.equal(file.fileName, 'evil.exe');
    assert.ok(existsSync(file.path));
  } finally {
    await cleanup();
  }
});

test('falls back to an id-based name when the server sends none', async () => {
  mock.state.installer.headers = { 'content-type': 'application/octet-stream' };
  try {
    assert.equal((await download()).fileName, '9N8CJ4W95TBZ-installer.exe');
  } finally {
    await cleanup();
  }
});

test('downloading needs a product id, not a name', async () => {
  await assert.rejects(downloadInstaller('chatgpt', { endpoints: mock.endpoints, env: {}, dir: os.tmpdir() }), (e) => e.code === 'E_USAGE');
});
