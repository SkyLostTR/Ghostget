// @ts-check
import { resolveEndpoints, resolveLocale } from './config.js';
import { PRODUCT_ID_RE } from './constants.js';
import { EXIT, GhostgetError, usageError } from './errors.js';
import { requestJson } from './http.js';
import { hostArch } from './util.js';

/**
 * @typedef {object} SearchResult
 * @property {string} id Store product id, e.g. `9N8CJ4W95TBZ`.
 * @property {string} name
 * @property {string} publisher
 * @property {string} price Price as the Store displays it ("Free", "$9.99"). Empty when unknown.
 * @property {string[]} categories
 * @property {number|null} rating
 * @property {string[]} packageFamilyNames
 * @property {string|null} delivery How the Store delivers it: `WindowsUpdate` (Store package) or `WPM` (vendor installer).
 */

/**
 * @typedef {object} Product
 * @property {string} id
 * @property {string} name
 * @property {string} publisher
 * @property {string} description
 * @property {string|null} category
 * @property {string|null} kind `Application`, `Game`, ...
 * @property {{ amount: number|null, currency: string|null, free: boolean|null }} price `free` is null when the Store did not say.
 * @property {string|null} packageFamilyName
 * @property {string[]} packageFamilyNames
 * @property {string[]} architectures
 * @property {number|null} downloadSize Bytes, main package for this machine's architecture.
 * @property {string|null} version
 * @property {string|null} delivery
 * @property {string|null} releasedAt
 * @property {string|null} updatedAt
 * @property {{ average: number|null, count: number|null }} rating
 * @property {number|null} minAge
 * @property {string|null} website
 * @property {string} storeUrl
 * @property {string} market
 * @property {string} locale
 */

/**
 * @typedef {object} CatalogOptions
 * @property {string} [market] Two-letter country code, default from the system locale.
 * @property {string} [locale] BCP 47 tag, default from the system locale.
 * @property {number} [limit] Search only. 1-20, default 10.
 * @property {Partial<import('./config.js').Endpoints>} [endpoints]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {typeof fetch} [fetch]
 * @property {AbortSignal} [signal]
 * @property {number} [timeoutMs] Per request. Default 20 s.
 * @property {number} [retries] Extra attempts after a network error or 5xx. Default 2.
 * @property {(message: string) => void} [onDebug]
 */

/**
 * Pull a Store product id out of an id, a Store URL, or an `ms-windows-store://` link.
 * Returns null when the input is a plain search term.
 * @param {unknown} input
 * @returns {string|null}
 */
export function extractProductId(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (PRODUCT_ID_RE.test(raw)) return raw.toUpperCase();

  const looksLikeUrl = /^(?:https?|ms-windows-store):/i.test(raw) || /^(?:[a-z0-9-]+\.)*microsoft\.com\//i.test(raw);
  if (!looksLikeUrl) return null;

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === 'productid' && PRODUCT_ID_RE.test(value)) return value.toUpperCase();
  }
  for (const segment of url.pathname.split('/').reverse()) {
    if (PRODUCT_ID_RE.test(segment)) return segment.toUpperCase();
  }
  return null;
}

/**
 * Search the Microsoft Store. No login needed.
 * Uses the Store's own search API and falls back to the winget `msstore` search API.
 * @param {string} query A search term. A product id or Store URL returns that one product.
 * @param {CatalogOptions} [opts]
 * @returns {Promise<SearchResult[]>}
 */
export async function searchStore(query, opts = {}) {
  const q = String(query ?? '').trim();
  if (!q) throw usageError('The search query is empty.');

  const direct = extractProductId(q);
  if (direct) return [productToResult(await getProduct(direct, opts))];

  const limit = Math.min(20, Math.max(1, Math.trunc(opts.limit ?? 10)));
  const { market, locale } = resolveLocale(opts);
  const endpoints = resolveEndpoints(opts.endpoints, opts.env);

  /** @type {GhostgetError | undefined} */
  let primaryError;
  try {
    const results = await searchViaStore(q, { ...opts, market, locale, endpoints });
    if (results.length) return results.slice(0, limit);
    opts.onDebug?.('store search returned no results, trying manifestSearch');
  } catch (err) {
    if (!(err instanceof GhostgetError) || err.code === 'E_USAGE') throw err;
    primaryError = err;
    opts.onDebug?.(`store search failed (${err.message}), trying manifestSearch`);
  }

  try {
    return (await searchViaManifest(q, limit, { ...opts, endpoints })).slice(0, limit);
  } catch (err) {
    if (primaryError) throw primaryError;
    // The primary search succeeded with zero hits; a failing fallback should not turn that into an error.
    if (err instanceof GhostgetError) return [];
    throw err;
  }
}

/**
 * @param {string} query
 * @param {CatalogOptions & { market: string, locale: string, endpoints: import('./config.js').Endpoints }} opts
 * @returns {Promise<SearchResult[]>}
 */
async function searchViaStore(query, opts) {
  const params = new URLSearchParams({ query, market: opts.market, locale: opts.locale, deviceFamily: 'Windows.Desktop' });
  const json = await requestJson(`${opts.endpoints.storeEdge}/search?${params}`, opts);
  const cards = Array.isArray(json?.Payload?.SearchResults) ? json.Payload.SearchResults : [];
  return cards
    .filter((/** @type {any} */ c) => c?.ProductId && c?.Title)
    .map((/** @type {any} */ c) => ({
      id: String(c.ProductId).toUpperCase(),
      name: String(c.Title),
      publisher: String(c.PublisherName ?? ''),
      price: String(c.DisplayPrice ?? ''),
      categories: Array.isArray(c.Categories) ? c.Categories.map(String) : [],
      rating: typeof c.AverageRating === 'number' ? c.AverageRating : null,
      packageFamilyNames: Array.isArray(c.PackageFamilyNames) ? c.PackageFamilyNames.map(String) : [],
      delivery: c.Installer?.Type ?? null,
    }));
}

/**
 * The search API behind `winget --source msstore`. Small and stable, but it misses some apps.
 * @param {string} query
 * @param {number} limit
 * @param {CatalogOptions & { endpoints: import('./config.js').Endpoints }} opts
 * @returns {Promise<SearchResult[]>}
 */
async function searchViaManifest(query, limit, opts) {
  const json = await requestJson(`${opts.endpoints.storeEdge}/manifestSearch`, {
    ...opts,
    method: 'POST',
    body: { MaximumResults: limit, Query: { KeyWord: query, MatchType: 'Substring' } },
  });
  const rows = Array.isArray(json?.Data) ? json.Data : [];
  return rows
    .filter((/** @type {any} */ d) => d?.PackageIdentifier && d?.PackageName)
    .map((/** @type {any} */ d) => ({
      id: String(d.PackageIdentifier).toUpperCase(),
      name: String(d.PackageName),
      publisher: String(d.Publisher ?? ''),
      price: '',
      categories: [],
      rating: null,
      packageFamilyNames: (d.Versions ?? []).flatMap((/** @type {any} */ v) => v?.PackageFamilyNames ?? []).map(String),
      delivery: null,
    }));
}

/**
 * Full details for one product: price, size, package family, architectures...
 * @param {string} id A product id or Store URL.
 * @param {CatalogOptions} [opts]
 * @returns {Promise<Product>}
 */
export async function getProduct(id, opts = {}) {
  const productId = extractProductId(id);
  if (!productId) {
    throw usageError(`"${id}" is not a Microsoft Store product id.`, 'Ids look like 9N8CJ4W95TBZ (12 characters) or XP9KHM4BK9FZ7Q (14 characters).');
  }
  const { market, locale } = resolveLocale(opts);
  const endpoints = resolveEndpoints(opts.endpoints, opts.env);

  const catalogParams = new URLSearchParams({ bigIds: productId, market, languages: `${locale},neutral` });
  // Always English here: the Store writes prices as words ("Free", "Paid") and localises them, and the
  // free/paid decision below must not depend on the user's language. The market still sets the price.
  const edgeParams = new URLSearchParams({ market, locale: 'en-US', deviceFamily: 'Windows.Desktop' });

  const [catalog, edge] = await Promise.all([
    requestJson(`${endpoints.displayCatalog}/products?${catalogParams}`, opts).then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error }),
    ),
    // Delivery type, and the only source for Win32 apps (`XP...` ids), so a failure here is not fatal.
    requestJson(`${endpoints.storeEdge}/products/${productId}?${edgeParams}`, { ...opts, retries: 0 }).catch(() => null),
  ]);

  const ctx = { market, locale, endpoints };
  const raw = catalog.value?.Products?.[0];
  if (raw) return normalizeProduct(raw, edge, ctx);
  // The display catalog has no Win32 apps at all; the Store's own product API does.
  if (edge?.Payload?.ProductId) return normalizeEdgeProduct(edge.Payload, ctx);
  if (catalog.error) throw catalog.error;
  throw new GhostgetError(`No Microsoft Store product with id ${productId} in market ${market}.`, {
    code: 'E_NOT_FOUND',
    exitCode: EXIT.NOT_FOUND,
    hint: 'Check the id, or try another market with --market US.',
  });
}

/**
 * Build a {@link Product} from the Store's own product API. Used for Win32 apps (`XP...` ids), which the
 * display catalog does not know. Its numeric `Price` is 0 even for paid Win32 apps, so free/paid is read
 * from the English display price instead, and left unknown when the Store does not say plainly.
 * @param {any} p `Payload` of `storeedgefd /products/{id}`
 * @param {{ market: string, locale: string, endpoints: import('./config.js').Endpoints }} ctx
 * @returns {Product}
 */
function normalizeEdgeProduct(p, { market, locale, endpoints }) {
  const label = String(p.DisplayPrice ?? '').trim();
  const listed = typeof p.Price === 'number' && p.Price > 0 ? p.Price : null;
  /** @type {boolean|null} */
  let free = null;
  if (listed !== null || /^paid$/i.test(label)) free = false;
  else if (/^free$/i.test(label) && p.Price === 0) free = true;

  const families = Array.isArray(p.PackageFamilyNames) ? p.PackageFamilyNames.map(String) : [];
  const type = typeof p.ProductType === 'string' && p.ProductType ? p.ProductType[0].toUpperCase() + p.ProductType.slice(1).toLowerCase() : null;
  return {
    id: String(p.ProductId).toUpperCase(),
    name: String(p.Title ?? p.ProductId),
    publisher: String(p.PublisherName ?? ''),
    description: String(p.Description ?? p.ShortDescription ?? ''),
    category: Array.isArray(p.Categories) && p.Categories[0] ? String(p.Categories[0]) : null,
    kind: type,
    price: { amount: free === true ? 0 : listed, currency: p.Skus?.[0]?.CurrencyCode ?? null, free },
    packageFamilyName: families[0] ?? null,
    packageFamilyNames: families,
    architectures: Array.isArray(p.Platforms) ? p.Platforms.map((/** @type {unknown} */ a) => String(a).toLowerCase()) : [],
    downloadSize: typeof p.ApproximateSizeInBytes === 'number' && p.ApproximateSizeInBytes > 0 ? p.ApproximateSizeInBytes : null,
    version: typeof p.Version === 'string' && p.Version ? p.Version : null,
    delivery: p.Installer?.Type ?? null,
    releasedAt: p.ReleaseDateUtc ?? null,
    updatedAt: p.LastUpdateDateUtc ?? null,
    rating: { average: typeof p.AverageRating === 'number' ? p.AverageRating : null, count: typeof p.RatingCount === 'number' ? p.RatingCount : null },
    minAge: null,
    website: p.AppWebsiteUrl ?? null,
    storeUrl: `${endpoints.storePage}/${String(p.ProductId).toLowerCase()}?${new URLSearchParams({ hl: locale, gl: market })}`,
    market,
    locale,
  };
}

/**
 * @param {any} raw display catalog product
 * @param {any} edge storeedgefd product payload (may be null)
 * @param {{ market: string, locale: string, endpoints: import('./config.js').Endpoints }} ctx
 * @returns {Product}
 */
function normalizeProduct(raw, edge, { market, locale, endpoints }) {
  const localized = raw.LocalizedProperties?.[0] ?? {};
  const marketProps = raw.MarketProperties?.[0] ?? {};
  const skus = raw.DisplaySkuAvailabilities ?? [];
  const full = skus.find((/** @type {any} */ s) => s.Sku?.SkuType === 'full') ?? skus[0];
  const packages = /** @type {any[]} */ (full?.Sku?.Properties?.Packages ?? []);
  const availabilities = /** @type {any[]} */ (full?.Availabilities ?? []);

  // The availability that can actually be acquired holds the real price. Others only describe "details" pages.
  const acquirable =
    availabilities.find((a) => a.Actions?.includes('Purchase')) ?? availabilities.find((a) => a.Actions?.includes('Fulfill'));
  const priceInfo = acquirable?.OrderManagementData?.Price;
  const amount = typeof priceInfo?.ListPrice === 'number' ? priceInfo.ListPrice : null;

  const arch = hostArch();
  const forHost = packages.filter((p) => p.Architectures?.includes(arch) || p.Architectures?.includes('neutral'));
  const sizes = (forHost.length ? forHost : packages)
    .map((p) => p.MaxDownloadSizeInBytes)
    .filter((n) => Number.isFinite(n) && n > 0);

  const fullName = packages.find((p) => p.PackageFullName)?.PackageFullName;
  const version = typeof fullName === 'string' ? (/^[^_]+_(\d+(?:\.\d+)+)_/.exec(fullName)?.[1] ?? null) : null;

  const families = [
    ...new Set(
      [raw.Properties?.PackageFamilyName, ...packages.map((p) => p.PackageFamilyName)].filter(
        (/** @type {unknown} */ v) => typeof v === 'string' && v,
      ),
    ),
  ];

  const usage = marketProps.UsageData ?? [];
  const rating = usage.find((/** @type {any} */ u) => u.AggregateTimeSpan === 'AllTime') ?? usage[0] ?? {};

  return {
    id: String(raw.ProductId).toUpperCase(),
    name: localized.ProductTitle ?? localized.ShortTitle ?? String(raw.ProductId),
    publisher: localized.PublisherName ?? '',
    description: localized.ProductDescription ?? localized.ShortDescription ?? '',
    category: raw.Properties?.Category ?? null,
    kind: raw.ProductKind ?? null,
    price: { amount, currency: priceInfo?.CurrencyCode ?? null, free: amount === null ? null : amount === 0 },
    packageFamilyName: families[0] ?? null,
    packageFamilyNames: /** @type {string[]} */ (families),
    architectures: [...new Set(packages.flatMap((p) => p.Architectures ?? []))],
    downloadSize: sizes.length ? Math.max(...sizes) : null,
    version,
    delivery: edge?.Payload?.Installer?.Type ?? null,
    releasedAt: marketProps.OriginalReleaseDate ?? null,
    updatedAt: raw.LastModifiedDate ?? null,
    rating: { average: rating.AverageRating ?? null, count: rating.RatingCount ?? null },
    minAge: marketProps.MinimumUserAge ?? null,
    website: localized.PublisherWebsiteUri ?? localized.SupportUri?.[0]?.Uri ?? null,
    storeUrl: `${endpoints.storePage}/${String(raw.ProductId).toLowerCase()}?${new URLSearchParams({ hl: locale, gl: market })}`,
    market,
    locale,
  };
}

/** @param {Product} p @returns {SearchResult} */
function productToResult(p) {
  const money = p.price.free ? 'Free' : p.price.amount === null ? '' : `${p.price.amount} ${p.price.currency ?? ''}`.trim();
  return {
    id: p.id,
    name: p.name,
    publisher: p.publisher,
    price: money,
    categories: p.category ? [p.category] : [],
    rating: p.rating.average,
    packageFamilyNames: p.packageFamilyNames,
    delivery: p.delivery,
  };
}
