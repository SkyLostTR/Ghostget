#!/usr/bin/env node
// Checked before importing anything, so an old Node prints a clear message instead of a stack trace.
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`ghostget needs Node.js 20 or newer (this is ${process.versions.node}).`);
  process.exitCode = 1;
} else {
  const { main } = await import('../src/cli.js');
  process.exitCode = await main(process.argv.slice(2));
}
