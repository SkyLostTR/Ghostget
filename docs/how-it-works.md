# How ghostget works

ghostget does what the **Get** button on the Microsoft Store website does, from a terminal. It never
touches a Microsoft account.

```
 name / id / URL
       │
       ▼
 ┌──────────────┐   search     storeedgefd.dsx.mp.microsoft.com /v9.0/search        (fallback: /manifestSearch)
 │   resolve    │──────────▶
 └──────────────┘   details    displaycatalog.mp.microsoft.com  /v7.0/products      (fallback: storeedgefd /products/{id})
       │
       ▼
 ┌──────────────┐   GET        get.microsoft.com /installer/download/{id}?cid=website_cta_psi
 │   download   │──────────▶   → a ~800 KB .exe, Content-Disposition names it after the app
 └──────────────┘
       │  MZ header, size == Content-Length, name sanitised
       ▼
 ┌──────────────┐   Get-AuthenticodeSignature: Status = Valid  AND  signer O = "Microsoft Corporation"
 │    verify    │   otherwise: delete the file, exit 7
 └──────────────┘
       │
       ▼
 ┌──────────────┐   Start-Process (so UAC works, like double-clicking it)
 │    launch    │──────────▶   the Store's own installer finishes the job in its window
 └──────────────┘
```

## The four Microsoft services

| Service | Used for | Notes |
| --- | --- | --- |
| `get.microsoft.com/installer/download/{id}` | The installer itself | `GET` only (`HEAD` answers 405). Unknown ids answer 404. The `cid` query value is Microsoft's campaign id; ghostget sends the same one the Store website does. |
| `storeedgefd.dsx.mp.microsoft.com/v9.0/search` | Search | The API the Store app itself uses. Returns price, publisher, package family names and the delivery type. |
| `storeedgefd.dsx.mp.microsoft.com/v9.0/manifestSearch` | Search fallback | The API behind `winget --source msstore`. Small and stable, but it does not list some apps (for example Spotify). |
| `displaycatalog.mp.microsoft.com/v7.0/products` | Product details | Price per availability, package sizes and architectures, package family name, version. **Knows no Win32 (`XP…`) apps.** |
| `storeedgefd.dsx.mp.microsoft.com/v9.0/products/{id}` | Delivery type, and details for Win32 apps | Used when the display catalog has nothing. |

None of them needs a login. They are undocumented, which is the main risk of this project: Microsoft can change them.
The mock server in `test/support/mock-store.js` and the fixtures in `test/fixtures/` are trimmed copies of real
responses, so a change shows up as a failing test after the fixtures are refreshed.

## Decisions and the evidence behind them

**A name is never guessed.** A search for "vs code" returns twenty apps and only some are Microsoft's. ghostget proceeds on
its own only when there is one result, or exactly one result whose name equals what you typed. Otherwise it asks (in a
terminal) or fails with the candidates and exit code 4. Scripts should pass the id.

**Two catalogs, because each is missing things.** `manifestSearch` returned no result for "spotify" under every match type,
while the Store's own search found it. The display catalog returned no product for any `XP…` id, while the Store's
product API had all of them. Each fallback was added after seeing that on the live services.

**Free or paid is decided carefully.**

- For Store packages the price is read from the availability whose actions include `Purchase` (others describe "details"
  pages and list 0).
- For Win32 apps the numeric price is **0 even when the app is paid** (`Adobe Photoshop`: `DisplayPrice: "Paid"`,
  `Price: 0`), and the label is localised (`"Ücretsiz"` in tr-TR). ghostget therefore asks for the product in English
  and reads the words `Free` and `Paid`; anything else (`Included`, `Available on …`) leaves the answer *unknown* and does not
  block the install.

**Signature check instead of a pinned hash.** The installer is generated per product and changes, so a fixed hash is
impossible. What is stable is who signs it. The real installer for ChatGPT (Beta) that this project was built against
reported: status `Valid`, subject `CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US`,
issuer `CN=Microsoft Marketplace CA G 024`. Its certificate had expired, and the status was still `Valid` because the
signature carries a Microsoft timestamp. ghostget requires `Valid` and an organisation of exactly `Microsoft Corporation`.

**PowerShell for the Windows parts.** Signature checks, installed-app lookup, service state and launching all use Windows
PowerShell 5.1 (`powershell.exe`, present on every Windows 10/11) with the absolute path. Scripts are passed with
`-EncodedCommand` and data through environment variables, so nothing you type is ever concatenated into PowerShell source.
`Start-Process` is used to launch (rather than a bare `spawn`) so an installer that asks for elevation shows a normal UAC
prompt.

## Delivery types

The Store reports how an app is delivered (`Installer.Type`):

| Type | Meaning | Examples | What ghostget can tell |
| --- | --- | --- | --- |
| `WindowsUpdate` | A Store package (MSIX/Appx) delivered through the Windows Update infrastructure | Windows Terminal, ChatGPT (Beta), Spotify | Installed state and `--wait` work: they use the package family name |
| `WPM` | The Store runs the vendor's own installer | Visual Studio Code, Adobe Photoshop | No package family name, so `install` cannot tell whether it is already installed and `--wait` has nothing to watch |

This is also why `ghostget doctor` looks at the Windows Update service. It is not something ghostget calls, but Store
packages are delivered through that infrastructure. Setting the service to **Manual** is the recommended minimum; whether
an install works with it **Disabled** depends on the app — see below, now verified for `WindowsUpdate` delivery.

Unlike `wuauserv` itself, `InstallService`, `ClipSVC`, `AppXSvc`, `UsoSvc` and `DoSvc` are not optional for anything
other than `WPM`: without them the launched installer cannot hand a package to Windows at all, no matter how the app
is delivered. `UsoSvc` (Update Orchestrator Service) and `DoSvc` (Delivery Optimization) run the actual "WU"
fulfillment plugin a `WindowsUpdate`-delivered download uses — proven live, with both `Disabled`: the Store app gets
as far as "Downloading" and then fails with a COM `E_NOINTERFACE` error, even with `InstallService`/`ClipSVC`/`AppXSvc`
and `wuauserv` itself all fine. From outside, that looks identical to the Store window just hanging. `install` checks
all five before it downloads anything (skipped for `WPM`, since that path never touches Windows Update or Appx
deployment at all) and stops with `E_SERVICE_DISABLED` (exit code 9) and the exact `Set-Service … -StartupType Manual`
fix if one is `Disabled`. `--force` downloads and launches the installer anyway, on the chance the app finishes some
other way. There is no way around this one short of enabling the service: unlike the `Stopped`-but-`Manual` case
below, `Disabled` needs a persistent `-StartupType` change, which needs admin rights ghostget never asks for.

`Set-Service -StartupType Manual` only makes a service *startable*; it does not start it. Windows is supposed to start
a `Manual` service itself the moment something asks for it, but right after flipping it back on from `Disabled` that
trigger does not always fire before the next install runs — `ClipSVC` and `AppXSvc` in particular are commonly still
`Stopped` at that point. When that happens the downloaded installer still launches and still verifies fine, but the
Store falls back to opening its own app window for a person to finish by hand instead of deploying the package
silently, which looks identical to `install` having done nothing. `install` and `doctor` both check `Status`, not just
`StartType`.

**`install` fixes this itself, without a manual step.** For any needed service that is enabled but not `Running`, it
calls `Start-Service` before downloading anything — proven live that this needs no elevation: Windows lets a standard
user start these services (they are meant to be triggered by ordinary Store usage), even though it does *not* let a
standard user stop them again. After the install (right after the `--wait` loop if `--wait` was given, otherwise a
short-lived detached background watcher that waits for the app to show up installed or a bounded timeout, then exits)
`install` tries `Stop-Service` on anything it started, best effort. Without admin rights that stop silently does
nothing — the service is simply left `Running` until Windows stops it on its own, which is not a persistent change:
`StartType` is never touched, so this is not something `doctor` would ever flag as a problem, and nothing is different
about the machine after Windows eventually stops it than before `install` ran. `Disabled` services are a different,
stricter case (see above): fixing those needs `-StartupType`, which `install` does not attempt itself.

## What ghostget deliberately does not do

- Sign in, handle credentials, or handle payment.
- Elevate, or change a persistent Windows setting (`Set-Service -StartupType …`; `doctor` prints the fix but never runs
  it). `install` *does* start a Store deployment service that is enabled but not running, and tries to stop it again
  afterward — see above — because that is the app's own on-demand running state, not a setting.
- Pick between apps for you.
- Bypass purchases, licences or DRM. The web installer only offers what Microsoft offers any visitor.
