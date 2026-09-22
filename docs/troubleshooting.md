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
| 9 | `Windows cannot deploy Store packages right now` | `InstallService`, `ClipSVC`, `AppXSvc`, `UsoSvc` or `DoSvc` is `Disabled`. `install` tries to fix this itself first (see row below); this error is what you get if that was turned off (`--no-elevate`) or the prompt was denied. Run the `Set-Service` command the message gives (PowerShell as Administrator) and retry, or pass `--force` to download and launch the installer anyway |

## The Store installer opens but nothing installs

1. `ghostget install` now checks `InstallService`, `ClipSVC`, `AppXSvc`, `UsoSvc` and `DoSvc` itself before it downloads anything. If one is `Disabled` (and the app isn't `Delivery: WPM`), it asks Windows for permission (a UAC Yes/No prompt) to fix it temporarily and put it back afterward — see [How it works § Elevation](how-it-works.md#elevation). Answer **Yes** and the install continues on its own. If you'd rather not be asked, `--no-elevate` skips straight to exit code 9 and the manual `Set-Service … -StartupType Manual` fix; `ghostget doctor` also shows a `fail` for exactly this.
2. `UsoSvc` (Update Orchestrator Service) and `DoSvc` (Delivery Optimization) are easy to miss because `wuauserv` itself can look completely healthy while these are `Disabled` — proven live: the Store app gets as far as "Downloading" and then fails with a COM error, which from the outside looks exactly like the window hanging. If you have deliberately disabled Windows Update (`wuauserv` set to `Disabled`, often alongside `UsoSvc`/`DoSvc` from a "debloat" script), `install`'s elevation fix above (or the manual `Set-Service … -StartupType Manual`, which does **not** turn automatic updates back on) is what gets `Delivery: WindowsUpdate` apps installing again — `wuauserv` itself can stay `Disabled`. Apps that show `Delivery: WPM` use the vendor's own installer and never touch any of this, so they already work regardless.
3. Setting a service to `Manual` only lets Windows start it when something needs it — it does not start it right away, and the very next install can still hit this if nothing has triggered it yet. `ghostget install` handles this case itself too, with no prompt at all: it starts any needed service that is `Manual`/enabled but not `Running`, no admin rights needed, before it downloads anything, and tries to stop it again afterward (best effort — that part *does* need admin rights, so without them the service is just left `Running`, which is not a persistent change). You should not need to do anything for this case; if you still land here, run `Start-Service -Name ClipSVC` yourself (also try `InstallService` and `AppXSvc`) and retry.
4. Approved the prompt and it *still* says `E_SERVICE_DISABLED`? Found live: `DoSvc` specifically can refuse `Set-Service` with access denied on some machines even from a fully elevated Administrator process — `InstallService`/`ClipSVC`/`AppXSvc`/`UsoSvc` took the same fix fine on the same machine. Neither the service's own security descriptor nor its registry key's ACL explained it; something else about that particular Windows install (likely a "debloat"/update-blocking tool that went further than a plain `-StartupType Disabled`) is protecting it beyond what elevation grants. `install` reports this honestly (the error names the service and the exact command) rather than guessing at a more invasive fix like editing the registry directly, which it does not attempt.
5. Look at the installer window: it shows the Store's own error code, which you can search for. Windows' own event logs also have detail `ghostget` never sees: `Get-WinEvent -LogName "Microsoft-Windows-Store/Operational" -MaxEvents 20` shows what the Store app itself was doing (its own catalog lookup, license check, download stage), which is how the `UsoSvc`/`DoSvc` and `E_NOINTERFACE` failure above was actually found and confirmed.
6. Some apps also need a signed-in Microsoft account (age-rated content, subscriptions, entitlements) — see [below](#the-app-asks-me-to-sign-in). No service fix will get past that; it's Microsoft's own rule for those apps.

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
