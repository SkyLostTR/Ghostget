# Contributing

Thanks for helping. Ghostget is created and maintained by [SkyLostTR](https://github.com/SkyLostTR) (`@Keeftraum`); this
project is small on purpose: zero runtime dependencies, one job, done carefully.

## Setup

```bash
git clone <this repository's URL> ghostget && cd ghostget
npm install
npm run check        # type-check, then run every test
node bin/ghostget.js doctor
```

Node.js 20.3 or newer. Windows gives you the whole picture, but every test that needs Windows skips itself elsewhere, so
Linux and macOS contributors can work on everything else.

## How the code is laid out

```
bin/ghostget.js        entry point (checks the Node version, then calls src/cli.js)
src/cli.js             argument parsing, command table, help text, error reporting
src/commands.js        one function per command; talks to the user through src/ui.js
src/catalog.js         search and product details (no side effects)
src/resolve.js         "what did the user mean?" (never guesses)
src/installer.js       URL, download, signature check, launch, and the install flow
src/windows.js         everything that talks to Windows (via PowerShell)
src/diagnostics.js     `ghostget doctor`
src/ui.js              colour, tables, spinner, progress (no dependencies)
scripts/ghostget.ps1   the dependency-free PowerShell edition
test/                  node:test tests, a mock of the Microsoft hosts, trimmed real fixtures
docs/                  how it works, API, troubleshooting
website/               the ghostget.kief.fi site (static HTML/CSS/JS, no build step)
```

Rules that keep it maintainable:

- **No runtime dependencies.** If you think you need one, open an issue first.
- **Types live in JSDoc**, checked by `tsc` (`npm run typecheck`). `.d.ts` files are generated on publish; do not commit them.
- **Library code never prints and never exits.** Output belongs to `commands.js`/`ui.js`; the CLI returns an exit code instead of calling `process.exit`.
- **Data on stdout, everything else on stderr.** `ghostget url x | clip` must stay clean.
- **Nothing user-controlled is spliced into PowerShell.** Pass it in an environment variable (see `src/windows.js`).
- **Never weaken the signature check** to make a test pass. Tests use a mock server and real Microsoft-signed system files.

## Tests

```bash
npm test                         # everything
node --test test/catalog.test.js # one file
```

Tests never touch the network. `test/support/mock-store.js` is a local stand-in for the three Microsoft hosts, and
`test/fixtures/` holds trimmed copies of real responses. When Microsoft changes a response shape, refresh the fixture from a
live response (keep only the fields ghostget reads) and add a test that fails without your fix.

The PowerShell edition has its own tests (`test/ps1*.test.js`) that run it under Windows PowerShell against the same mock.
Keep it in step with the npm edition: same commands, same exit codes, same paid-app rules.

## Adding a command

1. Add a function in `src/commands.js` that takes a `Context` and returns an exit code.
2. Register it in `COMMANDS` in `src/cli.js` with its options.
3. Add tests in `test/cli.test.js`, and a row in the README's command table (both languages).

## Pull requests

- Keep them focused; explain *why* in the description.
- `npm run check` must pass.
- Update `CHANGELOG.md` under an `Unreleased` heading, and the README when behaviour changes.
- If you touched the Microsoft endpoints, say which response you observed.