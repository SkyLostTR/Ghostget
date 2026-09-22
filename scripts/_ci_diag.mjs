// Temporary CI diagnostic script. Not shipped, not referenced by package.json "files".
import { spawn } from 'node:child_process';

const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const TARGET = 'Get-AuthenticodeSignature -LiteralPath $env:SystemRoot\\System32\\cmd.exe | Out-String | Write-Host';

console.log('process.env.PSModulePath as seen by node:', JSON.stringify(process.env.PSModulePath));
console.log('process.env.PATHEXT:', JSON.stringify(process.env.PATHEXT));

function run(label, envOverride) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...envOverride };
    const child = spawn(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', TARGET], { stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      console.log(`=== ${label} (exit ${code}) ===`);
      console.log('STDOUT:', out);
      console.log('STDERR:', err.slice(0, 300));
      resolve();
    });
  });
}

const winPsDefault = [
  `${process.env.USERPROFILE}\\Documents\\WindowsPowerShell\\Modules`,
  'C:\\Program Files\\WindowsPowerShell\\Modules',
  `${process.env.SystemRoot}\\system32\\WindowsPowerShell\\v1.0\\Modules`,
].join(';');

const noPsModulePath = { ...process.env };
delete noPsModulePath.PSModulePath;

await run('as inherited from parent (unmodified)', {});
await run('PSModulePath deleted entirely', { PSModulePath: undefined });
await run('PSModulePath forced to WinPS 5.1 default', { PSModulePath: winPsDefault });

// child_process treats an explicit `undefined` value as "unset" only via omission, not by passing
// the literal string. Try the delete-from-object approach as its own spawn call to be sure.
await new Promise((resolve) => {
  const child = spawn(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', TARGET], { stdio: ['ignore', 'pipe', 'pipe'], env: noPsModulePath });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  child.on('close', (code) => {
    console.log(`=== PSModulePath key removed from env object (exit ${code}) ===`);
    console.log('STDOUT:', out);
    console.log('STDERR:', err.slice(0, 300));
    resolve();
  });
});
