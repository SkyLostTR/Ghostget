# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[0.3.0]: https://github.com/SkyLostTR/ghostget/releases/tag/v0.3.0
[0.2.0]: https://github.com/SkyLostTR/ghostget/releases/tag/v0.2.0
[0.1.0]: https://github.com/SkyLostTR/ghostget/releases/tag/v0.1.0
