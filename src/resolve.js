// @ts-check
import { extractProductId, getProduct, searchStore } from './catalog.js';
import { EXIT, GhostgetError, usageError } from './errors.js';

/**
 * @typedef {import('./catalog.js').CatalogOptions & {
 *   details?: 'auto'|'never'|'always',
 *   exact?: boolean,
 *   choose?: (candidates: import('./catalog.js').SearchResult[]) => Promise<import('./catalog.js').SearchResult|null>,
 *   onWarn?: (message: string) => void,
 * }} ResolveOptions
 */

/**
 * @typedef {object} Resolved
 * @property {string} id
 * @property {import('./catalog.js').Product|null} product Null when details were skipped or unavailable.
 * @property {'id'|'search'} via
 * @property {import('./catalog.js').SearchResult} [candidate] The search hit that was chosen, when `via` is `search`.
 */

/** @param {string} value */
const normalize = (value) => value.trim().toLowerCase();

/**
 * Turn what the user typed into one Store product.
 * A product id or Store URL is taken as-is. Anything else is searched, and ghostget only
 * proceeds when the match is unambiguous (one result, or one exact name match); otherwise it
 * asks (`choose`) or fails with the candidate list. It never silently guesses.
 *
 * @param {string} input
 * @param {ResolveOptions} [opts]
 * @returns {Promise<Resolved>}
 */
export async function resolveProduct(input, opts = {}) {
  const { details = 'auto', exact = false, choose, onWarn } = opts;
  const text = String(input ?? '').trim();
  if (!text) throw usageError('Tell me which app: a Store id, a Store URL or a name to search for.');

  const direct = extractProductId(text);
  if (direct) return withDetails(direct, 'id', undefined);

  const results = await searchStore(text, { ...opts, limit: 20 });
  if (!results.length) {
    throw new GhostgetError(`Nothing in the Microsoft Store matches "${text}".`, {
      code: 'E_NOT_FOUND',
      exitCode: EXIT.NOT_FOUND,
      hint: 'Try fewer words, or search with: ghostget search <query>',
    });
  }

  const sameName = results.filter((r) => normalize(r.name) === normalize(text));
  /** @type {import('./catalog.js').SearchResult|null|undefined} */
  let picked;
  if (sameName.length === 1) picked = sameName[0];
  else if (!exact && results.length === 1) picked = results[0];
  else if (exact && sameName.length === 0) {
    throw new GhostgetError(`No app is named exactly "${text}".`, {
      code: 'E_NOT_FOUND',
      exitCode: EXIT.NOT_FOUND,
      hint: 'Drop --exact, or pass the Store id.',
      details: { candidates: results },
    });
  } else {
    const candidates = sameName.length > 1 ? sameName : results;
    picked = choose ? await choose(candidates) : undefined;
    if (picked === undefined) {
      throw new GhostgetError(`"${text}" matches ${candidates.length} apps.`, {
        code: 'E_AMBIGUOUS',
        exitCode: EXIT.AMBIGUOUS,
        hint: 'Re-run with the exact Store id of the one you want.',
        details: { candidates },
      });
    }
    if (picked === null) throw new GhostgetError('Cancelled.', { code: 'E_CANCELLED', exitCode: EXIT.ERROR });
  }
  return withDetails(picked.id, 'search', picked);

  /**
   * @param {string} id
   * @param {'id'|'search'} via
   * @param {import('./catalog.js').SearchResult|undefined} candidate
   * @returns {Promise<Resolved>}
   */
  async function withDetails(id, via, candidate) {
    if (details === 'never') return { id, product: null, via, candidate };
    try {
      return { id, product: await getProduct(id, opts), via, candidate };
    } catch (err) {
      // A missing product is a real answer. A flaky details call must not block an install.
      if (details === 'always' || !(err instanceof GhostgetError) || err.code === 'E_NOT_FOUND' || err.code === 'E_USAGE') throw err;
      onWarn?.(`Could not load details for ${id}: ${err.message} Continuing without them.`);
      return { id, product: null, via, candidate };
    }
  }
}
