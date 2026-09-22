// Temporary CI diagnostic script. Not shipped, not referenced by package.json "files".
import { spawn } from 'node:child_process';

const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const TARGET = 'Get-AuthenticodeSignature -LiteralPath $env:SystemRoot\\System32\\cmd.exe | Out-String | Write-Host';

function run(label, prelude) {
  return new Promise((resolve) => {
    const script = prelude + TARGET;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', encoded], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      console.log(`=== ${label} (exit ${code}) ===`);
      console.log('STDOUT:', out);
      console.log('STDERR:', err);
      resolve();
    });
  });
}

const cases = [
  ['no ErrorActionPreference', ''],
  ['EAP=Stop before call', "$ErrorActionPreference='Stop';"],
  ['EAP=Stop + explicit Import-Module first', "Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; $ErrorActionPreference='Stop';"],
  ['-Command instead of -EncodedCommand', null],
];

for (const [label, prelude] of cases) {
  if (prelude === null) {
    await new Promise((resolve) => {
      const child = spawn(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', TARGET], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => {
        console.log(`=== ${label} (exit ${code}) ===`);
        console.log('STDOUT:', out);
        console.log('STDERR:', err);
        resolve();
      });
    });
    continue;
  }
  await run(label, prelude);
}
