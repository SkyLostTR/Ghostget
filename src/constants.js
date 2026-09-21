// @ts-check
import { VERSION } from './version.js';

export const USER_AGENT = `ghostget/${VERSION}`;

/**
 * Public Microsoft endpoints. None of them need a login.
 * Each can be overridden with a GHOSTGET_*_URL environment variable (tests, mirrors).
 */
export const DEFAULT_ENDPOINTS = Object.freeze({
  /** Microsoft Store Web Installer: returns a small, signed bootstrapper exe. */
  installer: 'https://get.microsoft.com/installer/download',
  /** Store display catalog: product details and prices. */
  displayCatalog: 'https://displaycatalog.mp.microsoft.com/v7.0',
  /** The API the Store app itself uses for search and product pages. */
  storeEdge: 'https://storeedgefd.dsx.mp.microsoft.com/v9.0',
  /** Public product page, used for links only. */
  storePage: 'https://apps.microsoft.com/detail',
});

/** Campaign id Microsoft's own website appends to installer links. */
export const DEFAULT_CAMPAIGN_ID = 'website_cta_psi';

/** 12-char `9...` ids (most apps) or 14-char `XP...` ids (Win32 apps such as VS Code). */
export const PRODUCT_ID_RE = /^(?:9[A-Z0-9]{11}|XP[A-Z0-9]{12})$/i;
