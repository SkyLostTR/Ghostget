# Library API

```js
import { searchStore, getProduct, installApp } from 'ghostget';
```

ESM only, Node 20.3+, no dependencies. Types ship as generated `.d.ts` files (`types/`, built by `npm run build:types`
and included in the published package). From CommonJS on Node 22.12+ you can `require('ghostget')`; on older Node use
`await import('ghostget')`.

Every function that talks to the network accepts these options:

| Option | Meaning |
| --- | --- |
| `market` | Two-letter Store market (`US`, `TR`). Default: system locale |
| `locale` | BCP 47 tag (`en-US`, `tr-TR`). Default: system locale |
| `endpoints` | `{ installer, displayCatalog, storeEdge }` overrides. `https`, or `http` on localhost |
| `env` | Environment to read `GHOSTGET_*` from. Default `process.env` |
| `fetch` | A `fetch` implementation (tests, proxies) |
| `signal` | An `AbortSignal` |
| `timeoutMs`, `retries` | Per request. Defaults 20 000 ms and 2 retries on network errors and 5xx |

## Catalog

### `searchStore(query, options?) → Promise<SearchResult[]>`

Searches the Store. A product id or Store URL returns that one product. `limit` is 1–20 (default 10).
Falls back to the winget `msstore` search when the Store search fails or finds nothing.

```ts
interface SearchResult {
  id: string; name: string; publisher: string;
  price: string;              // as the Store shows it: "Free", "$9.99", "Ücretsiz"
  categories: string[]; rating: number | null;
  packageFamilyNames: string[];
  delivery: 'WindowsUpdate' | 'WPM' | null;
}
```

### `getProduct(idOrUrl, options?) → Promise<Product>`

Full details. Throws `E_NOT_FOUND` if the Store has no such product in the market.

```ts
interface Product {
  id: string; name: string; publisher: string; description: string;
  category: string | null; kind: string | null;              // 'Application', 'Game'
  price: { amount: number | null; currency: string | null; free: boolean | null };  // free === null: unknown
  packageFamilyName: string | null; packageFamilyNames: string[];
  architectures: string[]; downloadSize: number | null;     // bytes, for this machine's architecture
  version: string | null; delivery: string | null;
  releasedAt: string | null; updatedAt: string | null;
  rating: { average: number | null; count: number | null };
  minAge: number | null; website: string | null;
  storeUrl: string; market: string; locale: string;
}
```

### `extractProductId(input) → string | null`

Pulls an id out of an id, a Store URL (`apps.microsoft.com/detail/…`, `microsoft.com/store/productId/…`) or an
`ms-windows-store://` link. Returns `null` for anything else. Pure function, no network.

### `resolveProduct(input, options?) → Promise<{ id, product, via, candidate? }>`

Turns what a user typed into one product, with ghostget's "never guess" policy. Extra options:
`details: 'auto' | 'never' | 'always'`, `exact: boolean`, `choose(candidates)` (return one candidate, or `null` to cancel),
`onWarn(message)`. Without `choose`, an ambiguous match throws `E_AMBIGUOUS` with `error.details.candidates`.

## Installing

### `installApp(target, options?) → Promise<InstallResult>`

The whole flow. Windows only, except with `dryRun`.

| Option | Meaning |
| --- | --- |
| `dryRun` | Resolve and report; download and run nothing |
| `force` | Proceed for paid apps, and for apps that are already installed |
| `noVerify` | Skip the signature check (not recommended) |
| `wait`, `waitTimeoutMs` | After launching, poll until the app is installed (Store packages only). Default 10 min |
| `dir` | Keep the installer here. Default: a temp folder, cleaned after a day |
| `exact`, `choose` | As for `resolveProduct` |
| `campaignId` | The `cid` query value |
| `onEvent(event)` | Progress, see below |

```ts
type InstallResult = {
  status: 'dry-run' | 'already-installed' | 'launched' | 'installed' | 'wait-timeout';
  id: string; name: string; product: Product | null; installerUrl: string;
  installedVersion?: string; file?: Downloaded; signer?: string; pid?: number | null;
};
```

Events: `resolved`, `warning`, `download-start`, `progress { received, total }`, `downloaded { file }`,
`verified { subject }`, `launched { pid }`, `waiting { pfns }`.

```js
await installApp('9N0DX20HK701', {
  wait: true,
  onEvent(e) {
    if (e.type === 'progress') process.stderr.write(`\r${e.received}/${e.total ?? '?'}`);
    if (e.type === 'warning') console.warn(e.message);
  },
});
```

### Building blocks

| Function | Does |
| --- | --- |
| `buildInstallerUrl(idOrUrl, { campaignId?, endpoints?, env? })` | The direct installer URL. Pure |
| `downloadInstaller(idOrUrl, { dir?, onProgress?, … })` | Downloads into `dir` (default: current folder). Returns `{ id, url, path, fileName, size, sha256 }`. Checks the file is a Windows executable of the announced size; does **not** verify the signature or run it |
| `verifyInstaller(file)` | Windows only. `{ status, subject, issuer, thumbprint, message, trusted }` |
| `assertTrustedInstaller(file)` | Like `verifyInstaller`, but throws `E_SIGNATURE` and **deletes the file** when it is not Microsoft's |
| `isTrustedMicrosoftSignature({ status, subject })` | The rule itself: `Valid` and `O=Microsoft Corporation`. Pure |
| `launchInstaller(file)` | Windows only. Starts it like Explorer would; resolves with `{ pid }` without waiting |
| `getInstalledPackages({ pfns?, filter? })` | Windows only. Installed Store packages for the current user |
| `runDiagnostics({ env?, fetch? })` | What `ghostget doctor` prints, as `{ system, checks, ok }`. Read-only |

## Errors

Everything ghostget throws on purpose is a `GhostgetError` with `code`, `exitCode`, an optional `hint` and optional `details`.

| `code` | `exitCode` | When |
| --- | ---: | --- |
| `E_USAGE` | 2 | Bad input: not an id, empty query, invalid market or campaign id |
| `E_NOT_FOUND` | 3 | No results, unknown product, no web installer for the id |
| `E_AMBIGUOUS` | 4 | A name matches several apps (`details.candidates`) |
| `E_NETWORK`, `E_HTTP`, `E_BAD_RESPONSE`, `E_DOWNLOAD` | 5 | Connectivity, a non-2xx answer, an unusable response, a cut-off download |
| `E_UNSUPPORTED_PLATFORM` | 6 | A Windows-only step on another OS |
| `E_SIGNATURE` | 7 | The installer was not validly signed by Microsoft (`details.status`, `details.subject`) |
| `E_PAID` | 8 | The app is not free |
| `E_POWERSHELL` | 1 | PowerShell could not run or answered something unexpected |
| `E_CANCELLED` | 1 | The user cancelled a prompt |

```js
import { GhostgetError, EXIT } from 'ghostget';

try { await installApp('9PGLL77C201J'); }
catch (e) { if (e instanceof GhostgetError && e.exitCode === EXIT.PAID) console.log('paid:', e.message); }
```
