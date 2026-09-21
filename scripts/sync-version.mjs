// Keeps the PowerShell edition's version in step with package.json.
// Runs from the `version` npm script, so `npm version minor` updates both.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const file = new URL('./ghostget.ps1', import.meta.url);
const text = readFileSync(file, 'utf8');
const pattern = /(\$script:Version = ')[^']*(')/;
if (!pattern.test(text)) throw new Error('Could not find $script:Version in scripts/ghostget.ps1');

writeFileSync(file, text.replace(pattern, (_match, open, close) => `${open}${version}${close}`));
console.log(`scripts/ghostget.ps1 is now ${version}`);
