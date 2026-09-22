// @ts-check
import { parseArgs } from 'node:util';
import {
  doctorCommand,
  downloadCommand,
  installCommand,
  listCommand,
  searchCommand,
  showCommand,
  urlCommand,
} from './commands.js';
import { EXIT, GhostgetError } from './errors.js';
import { createUi } from './ui.js';
import { VERSION } from './version.js';

const OPTIONS = /** @type {const} */ ({
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  json: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  verbose: { type: 'boolean' },
  market: { type: 'string' },
  locale: { type: 'string' },
  limit: { type: 'string', short: 'n' },
  exact: { type: 'boolean', short: 'e' },
  'dry-run': { type: 'boolean' },
  'no-verify': { type: 'boolean' },
  force: { type: 'boolean', short: 'f' },
  'no-elevate': { type: 'boolean' },
  wait: { type: 'boolean' },
  timeout: { type: 'string' },
  dir: { type: 'string', short: 'd' },
  cid: { type: 'string' },
});

/** Options every command accepts. */
const GLOBAL = ['help', 'version', 'no-color', 'verbose'];

/**
 * @typedef {object} CommandSpec
 * @property {string[]} aliases
 * @property {string} usage
 * @property {string} summary
 * @property {string[]} options Options that apply, besides the global ones.
 * @property {boolean} [statusToStderr] Keep stdout for data only, so `$(ghostget url x)` works.
 * @property {(ctx: import('./commands.js').Context) => Promise<number>} run
 */

/** @type {Record<string, CommandSpec>} */
const COMMANDS = {
  search: {
    aliases: ['s', 'find'],
    usage: 'search <query>',
    summary: 'Search the Microsoft Store',
    options: ['limit', 'json', 'market', 'locale'],
    run: searchCommand,
  },
  show: {
    aliases: ['info'],
    usage: 'show <app>',
    summary: 'Show details, price and size of an app',
    options: ['json', 'market', 'locale', 'exact', 'cid'],
    run: showCommand,
  },
  install: {
    aliases: ['i', 'add'],
    usage: 'install <app>',
    summary: 'Download, verify and launch the Store installer',
    options: ['dry-run', 'no-verify', 'force', 'no-elevate', 'wait', 'timeout', 'dir', 'cid', 'exact', 'json', 'market', 'locale'],
    run: installCommand,
  },
  download: {
    aliases: ['dl'],
    usage: 'download <app>',
    summary: 'Download the installer only, without running it',
    options: ['dir', 'cid', 'exact', 'no-verify', 'json', 'market', 'locale'],
    statusToStderr: true,
    run: downloadCommand,
  },
  url: {
    aliases: [],
    usage: 'url <app>',
    summary: 'Print the direct installer URL',
    options: ['cid', 'exact', 'json', 'market', 'locale'],
    statusToStderr: true,
    run: urlCommand,
  },
  list: {
    aliases: ['ls'],
    usage: 'list [filter]',
    summary: 'List installed Store apps (Windows only)',
    options: ['json'],
    run: listCommand,
  },
  doctor: {
    aliases: [],
    usage: 'doctor',
    summary: 'Check this PC and the network for problems',
    options: ['json'],
    run: doctorCommand,
  },
};

/** @param {string} name */
function findCommand(name) {
  if (COMMANDS[name]) return name;
  return Object.keys(COMMANDS).find((key) => COMMANDS[key].aliases.includes(name));
}

export function helpText() {
  const rows = Object.values(COMMANDS).map((c) => {
    const alias = c.aliases.length ? `  (${c.aliases.join(', ')})` : '';
    return `  ${c.usage.padEnd(18)}${c.summary}${alias}`;
  });
  return `ghostget ${VERSION}: install Microsoft Store apps without signing in

Usage
  ghostget <command> [options]

Commands
${rows.join('\n')}

<app> is a Store product id (9N8CJ4W95TBZ), a Store URL, or a name to search for.
A name that matches several apps is never guessed: you pick one, or pass the id.

Options
  -n, --limit <1-20>   search: how many results (default 10)
  -e, --exact          require an exact name match
      --dry-run        install: show what would happen, change nothing
      --wait           install: wait until the app shows up as installed (Store packages)
      --timeout <min>  install: how long --wait may take (default 10)
  -f, --force          install: proceed for paid apps, already-installed apps, and disabled Store services
      --no-elevate     install: don't ask Windows for permission (UAC) to fix a Disabled Store service
      --no-verify      skip the Microsoft signature check (not recommended)
  -d, --dir <path>     where to keep the downloaded installer
      --market <CC>    Store market, e.g. US or TR (default: from your system)
      --locale <tag>   language, e.g. en-US or tr-TR
      --json           machine-readable output
      --no-color       plain output (also honours NO_COLOR)
      --verbose        debug output and stack traces
  -h, --help           show this help
  -v, --version        show the version

Examples
  ghostget search chatgpt
  ghostget install 9N8CJ4W95TBZ
  ghostget install "visual studio code" --dry-run
  ghostget url 9N8CJ4W95TBZ | clip
  npx ghostget doctor

Exit codes: 0 ok, 1 error, 2 usage, 3 not found, 4 ambiguous, 5 network, 6 needs Windows, 7 signature, 8 paid app.
Docs: https://github.com/SkyLostTR/ghostget`;
}

/**
 * Run the CLI. Never calls process.exit: the caller sets the exit code from the return value.
 * @param {string[]} argv Arguments without `node` and the script path.
 * @param {{ stdin?: any, stdout?: any, stderr?: any, env?: NodeJS.ProcessEnv }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;

  // Until we know the command, errors and help use a plain UI.
  let ui = createUi({ stdout, stderr, env });
  let json = false;
  let verbose = false;
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    json = Boolean(values.json);
    verbose = Boolean(values.verbose);

    if (values.version) {
      stdout.write(`${VERSION}\n`);
      return EXIT.OK;
    }
    const [name, ...args] = positionals;
    if (values.help || !name || name === 'help') {
      const target = name === 'help' ? args[0] : undefined;
      stdout.write(`${target && findCommand(target) ? commandHelp(/** @type {string} */ (findCommand(target))) : helpText()}\n`);
      return EXIT.OK;
    }
    if (name === 'version') {
      stdout.write(`${VERSION}\n`);
      return EXIT.OK;
    }

    const command = findCommand(name);
    if (!command) {
      throw new GhostgetError(`Unknown command "${name}".`, { code: 'E_USAGE', exitCode: EXIT.USAGE, hint: 'Run ghostget --help to see the commands.' });
    }
    const spec = COMMANDS[command];
    for (const key of Object.keys(values)) {
      if (!GLOBAL.includes(key) && !spec.options.includes(key)) {
        throw new GhostgetError(`--${key} does not apply to "${command}".`, { code: 'E_USAGE', exitCode: EXIT.USAGE, hint: `Run ghostget help ${command}` });
      }
    }

    ui = createUi({
      stdout,
      stderr,
      env,
      json,
      verbose,
      color: values['no-color'] ? false : undefined,
      statusToStderr: spec.statusToStderr,
    });
    return await spec.run({ command, ui, values, args, env, io: { stdin, stdout, stderr } });
  } catch (err) {
    return reportError(err, ui, { json, verbose, stderr });
  }
}

/** @param {string} command */
function commandHelp(command) {
  const spec = COMMANDS[command];
  const alias = spec.aliases.length ? `\nAliases: ${spec.aliases.join(', ')}` : '';
  const options = spec.options.length ? `\nOptions: ${spec.options.map((o) => `--${o}`).join(' ')}` : '';
  return `ghostget ${spec.usage}\n\n${spec.summary}.${alias}${options}\n\nFull option list: ghostget --help`;
}

/**
 * @param {unknown} err
 * @param {import('./ui.js').Ui} ui
 * @param {{ json: boolean, verbose: boolean, stderr: NodeJS.WritableStream }} flags
 * @returns {number}
 */
function reportError(err, ui, { json, verbose, stderr }) {
  if (err instanceof Error && /** @type {any} */ (err).code?.startsWith?.('ERR_PARSE_ARGS')) {
    err = new GhostgetError(err.message.replace(/\. To specify a positional.*$/, '.'), {
      code: 'E_USAGE',
      exitCode: EXIT.USAGE,
      hint: 'Run ghostget --help to see the options.',
    });
  }
  ui.spinner.stop();
  ui.progress.done();

  if (err instanceof GhostgetError) {
    if (json) {
      stderr.write(`${JSON.stringify({ error: { code: err.code, message: err.message, hint: err.hint ?? null, details: err.details ?? null } })}\n`);
    } else {
      ui.fail(err.message);
      const candidates = err.details?.candidates;
      if (Array.isArray(candidates) && candidates.length) {
        ui.table(
          candidates.slice(0, 10),
          [
            { key: 'name', title: 'Name', flex: true, max: 44 },
            { key: 'id', title: 'Id' },
            { key: 'publisher', title: 'Publisher', max: 24 },
            { key: 'price', title: 'Price', max: 14 },
          ],
          { toStderr: true },
        );
      }
      if (err.hint) ui.hint(err.hint);
      if (verbose && err.cause) ui.hint(`cause: ${err.cause instanceof Error ? err.cause.stack ?? err.cause.message : String(err.cause)}`);
    }
    return err.exitCode;
  }

  const message = err instanceof Error ? err.message : String(err);
  ui.fail(`Unexpected error: ${message}`);
  ui.hint(verbose ? String(err instanceof Error ? err.stack : '') : 'Run again with --verbose for details.');
  return EXIT.ERROR;
}
