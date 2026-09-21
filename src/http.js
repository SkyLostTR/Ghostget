// @ts-check
import { USER_AGENT } from './constants.js';
import { EXIT, GhostgetError } from './errors.js';
import { sleep } from './util.js';

/**
 * @typedef {object} RequestOptions
 * @property {'GET'|'POST'} [method]
 * @property {unknown} [body] JSON body.
 * @property {Record<string, string>} [headers]
 * @property {number} [timeoutMs] Per attempt. Default 20 s.
 * @property {number} [retries] Extra attempts on network errors, 5xx and 429. Default 2.
 * @property {typeof fetch} [fetch] Injectable for tests.
 * @property {AbortSignal} [signal]
 */

/**
 * @param {string} url
 * @param {unknown} cause
 */
export function networkError(url, cause) {
  const host = safeHost(url);
  const timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
  return new GhostgetError(timedOut ? `Timed out talking to ${host}.` : `Could not reach ${host}.`, {
    code: 'E_NETWORK',
    exitCode: EXIT.NETWORK,
    hint: 'Check your connection, VPN or proxy. Node ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 (Node 24+); the PowerShell edition uses the Windows proxy settings.',
    cause,
  });
}

/** @param {Response} res */
export function httpError(res) {
  return new GhostgetError(`Microsoft answered ${res.status} ${res.statusText}`.trim() + '.', {
    code: 'E_HTTP',
    exitCode: EXIT.NETWORK,
    details: { status: res.status, url: res.url },
  });
}

/** @param {string} url */
function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * GET/POST JSON with a timeout and a small retry loop.
 * @param {string} url
 * @param {RequestOptions} [opts]
 * @returns {Promise<any>}
 */
export async function requestJson(url, opts = {}) {
  const { method = 'GET', body, headers = {}, timeoutMs = 20_000, retries = 2, fetch: doFetch = globalThis.fetch, signal } = opts;
  /** @type {GhostgetError | undefined} */
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1), signal);
    const attemptSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    try {
      const res = await doFetch(url, {
        method,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: attemptSignal,
      });
      if (res.status >= 500 || res.status === 429) {
        lastError = httpError(res);
        continue;
      }
      if (!res.ok) throw httpError(res);
      try {
        return await res.json();
      } catch (cause) {
        throw new GhostgetError('Microsoft sent a response ghostget could not parse.', {
          code: 'E_BAD_RESPONSE',
          exitCode: EXIT.NETWORK,
          cause,
        });
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof GhostgetError) throw err;
      lastError = networkError(url, err);
    }
  }
  throw lastError;
}
