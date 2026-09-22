import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GhostgetError, verifyInstaller } from '../src/index.js';
import { assertTrustedInstaller } from '../src/installer.js';
import { assertWindows, cleanEnvForPS51, cleanPowerShellError, getServices, scheduleServiceRestore, setServiceRunning } from '../src/windows.js';
import { fakeExe } from './support/mock-store.js';

const win = process.platform === 'win32';

test('extracts readable text from PowerShell CLIXML errors', () => {
  const clixml =
    '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
    '<S S="Error">Get-Foo : File C:\\x was not found._x000D__x000A_</S>' +
    '<S S="Error">At line:2 char:6_x000D__x000A_</S></Objs>';
  assert.equal(cleanPowerShellError(clixml), 'Get-Foo : File C:\\x was not found.');
  assert.equal(cleanPowerShellError('  plain text  '), 'plain text');
  assert.equal(cleanPowerShellError('#< CLIXML\r\n<Objs><S S="Error">a &lt; b &amp; c</S></Objs>'), 'a < b & c');
});

test('cleanEnvForPS51 drops PSModulePath regardless of case, keeps everything else', () => {
  assert.deepEqual(cleanEnvForPS51({ Path: 'C:\\x', PSModulePath: 'C:\\bad' }), { Path: 'C:\\x' });
  assert.deepEqual(cleanEnvForPS51({ PSMODULEPATH: 'C:\\bad', PSModulePath: 'C:\\also-bad' }), {});
  assert.deepEqual(cleanEnvForPS51({ Path: 'C:\\x' }), { Path: 'C:\\x' }, 'a clean env is returned unchanged');
});

test('off Windows, Windows-only steps explain themselves', { skip: win }, () => {
  assert.throws(
    () => assertWindows('Installing apps'),
    (e) => e instanceof GhostgetError && e.code === 'E_UNSUPPORTED_PLATFORM' && e.exitCode === 6 && /needs Windows/.test(e.message),
  );
});

test('a Microsoft-signed system binary is trusted', { skip: !win }, async () => {
  const cmd = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
  const sig = await verifyInstaller(cmd);
  assert.equal(sig.status, 'Valid');
  assert.match(sig.subject, /O=Microsoft Corporation/);
  assert.equal(sig.trusted, true);
});

test('an unsigned executable is not trusted, and assertTrustedInstaller deletes it', { skip: !win }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ghostget-win-'));
  const file = path.join(dir, 'unsigned.exe');
  try {
    await writeFile(file, fakeExe(8192));
    assert.equal((await verifyInstaller(file)).trusted, false);
    await assert.rejects(
      assertTrustedInstaller(file),
      (e) => e instanceof GhostgetError && e.code === 'E_SIGNATURE' && e.exitCode === 7,
    );
    assert.equal(existsSync(file), false, 'the untrusted file was removed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a missing file is a clear error, not a crash', { skip: !win }, async () => {
  await assert.rejects(verifyInstaller(path.join(os.tmpdir(), 'ghostget-does-not-exist.exe')), (e) => e.code === 'E_POWERSHELL' && /not found/i.test(e.message));
});

test('getServices returns real services and skips unknown ones', { skip: !win }, async () => {
  const rows = await getServices(['wuauserv', 'Definitely-Not-A-Service']);
  assert.deepEqual(rows.map((r) => r.name), ['wuauserv']);
  assert.match(rows[0].startType, /^(Automatic|Manual|Disabled|Boot|System)/);
});

test('setServiceRunning fails gracefully instead of throwing, for a service that does not exist', { skip: !win }, async () => {
  const result = await setServiceRunning('Definitely-Not-A-Service', 'start');
  assert.equal(result.ok, false);
  assert.equal(typeof result.message, 'string');
});

test('setServiceRunning can start a real service without admin rights (ClipSVC is designed to be triggered by ordinary Store usage)', { skip: !win }, async () => {
  const before = await getServices(['ClipSVC']);
  if (!before.length || before[0].startType === 'Disabled') return; // nothing to prove on a machine without it, or with it Disabled
  const result = await setServiceRunning('ClipSVC', 'start');
  assert.equal(result.ok, true, result.message);
  const after = await getServices(['ClipSVC']);
  assert.equal(after[0].status, 'Running');
});

test('scheduleServiceRestore with no services is a no-op', { skip: !win }, () => {
  assert.doesNotThrow(() => scheduleServiceRestore({ services: [] }));
});
