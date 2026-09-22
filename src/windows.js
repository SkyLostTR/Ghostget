// @ts-check
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { EXIT, GhostgetError } from './errors.js';

/**
 * Everything that talks to Windows goes through this file, using Windows PowerShell 5.1
 * (present on every supported Windows). Scripts are passed with -EncodedCommand and all
 * data travels in environment variables, so no user-controlled text is ever spliced into
 * PowerShell source.
 *
 * -ExecutionPolicy Bypass is for this one process only, not a machine-wide change.
 *
 * When 5.1 is launched from PowerShell 7 (pwsh) -- GitHub Actions' own default shell on
 * windows-latest -- the child inherits pwsh's $env:PSModulePath, which is prefixed with
 * PowerShell 7's own module folders. 5.1 can then fail to auto-load even its own built-in
 * modules ("was found in the module '…', but the module could not be loaded", for cmdlets
 * as core as Get-AuthenticodeSignature), breaking every signature check ghostget does.
 * Proven live against windows-latest: deleting PSModulePath from the child's environment
 * fixes it, because 5.1 computes a correct default when the variable is absent. See
 * {@link cleanEnvForPS51}.
 */

export const isWindows = () => process.platform === 'win32';

export function isWsl() {
  return process.platform === 'linux' && (Boolean(process.env.WSL_DISTRO_NAME) || /microsoft/i.test(os.release()));
}

/**
 * @param {string} what What the caller was trying to do, for the message.
 */
export function assertWindows(what) {
  if (isWindows()) return;
  throw new GhostgetError(`${what} needs Windows: the Microsoft Store only exists there.`, {
    code: 'E_UNSUPPORTED_PLATFORM',
    exitCode: EXIT.UNSUPPORTED,
    hint: isWsl()
      ? 'You are inside WSL. Run ghostget from Windows PowerShell or cmd instead.'
      : 'search, show, url and download still work on this platform.',
  });
}

/** Absolute path, so a poisoned PATH cannot substitute another powershell.exe. */
export function powershellExe(env = process.env) {
  const root = env.SystemRoot || env.windir || 'C:\\Windows';
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * A copy of `env` with `PSModulePath` removed (case-insensitively: Windows env vars are not
 * case-sensitive, but JS object keys are). Windows PowerShell 5.1 computes a correct default
 * for itself when the variable is absent; a wrong one inherited from a different PowerShell
 * (see the module-level comment above) can otherwise break its own built-in modules.
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function cleanEnvForPS51(env) {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (/^psmodulepath$/i.test(key)) delete out[key];
  }
  return out;
}

const PRELUDE =
  "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);";

/**
 * PowerShell reports errors as CLIXML when stderr is redirected; pull the readable text out.
 * @param {string} text
 */
export function cleanPowerShellError(text) {
  const raw = text.trim();
  if (!raw.startsWith('#< CLIXML')) return raw;
  const lines = [...raw.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => m[1]);
  return lines
    .join('')
    .replace(/_x000D_/g, '')
    .replace(/_x000A_/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/ At line:\d+ char:\d+.*$/, '')
    .trim();
}

/**
 * @param {string} script PowerShell source.
 * @param {{ env?: Record<string, string>, timeoutMs?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<string>} stdout
 */
export function runPowerShell(script, { env = {}, timeoutMs = 60_000, signal } = {}) {
  assertWindows('This step');
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(PRELUDE + script, 'utf16le').toString('base64');
    const child = spawn(powershellExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', encoded], {
      env: cleanEnvForPS51({ ...process.env, ...env }),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    });
    /** @type {Buffer[]} */
    const out = [];
    /** @type {Buffer[]} */
    const err = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new GhostgetError(`PowerShell did not finish within ${Math.round(timeoutMs / 1000)} s.`, { code: 'E_POWERSHELL' }));
    }, timeoutMs);

    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (cause) => {
      clearTimeout(timer);
      reject(new GhostgetError('Could not start Windows PowerShell.', { code: 'E_POWERSHELL', cause }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8').replace(/^\uFEFF/, ''));
      const detail = cleanPowerShellError(Buffer.concat(err).toString('utf8'));
      reject(new GhostgetError(`PowerShell failed: ${detail || `exit code ${code}`}`, { code: 'E_POWERSHELL' }));
    });
  });
}

/**
 * @param {string} script
 * @param {Parameters<typeof runPowerShell>[1]} [opts]
 * @returns {Promise<any>}
 */
async function runPowerShellJson(script, opts) {
  const stdout = await runPowerShell(script, opts);
  try {
    return JSON.parse(stdout.trim());
  } catch (cause) {
    throw new GhostgetError('PowerShell returned output ghostget could not parse.', { code: 'E_POWERSHELL', cause });
  }
}

/** @typedef {{ name: string, displayName: string, status: string, startType: string }} ServiceInfo */

const SERVICES_SCRIPT = `
$rows = @(foreach ($n in ($env:GHOSTGET_NAMES -split ',')) {
  $s = Get-Service -Name $n -ErrorAction SilentlyContinue
  if ($s) { [pscustomobject]@{ name = $s.Name; displayName = $s.DisplayName; status = [string]$s.Status; startType = [string]$s.StartType } }
})
ConvertTo-Json -InputObject $rows -Compress
`;

/**
 * @param {string[]} names Service names, e.g. `['wuauserv', 'InstallService']`.
 * @returns {Promise<ServiceInfo[]>} Services that do not exist are left out.
 */
export async function getServices(names) {
  const rows = await runPowerShellJson(SERVICES_SCRIPT, { env: { GHOSTGET_NAMES: names.join(',') } });
  return Array.isArray(rows) ? rows : [];
}

/** @typedef {{ name: string, version: string, packageFamilyName: string, publisher: string }} InstalledPackage */

const PACKAGES_SCRIPT = `
$pfns = @($env:GHOSTGET_PFNS -split ',' | Where-Object { $_ })
$filter = $env:GHOSTGET_FILTER
$all = @(Get-AppxPackage)
if ($pfns.Count -gt 0) {
  $sel = @($all | Where-Object { $pfns -contains $_.PackageFamilyName })
} else {
  $sel = @($all | Where-Object { $_.SignatureKind -eq 'Store' -and -not $_.IsFramework -and -not $_.NonRemovable })
  if ($filter) {
    $pattern = '*' + [System.Management.Automation.WildcardPattern]::Escape($filter) + '*'
    $sel = @($sel | Where-Object { $_.Name -like $pattern -or $_.PackageFamilyName -like $pattern })
  }
}
$rows = @($sel | Sort-Object Name | ForEach-Object { [pscustomobject]@{ name = $_.Name; version = [string]$_.Version; packageFamilyName = $_.PackageFamilyName; publisher = $_.Publisher } })
ConvertTo-Json -InputObject $rows -Compress
`;

/**
 * Installed Store (Appx/MSIX) packages for the current user.
 * With `pfns`, returns exactly those package families if installed. Otherwise lists user-facing Store apps.
 * @param {{ pfns?: string[], filter?: string }} [opts]
 * @returns {Promise<InstalledPackage[]>}
 */
export async function getInstalledPackages({ pfns = [], filter = '' } = {}) {
  const rows = await runPowerShellJson(PACKAGES_SCRIPT, {
    env: { GHOSTGET_PFNS: pfns.join(','), GHOSTGET_FILTER: filter },
    timeoutMs: 120_000,
  });
  return Array.isArray(rows) ? rows : [];
}

/** @typedef {{ status: string, message: string, subject: string, issuer: string, thumbprint: string }} AuthenticodeInfo */

const SIGNATURE_SCRIPT = `
$s = Get-AuthenticodeSignature -LiteralPath $env:GHOSTGET_FILE
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{
  status = [string]$s.Status; message = [string]$s.StatusMessage
  subject = [string]$s.SignerCertificate.Subject; issuer = [string]$s.SignerCertificate.Issuer
  thumbprint = [string]$s.SignerCertificate.Thumbprint
})
`;

/**
 * @param {string} file
 * @returns {Promise<AuthenticodeInfo>}
 */
export function getAuthenticode(file) {
  return runPowerShellJson(SIGNATURE_SCRIPT, { env: { GHOSTGET_FILE: file } });
}

const LAUNCH_SCRIPT = `
$p = Start-Process -FilePath $env:GHOSTGET_FILE -PassThru
if ($p) { [string]$p.Id } else { '' }
`;

/**
 * Start a file the way Explorer would (so a UAC prompt works). Does not wait for it.
 * @param {string} file
 * @returns {Promise<number|null>} process id when Windows reports one
 */
export async function startProcess(file) {
  const out = (await runPowerShell(LAUNCH_SCRIPT, { env: { GHOSTGET_FILE: file }, timeoutMs: 120_000 })).trim();
  return /^\d+$/.test(out) ? Number(out) : null;
}
