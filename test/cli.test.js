import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { fakeExe, fakeStream, startMockStore } from './support/mock-store.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const win = process.platform === 'win32';

let mock;
let threeCards;
before(async () => {
  mock = await startMockStore();
  threeCards = mock.state.storeSearch.body;
});
after(() => mock.close());
beforeEach(() => {
  mock.state.storeSearch.body = threeCards;
  mock.state.manifestSearch.body = { Data: [] };
  mock.state.requests.length = 0;
  mock.state.installer.body = fakeExe(4096);
});

async function run(argv, { env = mock.env } = {}) {
  const stdout = fakeStream();
  const stderr = fakeStream();
  const code = await main(argv, { stdout, stderr, stdin: { isTTY: false }, env });
  return { code, out: stdout.text, err: stderr.text };
}

test('--version prints just the version', async () => {
  const r = await run(['--version']);
  assert.deepEqual([r.code, r.out.trim()], [0, version]);
});

test('the installed executable starts and answers --version', () => {
  const bin = fileURLToPath(new URL('../bin/ghostget.js', import.meta.url));
  const r = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), version);
});

test('no arguments and --help show the commands', async () => {
  for (const argv of [[], ['--help'], ['help']]) {
    const r = await run(argv);
    assert.equal(r.code, 0);
    for (const word of ['search', 'install', 'download', 'url', 'list', 'doctor', 'Exit codes']) assert.match(r.out, new RegExp(word));
  }
});

test('help <command> describes one command', async () => {
  const r = await run(['help', 'install']);
  assert.equal(r.code, 0);
  assert.match(r.out, /ghostget install <app>/);
  assert.match(r.out, /--dry-run/);
});

test('an unknown command is a usage error', async () => {
  const r = await run(['frobnicate']);
  assert.equal(r.code, 2);
  assert.match(r.err, /Unknown command "frobnicate"/);
});

test('an unknown option is a usage error, not a stack trace', async () => {
  const r = await run(['search', 'x', '--nope']);
  assert.equal(r.code, 2);
  assert.match(r.err, /Unknown option '--nope'/);
  assert.doesNotMatch(r.err, /at .*\.js/);
});

test('an option that does not apply to the command is rejected', async () => {
  const r = await run(['search', 'x', '--dry-run']);
  assert.equal(r.code, 2);
  assert.match(r.err, /--dry-run does not apply to "search"/);
});

test('command aliases work', async () => {
  const r = await run(['s', 'music']);
  assert.equal(r.code, 0);
  assert.match(r.out, /Spotify/);
});

test('search prints a table with ids', async () => {
  const r = await run(['search', 'music']);
  assert.equal(r.code, 0);
  assert.match(r.out, /Name\s+Id\s+Publisher\s+Price/);
  assert.match(r.out, /Spotify - Music and Podcasts\s+9NCBCSZSJRSB\s+Spotify AB\s+Free/);
  assert.match(r.out, /ghostget install <Id>/);
});

test('search --json is machine readable and quiet', async () => {
  const r = await run(['search', 'music', '--json']);
  assert.equal(r.code, 0);
  const rows = JSON.parse(r.out);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, '9NCBCSZSJRSB');
  assert.equal(r.err, '');
});

test('search with no hits exits 3', async () => {
  mock.state.storeSearch.body = { Payload: { SearchResults: [] } };
  const r = await run(['search', 'zzz']);
  assert.equal(r.code, 3);
  assert.match(r.out, /No apps found/);
});

test('search validates --limit', async () => {
  const r = await run(['search', 'music', '--limit', '99']);
  assert.equal(r.code, 2);
  assert.match(r.err, /--limit/);
});

test('url prints only the URL on stdout', async () => {
  const r = await run(['url', '9N8CJ4W95TBZ']);
  assert.equal(r.code, 0);
  assert.equal(r.out, `${mock.base}/installer/9N8CJ4W95TBZ?cid=website_cta_psi\n`);
  assert.equal(r.err, '');
});

test('url accepts a Store URL, a custom --cid and --json', async () => {
  const r = await run(['url', 'https://apps.microsoft.com/detail/9n8cj4w95tbz', '--cid', 'abc', '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out), { id: '9N8CJ4W95TBZ', name: null, url: `${mock.base}/installer/9N8CJ4W95TBZ?cid=abc` });
});

test('url on an ambiguous name prints nothing on stdout and exits 4', async () => {
  const r = await run(['url', 'music']);
  assert.equal(r.code, 4);
  assert.equal(r.out, '');
  assert.match(r.err, /matches 3 apps/);
  assert.match(r.err, /9NCBCSZSJRSB/);
  assert.match(r.err, /exact Store id/);
});

test('show prints the details', async () => {
  const r = await run(['show', '9N8CJ4W95TBZ']);
  assert.equal(r.code, 0);
  assert.match(r.out, /^ChatGPT \(Beta\) \[9N8CJ4W95TBZ\]/);
  assert.match(r.out, /Publisher\s+OpenAI/);
  assert.match(r.out, /Price\s+Free/);
  assert.match(r.out, /Version\s+26\.727\.4816\.0/);
  assert.match(r.out, /Delivery\s+WindowsUpdate/);
  assert.match(r.out, /Installer\s+http:\/\/127\.0\.0\.1:\d+\/installer\/9N8CJ4W95TBZ/);
});

test('show --json includes the installer URL', async () => {
  const r = await run(['show', '9N8CJ4W95TBZ', '--json']);
  const data = JSON.parse(r.out);
  assert.equal(data.name, 'ChatGPT (Beta)');
  assert.equal(data.installerUrl, `${mock.base}/installer/9N8CJ4W95TBZ?cid=website_cta_psi`);
});

test('show for an unknown id exits 3', async () => {
  const r = await run(['show', '9ZZZZZZZZZZZ']);
  assert.equal(r.code, 3);
  assert.match(r.err, /No Microsoft Store product/);
});

test('install --dry-run resolves the app but downloads and launches nothing', async () => {
  const r = await run(['install', '9N8CJ4W95TBZ', '--dry-run']);
  assert.equal(r.code, 0);
  assert.match(r.out, /Found ChatGPT \(Beta\) \[9N8CJ4W95TBZ\] . OpenAI . Free/);
  assert.match(r.out, /Dry run/);
  assert.ok(!mock.state.requests.some((q) => q.includes('/installer/')), 'the installer endpoint was not contacted');
});

test('install refuses a paid app unless forced', async () => {
  const refused = await run(['install', '9PGLL77C201J', '--dry-run']);
  assert.equal(refused.code, 8);
  assert.match(refused.err, /is a paid app \(59\.99 USD\)/);
  assert.match(refused.err, /never handles payment/);
  const forced = await run(['install', '9PGLL77C201J', '--dry-run', '--force']);
  assert.equal(forced.code, 0);
});

test('errors are structured JSON under --json', async () => {
  const r = await run(['install', '9PGLL77C201J', '--dry-run', '--json']);
  assert.equal(r.code, 8);
  assert.equal(r.out, '');
  assert.equal(JSON.parse(r.err).error.code, 'E_PAID');
});

test('show works for a Win32 app the display catalog does not know', async () => {
  const r = await run(['show', 'XP9KHM4BK9FZ7Q']);
  assert.equal(r.code, 0);
  assert.match(r.out, /^Visual Studio Code \[XP9KHM4BK9FZ7Q\]/);
  assert.match(r.out, /Delivery\s+WPM/);
});

test('install --dry-run works for a free Win32 app', async () => {
  const r = await run(['install', 'XP9KHM4BK9FZ7Q', '--dry-run']);
  assert.equal(r.code, 0);
  assert.match(r.out, /Found Visual Studio Code \[XP9KHM4BK9FZ7Q\]/);
});

test('install refuses a paid Win32 app even though its numeric price is 0', async () => {
  const r = await run(['install', 'XPFD4T9N395QN6', '--dry-run']);
  assert.equal(r.code, 8);
  assert.match(r.err, /Adobe Photoshop is a paid app\./);
});

test('install without an app is a usage error', async () => {
  const r = await run(['install']);
  assert.equal(r.code, 2);
  assert.match(r.err, /Which app\?/);
});

test('a real install off Windows says so and exits 6', { skip: win }, async () => {
  const r = await run(['install', '9N8CJ4W95TBZ']);
  assert.equal(r.code, 6);
  assert.match(r.err, /needs Windows/);
  assert.ok(!mock.state.requests.some((q) => q.includes('/installer/')), 'nothing was downloaded');
});

test('list off Windows says so and exits 6', { skip: win }, async () => {
  const r = await run(['list']);
  assert.equal(r.code, 6);
});

test('download --no-verify saves the file and prints its path', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ghostget-cli-'));
  try {
    const r = await run(['download', '9N8CJ4W95TBZ', '--dir', dir, '--no-verify']);
    assert.equal(r.code, 0);
    const file = r.out.trim();
    assert.equal(file, path.join(dir, 'ChatGPT (Beta) Installer.exe'));
    assert.ok(existsSync(file));
    assert.match(r.err, /Skipped the signature check/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('download of an unsigned file is rejected and deleted on Windows', { skip: !win }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ghostget-cli-'));
  try {
    const r = await run(['download', '9N8CJ4W95TBZ', '--dir', dir]);
    assert.equal(r.code, 7);
    assert.match(r.err, /not signed by Microsoft/);
    assert.deepEqual(await readdir(dir), []);
    assert.equal(r.out, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('download off Windows warns that it could not check the signature', { skip: win }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ghostget-cli-'));
  try {
    const r = await run(['download', '9N8CJ4W95TBZ', '--dir', dir]);
    assert.equal(r.code, 0);
    assert.match(r.err, /signature was not checked/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('doctor --json reports the network checks against the configured endpoints', async () => {
  const r = await run(['doctor', '--json']);
  const report = JSON.parse(r.out);
  const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
  for (const id of ['net:installer', 'net:catalog', 'net:search']) assert.equal(byId[id].status, 'ok', id);
  assert.equal(report.system.platform, process.platform);
  if (!win) assert.equal(byId.windows.status, 'skip');
});

test('doctor fails loudly when the network is unreachable', async () => {
  const env = { ...mock.env, GHOSTGET_INSTALLER_URL: 'http://127.0.0.1:1/installer' };
  const r = await run(['doctor'], { env });
  assert.equal(r.code, 1);
  assert.match(r.out, /Web installer\s+127\.0\.0\.1:1 unreachable/);
  assert.match(r.out, /Something needs attention/);
});
