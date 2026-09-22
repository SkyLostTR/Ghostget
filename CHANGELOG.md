# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-09-22

### Added

- `install` no longer stops at `E_SERVICE_DISABLED` when it can fix the problem: for a `Disabled` deployment service
  (`InstallService`, `ClipSVC`, `AppXSvc`, `UsoSvc`, `DoSvc`), it now asks Windows for permission itself (the normal
  UAC consent prompt) instead of telling the person to open an elevated PowerShell and run `Set-Service`. Proven
  live: re-enabling a `Disabled` service needs admin rights no matter who asks, so there is no way around the
  prompt itself, but everything after it is automatic and every service touched is put back to exactly the state
  it was found in (including `StartType`) once the app shows up installed or a bounded timeout passes — all inside
  that one elevated, detached process, so there is only ever one prompt. `wuauserv` and everything else about the
  machine is never touched. New `elevateAndFixDisabledServices(opts)` and `psQuote(value)` (exported for the
  Powershell-injection-safety test suite) in `src/windows.js`. New `--no-elevate` flag (and `noElevate` library
  option) skips this and falls back straight to the old manual-fix error, for scripts, CI, or anyone who'd rather
  run the command themselves.
- Tested live against a machine with `UsoSvc` genuinely `Disabled`: the UAC prompt appears, approving it fixes and
  later restores the service exactly as documented. Also found live, on the same machine, that `DoSvc` specifically
  can refuse `Set-Service` with access denied *even from a fully elevated (High integrity, Administrators) process*
  — `InstallService`/`ClipSVC`/`AppXSvc`/`UsoSvc` all took the same fix without issue. Neither the service's own
  security descriptor (`sc sdshow`) nor its registry key's ACL explain it; something else about this specific
  Windows install is protecting it beyond what elevation grants access to. `install` does not attempt anything
  more invasive (such as editing the registry `Start` value directly) to work around this — it reports the failure
  honestly instead, same as a denied prompt.

### Fixed

- `elevateAndFixDisabledServices` always reported "timed out waiting for the elevated helper to report back", even
  when the elevated process had already written its result within a second or two and the person answered the UAC
  prompt immediately. Cause: the elevated script writes that result with `Set-Content -Encoding UTF8`, and Windows
  PowerShell 5.1's `-Encoding UTF8` always prepends a BOM (unlike PowerShell 7's `utf8NoBOM`) — the Node side never
  stripped it before `JSON.parse`, so every read silently failed and looked identical to the file not existing yet,
  no matter how long the poll waited. Found live: a person confirmed clicking the UAC prompt "the moment it
  appeared" and it still reported a timeout. Fixed by stripping a leading BOM before parsing (`src/windows.js`
  already did this for `runPowerShell`'s own stdout; this path was missed), and by distinguishing "file does not
  exist yet" from "file exists but could not be parsed" instead of retrying both the same way. Also widened the
  poll window from 20 s to 90 s regardless, since a person still needs a realistic amount of time to notice an
  unexpected consent prompt and respond to it — this was a real, separate issue even before the BOM bug was found.
  New regression test in `test/windows.test.js` that writes a file with `Set-Content -Encoding UTF8` and asserts
  `JSON.parse` fails on the raw read and succeeds once the BOM is stripped.

## [0.4.0] - 2026-09-22

### Added

- `install` no longer just warns when a needed Store deployment service (`InstallService`, `ClipSVC`, `AppXSvc`,
  `UsoSvc`, `DoSvc`) is enabled but not running yet — it starts the service itself before downloading anything,
  proven live to need no admin rights (Windows lets a standard user start these; that is how ordinary Store usage
  triggers them). `install` then tries to put the service back to `Stopped` afterward (best effort: Windows does
  *not* let a standard user stop it again, proven live too, so without admin rights it is simply left `Running` —
  not a persistent change; `StartType` is never touched). New `setServiceRunning(name, action)` and
  `scheduleServiceRestore(opts)` in `src/windows.js`.
- `install` and `doctor` now also check `UsoSvc` (Update Orchestrator Service) and `DoSvc` (Delivery Optimization),
  which run the actual "WU" fulfillment plugin a `WindowsUpdate`-delivered download uses. Found live, on a machine
  with both `Disabled`: `InstallService`/`ClipSVC`/`AppXSvc`/`wuauserv` were all fine, `install` downloaded, verified
  and launched the installer normally, and the Store app then got as far as "Downloading" before failing with a COM
  `E_NOINTERFACE` error — indistinguishable from the outside from the Store window just hanging, confirmed by
  reading `Microsoft-Windows-Store/Operational` in Windows' own event log. `WPM`-delivered apps never touch this and
  are unaffected. Unlike the `Stopped`-but-enabled case above, a `Disabled` `UsoSvc`/`DoSvc` still blocks with
  `E_SERVICE_DISABLED` (exit 9): fixing `Disabled` needs a persistent `-StartupType` change, which needs admin
  rights ghostget never asks for.

### Fixed

- Windows PowerShell 5.1, launched as a child of PowerShell 7 (`pwsh`) — GitHub Actions' own default shell on
  `windows-latest`, and how every `npm test` step ran — inherits pwsh's `$env:PSModulePath`, which is prefixed with
  PowerShell 7's own module folders. 5.1 then fails to auto-load even its own built-in modules, including
  `Microsoft.PowerShell.Security` (`Get-AuthenticodeSignature`) and `Microsoft.PowerShell.Utility` (`Get-FileHash`),
  with `"…, but the module could not be loaded"`. That broke every signature check, which is why CI had been failing
  on Windows since the first commit. Confirmed live against `windows-latest` by reproducing it, then fixing it, with
  the exact same child process. Every `powershell.exe` ghostget spawns (`src/windows.js`, and the
  `scripts/ghostget.ps1` edition's tests) now runs with a cleaned environment (new `cleanEnvForPS51`, exported from
  `src/windows.js`) that drops any inherited `PSModulePath`, so 5.1 computes its own correct default instead.
- Every Windows PowerShell child process ghostget spawns also now runs with `-ExecutionPolicy Bypass` for that one
  process, so a machine whose policy is `Restricted` (still the Windows default) can't block it either. This does not
  change the machine's execution policy.

## [0.3.0] - 2026-09-22

### Added

- Documentation website at [ghostget.kief.fi](https://ghostget.kief.fi) (`website/`), deployed to GitHub Pages via
  [`.github/workflows/pages.yml`](.github/workflows/pages.yml): a landing page and a full docs/wiki hub covering getting
  started, commands, configuration, the library API, the safety model, and troubleshooting.
- Author and credits sections crediting [SkyLostTR](https://github.com/SkyLostTR) (`@Keeftraum`) across the README,
  `package.json`, `LICENSE` and the website.
- `stalledDeploymentServices(services, delivery)`: like `disabledDeploymentServices`, but for `InstallService`,
  `ClipSVC` or `AppXSvc` that is enabled (`Manual`/`Automatic`) yet not actually `Running`. `install` now warns with
  the exact `Start-Service` fix when this happens, and `doctor` reports it as a warning instead of `ok`.

### Fixed

- A Store deployment service that had just been switched from `Disabled` back to `Manual` (the fix `doctor` itself
  suggests) does not always get started by Windows in time for the next install: the Store then falls back to opening
  its own app window for the person to finish by hand instead of deploying the package silently, which looked
  identical to `install` doing nothing. `doctor` used to report such a service as `ok` because it only checked
  `StartType`, not `Status`. It now flags it and names the `Start-Service` command that starts it immediately.

## [0.2.0] - 2026-09-21

### Added

- `install` now checks `InstallService`, `ClipSVC` and `AppXSvc` before downloading anything. If any of them is
  `Disabled`, Windows cannot deploy the package no matter how well the download and launch go, so ghostget stops with
  a new `E_SERVICE_DISABLED` error (exit code 9) and the exact `Set-Service … -StartupType Manual` fix, instead of
  downloading, verifying and launching an installer that Windows already can't finish. Skipped for `WPM`-delivered
  apps (vendor installer, no Appx deployment involved), and bypassed with `--force`, which still warns.
- `disabledDeploymentServices(services, delivery)`: the pure function behind that check, exported from the library API.

### Fixed

- Previously ghostget only looked at `wuauserv` (a soft dependency) before installing, so a machine with the actual
  Store deployment services disabled would download, verify and launch the installer anyway and leave the user
  guessing why the Store window never finished the install.

## [0.1.0] - 2026-09-21

First release.

### Added

- `search`, `show`, `install`, `download`, `url`, `list` and `doctor` commands, with `--json`, `--dry-run`, `--wait`,
  `--market`, `--locale` and stable exit codes.
- Store search through the Store's own API, with the `winget msstore` search as a fallback.
- Product details from the display catalog, with the Store's product API as the source for Win32 (`XP…`) apps.
- Free/paid detection that copes with Win32 apps listing a numeric price of 0 when paid, and with localised price labels.
  Paid apps are refused unless `--force` is given.
- Authenticode verification (`Valid` and signer `Microsoft Corporation`) before anything is launched; failing files are deleted.
- Download sanity checks: Windows executable header, announced size, sanitised file name.
- Library API (`searchStore`, `getProduct`, `installApp`, …) with generated type declarations.
- Dependency-free PowerShell edition (`scripts/ghostget.ps1`) for PCs without Node.js.
- English and Turkish READMEs, and docs on how it works, the API and troubleshooting.

[0.5.0]: https://github.com/SkyLostTR/ghostget/releases/tag/v0.5.0
[0.4.0]: https://github.com/SkyLostTR/ghostget/releases/tag/v0.4.0
[0.3.0]: https://github.com/SkyLostTR/ghostget/releases/tag/v0.3.0
[0.2.0]: https://github.com/SkyLostTR/ghostget/releases/tag/v0.2.0
[0.1.0]: https://github.com/SkyLostTR/ghostget/releases/tag/v0.1.0
