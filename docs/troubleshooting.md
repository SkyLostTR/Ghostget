# Troubleshooting

Start with `ghostget doctor`. It checks the Windows version, the services the Store install path depends on, and whether
the three Microsoft hosts are reachable, and prints the exact command for each fix. It never changes anything itself.

## By exit code

| Code | Message starts with | What to do |
| ---: | --- | --- |
| 2 | `Unknown command` / `Unknown option` / `--x does not apply to` | Check `ghostget --help`. Some options belong to one command only |
| 3 | `Nothing in the Microsoft Store matches` | Use fewer words, or search with `ghostget search` |
| 3 | `No Microsoft Store product with id …` | The id is wrong, or the app is not sold in your market. Try `--market US` |
| 3 | `The Store has no web installer for …` | Microsoft does not offer a web installer for that id. Install it from the Store app |
| 4 | `"…" matches N apps` | Re-run with the Store id from the list |
| 5 | `Could not reach …` / `Timed out …` | See [Network](#network) |
| 6 | `… needs Windows` | `install`, `list` and signature checks only work on Windows. Inside WSL, run ghostget from Windows PowerShell |
| 7 | `The installer is not signed by Microsoft` | ghostget deleted the file and did not run it. Retry; if it persists, something on your network is altering downloads |
| 8 | `… is a paid app` | The web installer cannot buy it. Buy it in the Store, or `--force` to open the installer and decide there |

## The Store installer opens but nothing installs

1. Run `ghostget doctor`. A `fail` on `InstallService`, `ClipSVC` or `AppXSvc` means the service is `Disabled`. Set it back to `Manual` (PowerShell as Administrator): `Set-Service -Name InstallService -StartupType Manual`.
2. If `Windows Update (wuauserv)` is `Disabled`, set it to `Manual`. That lets the Store start it on demand and does **not** turn automatic updates back on. Apps the Store delivers through Windows Update (`Delivery: WindowsUpdate` in `ghostget show`) may stall while it is `Disabled`. Apps that show `Delivery: WPM` use the vendor's own installer and do not depend on it.
3. Look at the installer window: it shows the Store's own error code, which you can search for.

## The app asks me to sign in

Some apps (age-rated content, subscriptions, entitlements) need an account. That is Microsoft's rule for those apps, and ghostget does not try to get around it.

## Network

- **Behind a proxy:** Node ignores `HTTPS_PROXY` unless you set `NODE_USE_ENV_PROXY=1` (Node 24+). The PowerShell edition (`scripts/ghostget.ps1`) uses the Windows proxy settings.
- **TLS inspection / corporate CA:** set `NODE_EXTRA_CA_CERTS=path\to\ca.pem`, or use the PowerShell edition.
- **Only one host fails** in `doctor`: that endpoint is down or blocked. Search has a fallback; the installer host does not.

## "list" is slow

`ghostget list` reads every installed package with `Get-AppxPackage`, which takes a couple of seconds on a busy machine. Pass a filter to shorten the output.

## Wrong language or price

Prices and titles follow your system locale. Override with `--market` and `--locale` (or `GHOSTGET_MARKET` and `GHOSTGET_LOCALE`):

```powershell
ghostget show 9N0DX20HK701 --market US --locale en-US
```

## `npx` asks a question / hangs in CI

`npx` asks before downloading a package. Use `npx --yes ghostget …` in scripts.

## Still stuck

Open an issue and paste the output of `ghostget --version`, `ghostget doctor` and the command you ran, with `--verbose`.
