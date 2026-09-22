// @ts-check
import os from 'node:os';
import { resolveEndpoints } from './config.js';
import { USER_AGENT } from './constants.js';
import { VERSION } from './version.js';
import { getServices, isWindows } from './windows.js';

/**
 * @typedef {object} Check
 * @property {string} id
 * @property {string} label
 * @property {'ok'|'warn'|'fail'|'skip'} status
 * @property {string} detail
 * @property {string} [fix] A command the user can run (never run by ghostget itself).
 */

/**
 * @typedef {object} Diagnostics
 * @property {{ ghostget: string, node: string, platform: string, arch: string, os: string, windows: string|null }} system
 * @property {Check[]} checks
 * @property {boolean} ok False when at least one check failed (warnings do not count).
 */

/**
 * Services the Store install path relies on. `wuauserv` is different: ghostget itself does not need it.
 * @type {{ name: string, label: string, needed: boolean }[]}
 */
const SERVICES = [
  { name: 'InstallService', label: 'Microsoft Store Install Service', needed: true },
  { name: 'ClipSVC', label: 'Client License Service', needed: true },
  { name: 'AppXSvc', label: 'AppX Deployment Service', needed: true },
  { name: 'BITS', label: 'Background Intelligent Transfer Service', needed: false },
  { name: 'wuauserv', label: 'Windows Update', needed: false },
];

/** @param {string} release e.g. `10.0.22621` */
function describeWindows(release) {
  const [major, , build] = release.split('.').map(Number);
  if (!Number.isFinite(major)) return null;
  if (major < 10) return `Windows ${major} (build ${build})`;
  return `${build >= 22000 ? 'Windows 11' : 'Windows 10'} (build ${build})`;
}

/**
 * @param {string} id
 * @param {string} label
 * @param {string} url
 * @param {RequestInit} init
 * @param {typeof fetch} doFetch
 * @returns {Promise<Check>}
 */
async function probe(id, label, url, init, doFetch) {
  const started = Date.now();
  const host = new URL(url).host;
  try {
    const res = await doFetch(url, {
      ...init,
      headers: { 'user-agent': USER_AGENT, ...init.headers },
      signal: AbortSignal.timeout(8000),
    });
    await res.body?.cancel();
    // 404 is the expected answer for the deliberately bogus installer id.
    const reachable = res.status < 500;
    return {
      id,
      label,
      status: reachable ? 'ok' : 'fail',
      detail: reachable ? `${host} reachable (${Date.now() - started} ms)` : `${host} answered ${res.status}`,
    };
  } catch (err) {
    const reason = err instanceof Error ? (err.name === 'TimeoutError' ? 'timed out' : err.message) : String(err);
    return { id, label, status: 'fail', detail: `${host} unreachable: ${reason}` };
  }
}

/**
 * Check whether this machine can use ghostget: Windows version, the Store services, and the network.
 * Read-only: it prints fixes but never applies them.
 * @param {{ env?: NodeJS.ProcessEnv, fetch?: typeof fetch }} [opts]
 * @returns {Promise<Diagnostics>}
 */
export async function runDiagnostics(opts = {}) {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const endpoints = resolveEndpoints({}, opts.env);
  /** @type {Check[]} */
  const checks = [];
  const windowsName = isWindows() ? describeWindows(os.release()) : null;

  if (!isWindows()) {
    checks.push({
      id: 'windows',
      label: 'Windows',
      status: 'skip',
      detail: 'Not Windows. search, show, url and download work here; install and list need Windows.',
    });
  } else {
    const major = Number(os.release().split('.')[0]);
    checks.push({
      id: 'windows',
      label: 'Windows version',
      status: major >= 10 ? 'ok' : 'fail',
      detail: windowsName ?? os.release(),
    });

    try {
      const found = await getServices(SERVICES.map((s) => s.name));
      for (const svc of SERVICES) {
        const info = found.find((f) => f.name === svc.name);
        const id = `service:${svc.name}`;
        const label = `${svc.label} (${svc.name})`;
        if (!info) {
          checks.push({ id, label, status: svc.needed ? 'fail' : 'warn', detail: 'service not found' });
          continue;
        }
        const detail = `${info.startType}, ${info.status}`;
        if (info.startType !== 'Disabled' && svc.needed && info.status !== 'Running') {
          checks.push({
            id,
            label,
            status: 'warn',
            detail: `${detail}. Not running yet; Windows usually starts it on demand, but if an install stalls with the Store window open, start it yourself.`,
            fix: `Start-Service -Name ${svc.name}   # run PowerShell as Administrator`,
          });
        } else if (info.startType !== 'Disabled') {
          checks.push({
            id,
            label,
            status: 'ok',
            detail: svc.name === 'wuauserv' ? `${detail} (fine: Windows will not update until something asks it to)` : detail,
          });
        } else if (svc.name === 'wuauserv') {
          checks.push({
            id,
            label,
            status: 'warn',
            detail: `${detail}. ghostget does not need it, but apps the Store delivers through Windows Update may stall while it is Disabled.`,
            fix: 'Set-Service -Name wuauserv -StartupType Manual   # Manual does not turn automatic updates back on',
          });
        } else {
          checks.push({
            id,
            label,
            status: svc.needed ? 'fail' : 'warn',
            detail: `${detail}. The Store installer depends on it.`,
            fix: `Set-Service -Name ${svc.name} -StartupType Manual   # run PowerShell as Administrator`,
          });
        }
      }
    } catch (err) {
      checks.push({
        id: 'services',
        label: 'Store services',
        status: 'warn',
        detail: `could not read service state: ${err instanceof Error ? err.message : err}`,
      });
    }
  }

  checks.push(
    ...(await Promise.all([
      probe('net:installer', 'Web installer', `${endpoints.installer}/9ZZZZZZZZZZZ`, {}, doFetch),
      probe('net:catalog', 'Product catalog', `${endpoints.displayCatalog}/products?bigIds=9N8CJ4W95TBZ&market=US&languages=en-US`, {}, doFetch),
      probe(
        'net:search',
        'Store search',
        `${endpoints.storeEdge}/manifestSearch`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ MaximumResults: 1, Query: { KeyWord: 'a', MatchType: 'Substring' } }) },
        doFetch,
      ),
    ])),
  );

  return {
    system: { ghostget: VERSION, node: process.versions.node, platform: process.platform, arch: process.arch, os: os.release(), windows: windowsName },
    checks,
    ok: !checks.some((c) => c.status === 'fail'),
  };
}
