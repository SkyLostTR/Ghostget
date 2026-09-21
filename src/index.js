// @ts-check
/**
 * ghostget as a library. Everything here is what the CLI itself uses.
 *
 * ```js
 * import { searchStore, installApp } from 'ghostget';
 *
 * const [best] = await searchStore('chatgpt');
 * await installApp(best.id, { onEvent: (e) => console.log(e.type) });
 * ```
 */
export { getProduct, extractProductId, searchStore } from './catalog.js';
export { resolveProduct } from './resolve.js';
export {
  assertTrustedInstaller,
  buildInstallerUrl,
  disabledDeploymentServices,
  downloadInstaller,
  installApp,
  isTrustedMicrosoftSignature,
  launchInstaller,
  verifyInstaller,
} from './installer.js';
export { runDiagnostics } from './diagnostics.js';
export { getInstalledPackages } from './windows.js';
export { EXIT, GhostgetError } from './errors.js';
export { VERSION } from './version.js';
