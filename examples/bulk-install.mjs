// Install several apps in a row. It is a dry run unless you pass --go.
//
//   node examples/bulk-install.mjs 9N0DX20HK701 9N8G5RFZ9XK3          (dry run: shows what would happen)
//   node examples/bulk-install.mjs 9N0DX20HK701 9N8G5RFZ9XK3 --go     (installs, waiting for each one)
//
// Use ids, not names: a name that matches several apps is refused rather than guessed.
import { GhostgetError, installApp } from 'ghostget';

const go = process.argv.includes('--go');
const ids = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (!ids.length) {
  console.error('Usage: node examples/bulk-install.mjs <id> [<id>...] [--go]');
  process.exit(2);
}

let failed = 0;
for (const id of ids) {
  try {
    const result = await installApp(id, { dryRun: !go, wait: go });
    console.log(`${id}: ${result.status} (${result.name})`);
  } catch (err) {
    failed++;
    console.error(`${id}: ${err instanceof GhostgetError ? `${err.code}: ${err.message}` : err}`);
  }
}
process.exitCode = failed ? 1 : 0;
