# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/SkyLostTR/ghostget/releases/tag/v0.1.0
