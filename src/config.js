// @ts-check
import { DEFAULT_ENDPOINTS } from './constants.js';
import { usageError } from './errors.js';

/** @typedef {{ installer: string, displayCatalog: string, storeEdge: string, storePage: string }} Endpoints */

const ENV_KEYS = /** @type {const} */ ({
  installer: 'GHOSTGET_INSTALLER_URL',
  displayCatalog: 'GHOSTGET_DISPLAY_CATALOG_URL',
  storeEdge: 'GHOSTGET_STORE_EDGE_URL',
  storePage: 'GHOSTGET_STORE_PAGE_URL',
});

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Endpoints must be https (plain http is allowed for loopback only, so tests can use a local server).
 * @param {string} value
 * @param {string} label
 */
function checkEndpoint(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw usageError(`${label} is not a valid URL: ${value}`);
  }
  const ok = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  if (!ok) throw usageError(`${label} must be an https URL (http is only allowed for localhost).`);
  return value.replace(/\/+$/, '');
}

/**
 * @param {Partial<Endpoints>} [overrides]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Endpoints}
 */
export function resolveEndpoints(overrides = {}, env = process.env) {
  const out = /** @type {Endpoints} */ ({});
  for (const key of /** @type {(keyof Endpoints)[]} */ (Object.keys(ENV_KEYS))) {
    const value = overrides[key] ?? env[ENV_KEYS[key]] ?? DEFAULT_ENDPOINTS[key];
    out[key] = checkEndpoint(value, ENV_KEYS[key]);
  }
  return out;
}

/** @returns {{ locale: string, market: string }} */
export function detectSystemLocale() {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    const region = new Intl.Locale(locale).maximize().region;
    if (locale && region) return { locale, market: region };
  } catch {
    // fall through to the default
  }
  return { locale: 'en-US', market: 'US' };
}

/**
 * Store catalogs are per market: it changes titles, prices and availability.
 * Precedence: explicit option, then GHOSTGET_* env vars, then the system locale.
 * @param {{ market?: string, locale?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export function resolveLocale({ market, locale, env = process.env } = {}) {
  const system = detectSystemLocale();
  const loc = locale ?? env.GHOSTGET_LOCALE ?? system.locale;
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(loc)) {
    throw usageError(`"${loc}" is not a valid locale.`, 'Use a BCP 47 tag such as en-US or tr-TR.');
  }
  let region;
  try {
    region = new Intl.Locale(loc).region;
  } catch {
    region = undefined;
  }
  const mkt = market ?? env.GHOSTGET_MARKET ?? region ?? system.market;
  if (!/^[A-Za-z]{2}$/.test(mkt)) {
    throw usageError(`"${mkt}" is not a valid market.`, 'Use a two-letter country code such as US or TR.');
  }
  return { locale: loc, market: mkt.toUpperCase() };
}
