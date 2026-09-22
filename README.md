<div align="center">

# 👻 Ghostget

**Install Microsoft Store apps from your terminal, without signing in.**
<br>
<sub>Created by <a href="https://github.com/SkyLostTR"><strong>SkyLostTR</strong></a> (<code>@Keeftraum</code>)</sub>

[![npm](https://img.shields.io/npm/v/ghostget?color=cb3837)](https://www.npmjs.com/package/ghostget)
[![CI](https://github.com/SkyLostTR/ghostget/actions/workflows/ci.yml/badge.svg)](https://github.com/SkyLostTR/ghostget/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![node](https://img.shields.io/badge/node-%E2%89%A520-339933)
![dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)

**[Website & docs](https://ghostget.kief.fi)** · English · [Türkçe](README.tr.md)

</div>

```console
$ npx ghostget search terminal --limit 3
Name                      Id            Publisher              Price
--------------------------------------------------------------------
Windows Terminal          9N0DX20HK701  Microsoft Corporation  Free
Windows Terminal Preview  9N8G5RFZ9XK3  Microsoft Corporation  Free
terminalpp                9NNH6JQFJ7HD  Zduka                  Free

$ npx ghostget install "windows terminal" --dry-run
✔ Found Windows Terminal [9N0DX20HK701] · Microsoft Corporation · Free
✔ Dry run: nothing was downloaded or launched.
  Installer  https://get.microsoft.com/installer/download/9N0DX20HK701?cid=website_cta_psi
  Steps      download, verify the Microsoft signature, launch the Store installer
```

## Why

`winget install --source msstore <id>` needs a signed-in Microsoft Store account. Without one it ends with:

```
Verifying/Requesting package acquisition failed: no store account found
```

The **Get** button on the Store website does not need that. It downloads a small installer that Microsoft signs, and that installer asks the Store to do the rest. **ghostget automates exactly that**: find the app, fetch Microsoft's own web installer, check its signature, run it. No account, no sign-in, no `winget`.

## Quick start

```powershell
npx ghostget search terminal          # find an app
npx ghostget show 9N0DX20HK701        # price, size, package family
npx ghostget install 9N0DX20HK701     # install it
```

📖 Prefer a visual walkthrough? **[ghostget.kief.fi](https://ghostget.kief.fi)** has the full documentation site — getting
started, every command and option, the library API, the safety model, and troubleshooting, all in one place.

`npx` asks once before downloading the package; add `--yes` to skip that in scripts. You can also pass a name (`install "windows terminal"`) or a Store URL. If a name matches more than one app, ghostget asks which, or fails with the list. It never guesses.

## Features

- **No account.** Uses the same public endpoints and the same web installer link as Microsoft's own Store website.
- **Verifies before it runs.** The installer must carry a valid Authenticode signature from Microsoft Corporation, or it is deleted and never started.
- **winget-like commands:** `search`, `show`, `install`, `list`, plus `download`, `url` and `doctor`.
- **Safe defaults.** Refuses paid apps, never picks between look-alike apps for you, never elevates, never changes system settings.
- **Scriptable.** `--json` everywhere, quiet stdout, stable [exit codes](#exit-codes).
- **Zero runtime dependencies.** Runs from `npx`, or as a library, or as a single PowerShell file on a PC without Node.js.

## Install

| You have | Run |
| --- | --- |
| Node.js 20+ | `npx ghostget <command>` (or `pnpm dlx ghostget`, `yarn dlx ghostget`, `bunx ghostget`) |
| Node.js, want it permanently | `npm install -g ghostget`, then `ghostget <command>` |
| Windows without Node.js | The [PowerShell edition](#powershell-edition) below |
| Your own code | `npm install ghostget`, then `import { installApp } from 'ghostget'` |

The package is a normal npm CLI, so any runner that executes npm `bin` entries works. This project's CI installs the packed tarball into a fresh project, runs it through `npx`, and installs it globally; `pnpm`, `yarn` and `bun` are not tested.

### PowerShell edition

One dependency-free file that does `search`, `show`, `install`, `download` and `url`. It runs in Windows PowerShell 5.1 (already on every Windows 10/11) and PowerShell 7.

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/SkyLostTR/ghostget/v0.2.0/scripts/ghostget.ps1))) install 9N0DX20HK701
```

Pin the URL to a release tag (as above) and, if you like, read the script first: it is one file and every release lists its SHA-256. Options are PowerShell-style: `-DryRun`, `-NoVerify`, `-Force`, `-Dir`, `-Market`, `-Locale`, `-Limit`.

## Commands

`<app>` is a Store product ID (`9N0DX20HK701`), a Store URL, or a name.

| Command | What it does |
| --- | --- |
| `search <query>` | Search the Microsoft Store. Aliases: `s`, `find` |
| `show <app>` | Details: publisher, price, version, size, package family, installer URL. Alias: `info` |
| `install <app>` | Download, verify and launch the Store installer. Aliases: `i`, `add` |
| `download <app>` | Download and verify the installer without running it. Alias: `dl` |
| `url <app>` | Print the direct installer URL (stdout only, easy to pipe) |
| `list [filter]` | List installed Store apps (Windows). Alias: `ls` |
| `doctor` | Check the Windows version, the Store services and the network |

Useful options: `--dry-run`, `--wait` (wait until the app shows up as installed; works for Store packages, not for apps the Store installs with a vendor's own installer), `--force`, `--no-elevate` (don't ask Windows for permission to fix a `Disabled` Store service — see [below](#faq)), `--no-verify`, `--dir <path>`, `--market <CC>`, `--locale <tag>`, `--json`, `--exact`, `--limit <1-20>`. Run `ghostget --help` for all of them.

```powershell
ghostget install "visual studio code" --dry-run      # see what it would do
ghostget install 9N0DX20HK701 --wait                 # wait until it shows up as installed
ghostget url 9N0DX20HK701 | clip                     # copy the installer link
ghostget search python --json | ConvertFrom-Json     # script it
ghostget doctor                                      # why won't it work?
```

## How it works

```
"terminal" ── search ──▶ storeedgefd.dsx.mp.microsoft.com   (the Store app's own search API)
9N0DX20HK701 ─ details ─▶ displaycatalog.mp.microsoft.com   (price, size, package family)
              ── GET ───▶ get.microsoft.com/installer/download/9N0DX20HK701
                          └─ a ~800 KB installer, signed by Microsoft
verify signature ─▶ launch it ─▶ the Store finishes the install in its own window
```

Details, and what was verified against the live services, are in [docs/how-it-works.md](docs/how-it-works.md).

## Safety

- **Three Microsoft hosts, HTTPS only.** Endpoint overrides (for tests or mirrors) must be `https`, or `http` on localhost.
- **Signature check.** `Get-AuthenticodeSignature` must report `Valid` *and* the signer's organisation must be exactly `Microsoft Corporation`. Anything else is deleted and ghostget exits with code 7. A single flipped byte is enough to fail it. `--no-verify` exists, prints a warning, and is not recommended.
- **Sanity checks.** The download must be a Windows executable of the announced size. The server-supplied file name is stripped of paths and reserved names.
- **No credentials, no payment.** ghostget never asks for or handles either. Paid apps are refused unless you pass `--force`, which only opens Microsoft's own installer, where you decide what happens.
- **Elevation only when Windows itself requires it, and only ever temporary.** `doctor` prints the commands that would fix a problem; it never runs them. `install` is more hands-on: a Store deployment service that is enabled but stopped is started with no elevation at all (proven live: Windows allows this for a standard user). A service that is `Disabled` genuinely cannot be fixed without admin rights — that's Windows' own rule — so `install` asks once, the normal UAC way, fixes only that service, and restores it to exactly the state it found it in (including `Disabled` again) once the install finishes. `--no-elevate` skips asking and falls back to a plain error with the manual fix instead. Nothing else on the machine, and no setting outside that one service's temporary state, is ever touched — `wuauserv` in particular is never changed, elevated or not.
- **No telemetry.** The only network traffic is to the three Microsoft hosts above.
- **No shell injection.** PowerShell is called with fixed scripts; anything you type reaches it through environment variables.

Found a problem? See [SECURITY.md](SECURITY.md).

## Platform support

| | Windows 10/11 | macOS / Linux | WSL |
| --- | :---: | :---: | :---: |
| `search`, `show`, `url` | ✅ | ✅ | ✅ |
| `download` | ✅ verified | ✅ not verified¹ | ✅ not verified¹ |
| `install`, `list` | ✅ | ❌ needs Windows | ❌ run it from Windows |
| `doctor` | ✅ full | network checks only | network checks only |

¹ The signature check needs Windows PowerShell, so on other systems ghostget says it did not verify the file. Check it on Windows before running it.

Developed and tested on Windows 11 22H2. Windows 10 is expected to work and has not been tested.

## Use it as a library

```js
import { searchStore, getProduct, installApp } from 'ghostget';

const [best] = await searchStore('windows terminal');
const app = await getProduct(best.id);
console.log(app.name, app.price.free, app.version);

const result = await installApp(best.id, {
  wait: true,                                    // resolve when the app shows up as installed
  onEvent: (e) => console.log(e.type),           // resolved, download-start, progress, verified, launched...
});
console.log(result.status);                      // 'installed'
```

ESM, typed (JSDoc-generated `.d.ts`), no dependencies. Every function is documented in [docs/api.md](docs/api.md).

## Configuration

| Variable | Effect |
| --- | --- |
| `GHOSTGET_MARKET`, `GHOSTGET_LOCALE` | Store market and language, e.g. `TR` and `tr-TR`. Default: your system locale |
| `GHOSTGET_CID` | Campaign id in the installer URL. Default `website_cta_psi`, what Microsoft's site uses |
| `GHOSTGET_DIR` | Where `install` keeps installers. Default: a temp folder, cleaned after a day |
| `GHOSTGET_INSTALLER_URL`, `GHOSTGET_DISPLAY_CATALOG_URL`, `GHOSTGET_STORE_EDGE_URL` | Point ghostget at a mirror or test server (`https`, or `http` on localhost) |
| `NO_COLOR`, `FORCE_COLOR` | Colour control |

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Success |
| 1 | Other error, or `--wait` timed out |
| 2 | Usage error (unknown command or option, bad value) |
| 3 | Not found (no search results, unknown product, no web installer) |
| 4 | Ambiguous: a name matches several apps. Pass the exact ID |
| 5 | Network problem |
| 6 | Needs Windows |
| 7 | Signature check failed, the file was deleted |
| 8 | Paid app (use `--force` to open the installer anyway) |
| 9 | `InstallService`, `ClipSVC`, `AppXSvc`, `UsoSvc` or `DoSvc` is Disabled (`install` tries to fix this itself first — see the FAQ; this is what happens if that's off or denied. Use `--force` to launch the installer anyway) |

## FAQ

**Do I have to turn Windows Update on?**
ghostget never calls the Windows Update client and never needs an account. But the Store delivers many apps through Windows Update infrastructure (`ghostget show` prints `Delivery: WindowsUpdate` for those; apps that use a vendor's own installer show `WPM`), and that infrastructure needs more than `wuauserv` itself: `UsoSvc` (Update Orchestrator Service) and `DoSvc` (Delivery Optimization) run the actual download. Proven live: with `UsoSvc`/`DoSvc` **Disabled**, a `WindowsUpdate`-delivered install gets as far as "Downloading" in the Store and then fails with a COM error, indistinguishable from the outside from the Store window just hanging — `wuauserv` itself being fine does not help. `install` checks `InstallService`, `ClipSVC`, `AppXSvc`, `UsoSvc` and `DoSvc` itself before downloading anything (skipped for `WPM` delivery, which never touches any of this) and, if one is `Disabled`, asks Windows for permission (a UAC prompt) to fix it temporarily and put it back once the install finishes — see the next question. `wuauserv` itself is never touched either way, so it can stay `Disabled` for good.

**Does that mean ghostget asks for admin rights now?**
Only when it genuinely has to, and only for that one thing. A service that's enabled but stopped needs no admin rights at all — proven live, `install` just starts it (that's exactly how ordinary Store usage triggers these services anyway) and tries to stop it again afterward. A `Disabled` service is different: Windows requires elevation to re-enable it, full stop, for anyone. So `install` shows the normal Windows Yes/No consent prompt, fixes only the specific service(s) this install needs, and — still elevated, in the background — waits for the app to finish installing and puts every one of them back to exactly the state (including `StartType`) it found them in. `wuauserv` and everything else about the machine is never touched, elevated or not. `--no-elevate` skips the prompt entirely and falls back to exit code 9 with the manual `Set-Service` fix, for scripts, CI, or anyone who'd rather run it themselves.

**A service is enabled but says "not running yet" — do I have to fix that myself?**
No. `Manual` only means Windows *can* start a service when asked; it does not start it automatically, and the trigger does not always fire in time for the next install (`ClipSVC` in particular). `install` starts it itself before downloading — proven live to need no admin rights, since that is exactly how ordinary Store usage triggers it — and tries to stop it again afterward. That last part needs admin rights; without them (and without hitting the `Disabled` case above, which does ask) the service is simply left `Running` until Windows stops it on its own, which is not a persistent change.

**The installer window still asks me to sign in.**
Some apps (age-rated content, subscriptions, entitlements) need an account, and that is Microsoft's rule, not something ghostget can or should get around.

**It says the app is paid.**
The web installer cannot buy anything for you. Buy it in the Store, or use `--force` to open the installer and decide there.

**It cannot reach Microsoft behind a proxy.**
Node ignores `HTTPS_PROXY` unless you set `NODE_USE_ENV_PROXY=1` (Node 24+). The PowerShell edition uses the Windows proxy settings.

**Is this allowed?**
ghostget uses public endpoints and the same installer link the Microsoft Store website hands to every visitor. It does not bypass purchases, licences or DRM. The endpoints are undocumented, so Microsoft may change them; that is the main risk of this project. It is an independent project and is not affiliated with or endorsed by Microsoft. "Microsoft Store" and "Windows" are trademarks of Microsoft.

More: [docs/troubleshooting.md](docs/troubleshooting.md).

## Development

```bash
git clone https://github.com/SkyLostTR/ghostget && cd ghostget
npm install
npm test          # unit and end-to-end tests against a local mock of the Microsoft hosts
npm run typecheck # JSDoc types checked by tsc
node bin/ghostget.js doctor
```

Tests never touch the network. See [CONTRIBUTING.md](CONTRIBUTING.md).

### Running the website locally

The [website](https://ghostget.kief.fi) is a static, dependency-free site in [`website/`](website). Preview it with any
static server, for example:

```bash
npx serve website
# or: python3 -m http.server -d website 8080
```

It deploys automatically to GitHub Pages (see [`.github/workflows/pages.yml`](.github/workflows/pages.yml)) whenever
`website/` changes on `main`.

## Roadmap

`uninstall` and `upgrade` · a single-file `.exe` (Node SEA) · a Scoop bucket · WSL bridge that hands `install` to the Windows side.

## Author & credits

Ghostget is created and maintained by **[SkyLostTR](https://github.com/SkyLostTR)** (`@Keeftraum`), with thanks to everyone
who files issues, refreshes fixtures against live Microsoft responses, and reviews pull requests — see the
[contributors graph](https://github.com/SkyLostTR/ghostget/graphs/contributors).

## License

[MIT](LICENSE) © 2026 [SkyLostTR](https://github.com/SkyLostTR) and ghostget contributors
