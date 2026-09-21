// @ts-check

const ARCH_NAMES = /** @type {Record<string, string>} */ ({ x64: 'x64', arm64: 'arm64', ia32: 'x86' });

/** This machine's CPU architecture, named the way the Store names it. */
export const hostArch = () => ARCH_NAMES[process.arch] ?? process.arch;

/**
 * Resolve after `ms`, or reject with the signal's reason if it aborts first.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
