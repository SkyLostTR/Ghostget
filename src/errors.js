// @ts-check

/** Process exit codes. Stable: scripts may rely on them. */
export const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  AMBIGUOUS: 4,
  NETWORK: 5,
  UNSUPPORTED: 6,
  VERIFY: 7,
  PAID: 8,
});

export class GhostgetError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, exitCode?: number, hint?: string, cause?: unknown, details?: any }} [opts]
   */
  constructor(message, opts = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'GhostgetError';
    /** Machine-readable error code, e.g. `E_NOT_FOUND`. */
    this.code = opts.code ?? 'E_ERROR';
    this.exitCode = opts.exitCode ?? EXIT.ERROR;
    /** A one-line suggestion for the user. */
    this.hint = opts.hint;
    /** Extra structured data (for example the candidate list of an ambiguous search). */
    this.details = opts.details;
  }
}

/**
 * @param {string} message
 * @param {string} [hint]
 */
export function usageError(message, hint) {
  return new GhostgetError(message, { code: 'E_USAGE', exitCode: EXIT.USAGE, hint });
}
