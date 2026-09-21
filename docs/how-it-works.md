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
an install works with it **Disabled** depends on the app and has not been verified.

Unlike `wuauserv`, `InstallService`, `ClipSVC` and `AppXSvc` are not optional for anything other than `WPM`: without them
the launched installer cannot hand a package to Windows at all, no matter how the app is delivered. `install` checks the
three of them before it downloads anything (skipped for `WPM`, since that path never touches Appx deployment) and stops
with `E_SERVICE_DISABLED` (exit code 9) and the exact `Set-Service … -StartupType Manual` fix if one is `Disabled`.
`--force` downloads and launches the installer anyway, on the chance the app finishes some other way.

## What ghostget deliberately does not do

- Sign in, handle credentials, or handle payment.
- Elevate, or change any Windows setting (`doctor` prints fix commands but never runs them).
- Pick between apps for you.
- Bypass purchases, licences or DRM. The web installer only offers what Microsoft offers any visitor.
