// @ts-check
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extractProductId } from './catalog.js';
import { resolveEndpoints } from './config.js';
import { DEFAULT_CAMPAIGN_ID, USER_AGENT } from './constants.js';
import { EXIT, GhostgetError, usageError } from './errors.js';
import { httpError, networkError } from './http.js';
import { resolveProduct } from './resolve.js';
import { sleep } from './util.js';
import {
  assertWindows,
  elevateAndFixDisabledServices,
  getAuthenticode,
  getInstalledPackages,
  getServices,
  scheduleServiceRestore,
  setServiceRunning,
  startProcess,
} from './windows.js';

/**
 * @typedef {object} UrlOptions
 * @property {string} [campaignId] Overrides the `cid` query value. Default `website_cta_psi`, what Microsoft's own site uses.
 * @property {Partial<import('./config.js').Endpoints>} [endpoints]
 * @property {NodeJS.ProcessEnv} [env]
 */

/**
 * The direct Microsoft Store Web Installer link for a product.
 * @param {string} target A product id or Store URL.
 * @param {UrlOptions} [opts]
 * @returns {string}
 */
export function buildInstallerUrl(target, opts = {}) {
  const id = extractProductId(target);
  if (!id) {
    throw usageError(`"${target}" is not a Microsoft Store product id.`, 'Ids look like 9N8CJ4W95TBZ (12 characters) or XP9KHM4BK9FZ7Q (14 characters).');
  }
  const env = opts.env ?? process.env;
  const cid = opts.campaignId ?? env.GHOSTGET_CID ?? DEFAULT_CAMPAIGN_ID;
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(cid)) throw usageError(`"${cid}" is not a valid campaign id.`);
  const { installer } = resolveEndpoints(opts.endpoints, env);
  return `${installer}/${id}?cid=${encodeURIComponent(cid)}`;
}

/**
 * Filename from a Content-Disposition header (RFC 6266 / 5987), or null.
 * @param {string|null|undefined} header
 * @returns {string|null}
 */
export function parseContentDisposition(header) {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim());
    } catch {
      // fall back to the plain filename below
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted) return quoted[1].replace(/\\(.)/g, '$1');
  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  return bare ? bare[1].trim() : null;
}

/**
 * A server-supplied name is untrusted: strip directories, reserved characters and device names,
 * and make sure the result is an .exe.
 * @param {string|null|undefined} name
 * @param {string} fallback
 */
export function safeFileName(name, fallback) {
  let base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  if (!base || /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i.test(base)) return fallback;
  if (!/\.exe$/i.test(base)) base += '.exe';
  if (base.length > 120) base = `${base.slice(0, 116)}.exe`;
  return base;
}

/**
 * @typedef {object} DownloadOptions
 * @property {string} [dir] Where to save. Default: the current directory for `downloadInstaller`.
 * @property {(p: { received: number, total: number|null }) => void} [onProgress]
 * @property {typeof fetch} [fetch]
 * @property {AbortSignal} [signal]
 * @property {number} [timeoutMs] Whole download. Default 120 s (the file is under 1 MB).
 */

/**
 * @typedef {object} Downloaded
 * @property {string} id
 * @property {string} url
 * @property {string} path Absolute path of the saved file.
 * @property {string} fileName
 * @property {number} size
 * @property {string} sha256
 */

/**
 * Download the Store Web Installer for a product. Checks that it really is a Windows executable.
 * It does **not** run it, and does not verify its signature: use {@link verifyInstaller} for that.
 * @param {string} target A product id or Store URL.
 * @param {DownloadOptions & UrlOptions} [opts]
 * @returns {Promise<Downloaded>}
 */
export async function downloadInstaller(target, opts = {}) {
  const id = /** @type {string} */ (extractProductId(target));
  const url = buildInstallerUrl(target, opts);
  const dir = path.resolve(opts.dir ?? process.cwd());
  const doFetch = opts.fetch ?? globalThis.fetch;
  const signals = [AbortSignal.timeout(opts.timeoutMs ?? 120_000)];
  if (opts.signal) signals.push(opts.signal);

  /** @type {Response} */
  let res;
  try {
    res = await doFetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/octet-stream,*/*' },
      redirect: 'follow',
      signal: AbortSignal.any(signals),
    });
  } catch (cause) {
    throw networkError(url, cause);
  }

  if (res.status === 404) {
    throw new GhostgetError(`The Store has no web installer for ${id}.`, {
      code: 'E_NOT_FOUND',
      exitCode: EXIT.NOT_FOUND,
      hint: 'Check the id with: ghostget show ' + id,
    });
  }
  if (!res.ok) throw httpError(res);
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.body || /text\/html|json/i.test(contentType)) {
    throw new GhostgetError('Microsoft did not send an installer.', {
      code: 'E_BAD_RESPONSE',
      exitCode: EXIT.NETWORK,
      hint: `Got "${contentType || 'no content type'}". Try again in a moment.`,
    });
  }

  const declared = Number(res.headers.get('content-length')) || null;
  const fileName = safeFileName(parseContentDisposition(res.headers.get('content-disposition')), `${id}-installer.exe`);
  await mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, fileName);
  const partPath = `${finalPath}.${process.pid}.part`;

  const hash = createHash('sha256');
  let received = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      hash.update(chunk);
      opts.onProgress?.({ received, total: declared });
      callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(/** @type {any} */ (res.body)), counter, createWriteStream(partPath));
    if (declared !== null && received !== declared) {
      throw new GhostgetError(`The download was cut short (${received} of ${declared} bytes).`, { code: 'E_DOWNLOAD', exitCode: EXIT.NETWORK });
    }
    if (received < 1024 || !(await startsWithMZ(partPath))) {
      throw new GhostgetError('The downloaded file is not a Windows executable.', { code: 'E_BAD_RESPONSE', exitCode: EXIT.NETWORK });
    }
    await rename(partPath, finalPath);
  } catch (err) {
    await rm(partPath, { force: true });
    if (err instanceof GhostgetError) throw err;
    if (opts.signal?.aborted) throw err;
    throw networkError(url, err);
  }

  return { id, url, path: finalPath, fileName, size: received, sha256: hash.digest('hex') };
}

/** @param {string} file */
async function startsWithMZ(file) {
  const handle = await open(file, 'r');
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(2), 0, 2, 0);
    return bytesRead === 2 && buffer[0] === 0x4d && buffer[1] === 0x5a;
  } finally {
    await handle.close();
  }
}

/**
 * True for a valid Authenticode signature whose signer organisation is Microsoft Corporation.
 * @param {{ status?: string, subject?: string }|null|undefined} sig
 */
export function isTrustedMicrosoftSignature(sig) {
  return sig?.status === 'Valid' && /(?:^|,\s*)O=Microsoft Corporation(?:,|$)/.test(sig.subject ?? '');
}

/**
 * Check a downloaded installer's Authenticode signature (Windows only).
 * @param {string} file
 * @returns {Promise<import('./windows.js').AuthenticodeInfo & { trusted: boolean }>}
 */
export async function verifyInstaller(file) {
  assertWindows('Verifying the installer signature');
  const sig = await getAuthenticode(file);
  return { ...sig, trusted: isTrustedMicrosoftSignature(sig) };
}

/**
 * Like {@link verifyInstaller}, but throws and deletes the file when the signature is not Microsoft's.
 * @param {string} file
 */
export async function assertTrustedInstaller(file) {
  const sig = await verifyInstaller(file);
  if (!sig.trusted) {
    await rm(file, { force: true });
    throw new GhostgetError('The installer is not signed by Microsoft, so ghostget deleted it and did not run it.', {
      code: 'E_SIGNATURE',
      exitCode: EXIT.VERIFY,
      hint: 'Try again. If it keeps happening, your network may be tampering with downloads.',
      details: { status: sig.status, subject: sig.subject, message: sig.message },
    });
  }
  return sig;
}

/**
 * Start an installer the way Explorer would. Windows only. Does not wait for it to finish.
 * @param {string} file
 * @returns {Promise<{ pid: number|null }>}
 */
export async function launchInstaller(file) {
  assertWindows('Launching the installer');
  return { pid: await startProcess(file) };
}

/** Where `installApp` keeps downloads unless told otherwise. */
export function defaultDownloadRoot(env = process.env) {
  return env.GHOSTGET_DIR ? path.resolve(env.GHOSTGET_DIR) : path.join(os.tmpdir(), 'ghostget');
}

/**
 * Best effort: remove download folders older than a day. Never throws.
 * @param {string} root
 * @param {number} [maxAgeMs]
 */
async function cleanupStale(root, maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(root, entry.name);
      const { mtimeMs } = await stat(full);
      if (Date.now() - mtimeMs > maxAgeMs) await rm(full, { recursive: true, force: true });
    }
  } catch {
    // nothing to clean, or a file is still in use
  }
}

/**
 * Services the Store package deployment path needs, whatever it delivers through. Distinct from
 * `wuauserv` itself, which only some apps need (see the warning below): `UsoSvc` (Update
 * Orchestrator Service) and `DoSvc` (Delivery Optimization) are what actually run the "WU"
 * fulfillment plugin a `WindowsUpdate`-delivered app's download uses. Proven live: with both
 * Disabled, the Store app gets as far as "Downloading" and then fails with a COM E_NOINTERFACE
 * error, even though `InstallService`/`ClipSVC`/`AppXSvc`/`wuauserv` were all fine -- indistinguishable
 * from the outside from the Store window just hanging.
 */
const DEPLOYMENT_SERVICES = ['InstallService', 'ClipSVC', 'AppXSvc', 'UsoSvc', 'DoSvc'];

/**
 * Which of {@link DEPLOYMENT_SERVICES} are Disabled, for the given delivery type. Pure function:
 * `WPM` apps run the vendor's own installer, not an MSIX/Appx package, so none of this applies to them.
 * @param {{ name: string, startType: string }[]} services
 * @param {string|null} [delivery]
 * @returns {string[]}
 */
export function disabledDeploymentServices(services, delivery) {
  if (delivery === 'WPM') return [];
  return DEPLOYMENT_SERVICES.filter((n) => services.find((s) => s.name === n)?.startType === 'Disabled');
}

/**
 * Which of {@link DEPLOYMENT_SERVICES} are enabled (`Manual`/`Automatic`) but not actually `Running`.
 * Windows normally starts a `Manual` service itself the moment something needs it, but that trigger
 * does not always fire right after the service is switched on from `Disabled` — the Store then falls
 * back to opening its own app window for the person to finish the install by hand instead of deploying
 * the package silently. Pure function, same WPM exemption as {@link disabledDeploymentServices}.
 * @param {{ name: string, status: string, startType: string }[]} services
 * @param {string|null} [delivery]
 * @returns {string[]}
 */
export function stalledDeploymentServices(services, delivery) {
  if (delivery === 'WPM') return [];
  return DEPLOYMENT_SERVICES.filter((n) => {
    const s = services.find((s) => s.name === n);
    return s && s.startType !== 'Disabled' && s.status !== 'Running';
  });
}

/**
 * @typedef {object} InstallOptions
 * @property {boolean} [dryRun] Resolve and report, but download and run nothing.
 * @property {boolean} [noVerify] Skip the signature check (not recommended).
 * @property {boolean} [force] Proceed even if the app is paid, already installed, or a Store deployment service is Disabled.
 * @property {boolean} [noElevate] Don't ask Windows for permission (a UAC prompt) to fix a `Disabled` deployment
 *   service; fall back straight to the `E_SERVICE_DISABLED` error (or the warning, with `force`) instead. For
 *   scripts and CI, where nobody is there to answer a prompt.
 * @property {boolean} [wait] After launching, wait until the app shows up as installed (Appx/MSIX apps only).
 * @property {number} [waitTimeoutMs] How long `wait` may take. Default 10 minutes.
 * @property {boolean} [exact] Require an exact name match when searching.
 * @property {string} [dir] Keep the installer here instead of a temporary folder.
 * @property {(event: InstallEvent) => void} [onEvent]
 * @property {(candidates: import('./catalog.js').SearchResult[]) => Promise<import('./catalog.js').SearchResult|null>} [choose]
 */

/**
 * @typedef {{ type: 'resolved', id: string, name: string, product: import('./catalog.js').Product|null }
 *   | { type: 'warning', message: string }
 *   | { type: 'service-started', name: string }
 *   | { type: 'elevating', services: string[] }
 *   | { type: 'elevated', services: string[] }
 *   | { type: 'download-start', url: string }
 *   | { type: 'progress', received: number, total: number|null }
 *   | { type: 'downloaded', file: Downloaded }
 *   | { type: 'verified', subject: string }
 *   | { type: 'launched', pid: number|null }
 *   | { type: 'waiting', pfns: string[] }
 * } InstallEvent
 */

/**
 * @typedef {object} InstallResult
 * @property {'dry-run'|'already-installed'|'launched'|'installed'|'wait-timeout'} status
 * @property {string} id
 * @property {string} name
 * @property {import('./catalog.js').Product|null} product
 * @property {string} installerUrl
 * @property {string} [installedVersion]
 * @property {Downloaded} [file]
 * @property {string} [signer]
 * @property {number|null} [pid]
 */

/**
 * The whole flow: resolve the app, download Microsoft's web installer, verify its signature, launch it.
 * Windows only, except with `dryRun`.
 * @param {string} target A product id, Store URL or app name.
 * @param {InstallOptions & UrlOptions & import('./catalog.js').CatalogOptions & { fetch?: typeof fetch }} [opts]
 * @returns {Promise<InstallResult>}
 */
export async function installApp(target, opts = {}) {
  /** @param {InstallEvent} event */
  const emit = (event) => opts.onEvent?.(event);

  const resolved = await resolveProduct(target, {
    ...opts,
    details: 'auto',
    onWarn: (message) => emit({ type: 'warning', message }),
  });
  const { id, product } = resolved;
  const name = product?.name ?? resolved.candidate?.name ?? id;
  emit({ type: 'resolved', id, name, product });

  const installerUrl = buildInstallerUrl(id, opts);
  const base = { id, name, product, installerUrl };

  if (product?.price.free === false && !opts.force) {
    const cost = product.price.amount === null ? '' : ` (${[product.price.amount, product.price.currency].filter(Boolean).join(' ')})`;
    throw new GhostgetError(`${name} is a paid app${cost}.`, {
      code: 'E_PAID',
      exitCode: EXIT.PAID,
      hint: 'The web installer cannot buy it for you and ghostget never handles payment. Use --force to open the installer anyway.',
    });
  }

  if (opts.dryRun) return { status: 'dry-run', ...base };

  assertWindows('Installing apps');

  const pfns = product?.packageFamilyNames ?? resolved.candidate?.packageFamilyNames ?? [];
  const [installed, services] = await Promise.all([
    pfns.length ? getInstalledPackages({ pfns }) : Promise.resolve([]),
    getServices([...DEPLOYMENT_SERVICES, 'wuauserv']).catch(() => []),
  ]);

  if (installed.length && !opts.force) {
    return { status: 'already-installed', installedVersion: installed[0].version, ...base };
  }

  const delivery = product?.delivery ?? resolved.candidate?.delivery ?? null;

  const disabled = disabledDeploymentServices(services, delivery);
  if (disabled.length) {
    const are = disabled.length > 1 ? 'are' : 'is';
    const message = `Windows cannot deploy Store packages right now: ${disabled.join(', ')} ${are} Disabled. Downloading and launching the installer will not be enough to finish installing ${name}.`;
    const fix = `${disabled.map((n) => `Set-Service -Name ${n} -StartupType Manual`).join('; ')}   # PowerShell as Administrator`;
    if (!opts.noElevate) {
      emit({ type: 'elevating', services: disabled });
      const elevated = await elevateAndFixDisabledServices({ services: disabled, pfns, timeoutMs: opts.waitTimeoutMs ?? 10 * 60_000, env: opts.env });
      if (elevated.ok) {
        emit({ type: 'elevated', services: disabled });
      } else if (!opts.force) {
        throw new GhostgetError(message, {
          code: 'E_SERVICE_DISABLED',
          exitCode: EXIT.SERVICE,
          hint: `Asking Windows for permission didn't work (${elevated.message}). ${fix}. Then retry, or pass --force to launch the installer anyway.`,
          details: { services: disabled },
        });
      } else {
        emit({ type: 'warning', message: `${message} Asking Windows for permission didn't work (${elevated.message}). ${fix}` });
      }
    } else if (!opts.force) {
      throw new GhostgetError(message, {
        code: 'E_SERVICE_DISABLED',
        exitCode: EXIT.SERVICE,
        hint: `${fix}. Then retry, or pass --force to launch the installer anyway.`,
        details: { services: disabled },
      });
    } else {
      emit({ type: 'warning', message: `${message} ${fix}` });
    }
    // Elevation, when it worked, already fixes, watches and restores these services end to end
    // (inside that one elevated process) -- nothing further to do for them here.
  }

  const stalled = stalledDeploymentServices(services, delivery).filter((n) => !disabled.includes(n));
  /** Services ghostget itself started, so it knows what to try putting back afterward. */
  const startedByUs = [];
  for (const svcName of stalled) {
    const started = await setServiceRunning(svcName, 'start');
    if (started.ok) {
      startedByUs.push(svcName);
      emit({ type: 'service-started', name: svcName });
    } else {
      emit({
        type: 'warning',
        message: `${svcName} is enabled but not running, and ghostget could not start it itself (${started.message}). If the Store window opens without finishing the install, run: Start-Service -Name ${svcName}   # PowerShell as Administrator`,
      });
    }
  }

  const updateService = services.find((s) => s.name === 'wuauserv');
  if (updateService?.startType === 'Disabled' && delivery !== 'WPM') {
    emit({
      type: 'warning',
      message:
        (delivery === 'WindowsUpdate'
          ? 'The Store delivers this app through Windows Update, and the Windows Update service (wuauserv) is Disabled. '
          : 'The Windows Update service (wuauserv) is Disabled, and the Store may need it to deliver this app. ') +
        'If the installer stalls, set it to Manual (it will not update Windows by itself): Set-Service wuauserv -StartupType Manual',
    });
  }

  const usingTemp = !opts.dir;
  const root = opts.dir ? path.resolve(opts.dir) : defaultDownloadRoot(opts.env);
  if (usingTemp) await cleanupStale(root);
  const dir = usingTemp ? path.join(root, `${id}-${Date.now().toString(36)}`) : root;

  emit({ type: 'download-start', url: installerUrl });
  const file = await downloadInstaller(id, {
    ...opts,
    dir,
    onProgress: (p) => emit({ type: 'progress', ...p }),
  });
  emit({ type: 'downloaded', file });

  /** @type {string|undefined} */
  let signer;
  if (!opts.noVerify) {
    const sig = await assertTrustedInstaller(file.path);
    signer = sig.subject;
    emit({ type: 'verified', subject: sig.subject });
  }

  const { pid } = await launchInstaller(file.path);
  emit({ type: 'launched', pid });
  const result = { ...base, file, signer, pid };

  if (opts.wait && pfns.length) {
    emit({ type: 'waiting', pfns });
    const deadline = Date.now() + (opts.waitTimeoutMs ?? 10 * 60_000);
    /** @type {import('./windows.js').InstalledPackage[]|null} */
    let found = null;
    while (Date.now() < deadline) {
      await sleep(4000, opts.signal);
      found = await getInstalledPackages({ pfns });
      if (found.length) break;
    }
    if (startedByUs.length) await Promise.all(startedByUs.map((n) => setServiceRunning(n, 'stop')));
    if (found?.length) return { status: 'installed', installedVersion: found[0].version, ...result };
    return { status: 'wait-timeout', ...result };
  }
  if (startedByUs.length) {
    scheduleServiceRestore({ services: startedByUs, pfns, timeoutMs: opts.waitTimeoutMs ?? 10 * 60_000, env: opts.env });
  }
  return { status: 'launched', ...result };
}
