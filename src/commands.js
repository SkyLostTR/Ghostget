// @ts-check
import readline from 'node:readline/promises';
import { searchStore } from './catalog.js';
import { runDiagnostics } from './diagnostics.js';
import { EXIT, usageError } from './errors.js';
import { assertTrustedInstaller, buildInstallerUrl, downloadInstaller, installApp } from './installer.js';
import { resolveProduct } from './resolve.js';
import { formatBytes, wrap } from './ui.js';
import { hostArch } from './util.js';
import { assertWindows, getInstalledPackages, isWindows } from './windows.js';

/**
 * @typedef {object} Context
 * @property {string} command Canonical command name.
 * @property {import('./ui.js').Ui} ui
 * @property {Record<string, any>} values Parsed options.
 * @property {string[]} args Positionals after the command name.
 * @property {NodeJS.ProcessEnv} env
 * @property {{ stdin: NodeJS.ReadableStream & { isTTY?: boolean }, stdout: NodeJS.WritableStream & { columns?: number }, stderr: NodeJS.WritableStream & { isTTY?: boolean } }} io
 */

/** @param {string} subject */
const commonName = (subject) => /CN=([^,]+)/.exec(subject)?.[1] ?? subject;

/** @param {Context} ctx */
function catalogOptions(ctx) {
  return { market: ctx.values.market, locale: ctx.values.locale, env: ctx.env, onDebug: ctx.ui.debug };
}

/** @param {Context} ctx */
function targetOf(ctx) {
  const target = ctx.args.join(' ').trim();
  if (!target) {
    throw usageError('Which app? Pass a Store id, a Store URL or a name.', `ghostget ${ctx.command} <app>   e.g. ghostget ${ctx.command} 9N8CJ4W95TBZ`);
  }
  return target;
}

/** @param {Context} ctx */
function parseLimit(ctx) {
  const raw = ctx.values.limit;
  if (raw === undefined) return 10;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw usageError('--limit must be a whole number from 1 to 20.');
  return n;
}

/**
 * When a name matches several apps and we are in a terminal, let the user pick.
 * Otherwise ghostget fails with the candidate list instead of guessing.
 * @param {Context} ctx
 */
function chooser(ctx) {
  if (!ctx.io.stdin.isTTY || !ctx.io.stderr.isTTY || ctx.ui.isJson) return undefined;
  return async (/** @type {import('./catalog.js').SearchResult[]} */ candidates) => {
    const { ui } = ctx;
    ui.spinner.stop();
    const shown = candidates.slice(0, 10);
    ui.warn(`More than one app matches. Which one?`);
    ui.table(
      shown.map((c, i) => ({ n: String(i + 1), name: c.name, id: c.id, publisher: c.publisher, price: c.price })),
      [
        { key: 'n', title: '#' },
        { key: 'name', title: 'Name', flex: true, max: 44 },
        { key: 'id', title: 'Id' },
        { key: 'publisher', title: 'Publisher', max: 24 },
        { key: 'price', title: 'Price', max: 14 },
      ],
      { toStderr: true },
    );
    const rl = readline.createInterface({ input: ctx.io.stdin, output: ctx.io.stderr });
    const closed = new Promise((resolve) => rl.once('close', () => resolve(null)));
    try {
      for (;;) {
        const answer = await Promise.race([rl.question(`Pick 1-${shown.length}, or q to cancel: `), closed]);
        if (answer === null || String(answer).trim().toLowerCase() === 'q' || String(answer).trim() === '') return null;
        const n = Number(answer);
        if (Number.isInteger(n) && n >= 1 && n <= shown.length) return shown[n - 1];
      }
    } finally {
      rl.close();
    }
  };
}

/** @param {Context} ctx */
export async function searchCommand(ctx) {
  const { ui, values } = ctx;
  const query = ctx.args.join(' ').trim();
  if (!query) throw usageError('What should I search for?', 'ghostget search <query>');
  const results = await ui.task(`Searching the Microsoft Store for "${query}"`, () =>
    searchStore(query, { ...catalogOptions(ctx), limit: parseLimit(ctx) }),
  );
  if (values.json) {
    ui.json(results);
    return results.length ? EXIT.OK : EXIT.NOT_FOUND;
  }
  if (!results.length) {
    ui.info(`No apps found for "${query}".`);
    return EXIT.NOT_FOUND;
  }
  ui.table(results, [
    { key: 'name', title: 'Name', flex: true, max: 48 },
    { key: 'id', title: 'Id' },
    { key: 'publisher', title: 'Publisher', max: 26 },
    { key: 'price', title: 'Price', max: 16 },
  ]);
  ui.info(ui.style.dim('\nInstall one with: ghostget install <Id>'));
  return EXIT.OK;
}

/** @param {Context} ctx */
export async function showCommand(ctx) {
  const { ui, values, env } = ctx;
  const resolved = await ui.task('Looking up the app', () =>
    resolveProduct(targetOf(ctx), { ...catalogOptions(ctx), details: 'always', exact: values.exact, choose: chooser(ctx) }),
  );
  const product = /** @type {import('./catalog.js').Product} */ (resolved.product);
  const installerUrl = buildInstallerUrl(product.id, { campaignId: values.cid, env });
  if (values.json) {
    ui.json({ ...product, installerUrl });
    return EXIT.OK;
  }

  const { style } = ui;
  const money = product.price.free ? 'Free' : product.price.amount === null ? 'unknown' : `${product.price.amount} ${product.price.currency ?? ''}`.trim();
  /** @type {[string, string|null|undefined][]} */
  const fields = [
    ['Publisher', product.publisher],
    ['Category', product.category],
    ['Price', money],
    ['Version', product.version],
    ['Package size', product.downloadSize ? `${formatBytes(product.downloadSize)} (${hostArch()})` : null],
    ['Architectures', product.architectures.join(', ')],
    ['Delivery', product.delivery],
    ['Rating', product.rating.average === null ? null : `${product.rating.average}${product.rating.count ? ` (${product.rating.count} ratings)` : ''}`],
    ['Min. age', product.minAge ? String(product.minAge) : null],
    ['Released', product.releasedAt?.slice(0, 10)],
    ['Package family', product.packageFamilyName],
    ['Website', product.website],
    ['Store page', product.storeUrl],
    ['Installer', installerUrl],
  ];
  ui.print(`${style.bold(product.name)} ${style.dim(`[${product.id}]`)}`);
  for (const [label, value] of fields) if (value) ui.print(`${style.dim(label.padEnd(16))}${value}`);
  if (product.description) {
    const text = product.description.length > 1200 ? `${product.description.slice(0, 1200)}...` : product.description;
    ui.print(`\n${wrap(text, Math.min(100, (ctx.io.stdout.columns ?? 100) - 1))}`);
  }
  return EXIT.OK;
}

/** @param {Context} ctx */
export async function installCommand(ctx) {
  const { ui, values, env } = ctx;
  const target = targetOf(ctx);
  const { style, sym } = ui;
  const timeoutMinutes = values.timeout === undefined ? 10 : Number(values.timeout);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) throw usageError('--timeout must be a positive number of minutes.');

  ui.spinner.start('Looking up the app');
  let label = 'installer';
  /** @type {import('./installer.js').InstallResult} */
  let result;
  try {
    result = await installApp(target, {
      ...catalogOptions(ctx),
      campaignId: values.cid,
      dryRun: values['dry-run'],
      noVerify: values['no-verify'],
      force: values.force,
      wait: values.wait,
      waitTimeoutMs: timeoutMinutes * 60_000,
      exact: values.exact,
      dir: values.dir,
      choose: chooser(ctx),
      onEvent(event) {
        switch (event.type) {
          case 'resolved': {
            const p = event.product;
            const price = p ? (p.price.free ? 'Free' : p.price.amount === null ? '' : `${p.price.amount} ${p.price.currency ?? ''}`.trim()) : '';
            ui.ok(`Found ${style.bold(event.name)} ${style.dim(`[${event.id}]`)}${p?.publisher ? ` ${sym.dot} ${p.publisher}` : ''}${price ? ` ${sym.dot} ${price}` : ''}`);
            ui.spinner.update('Checking this PC');
            break;
          }
          case 'warning':
            ui.warn(event.message);
            break;
          case 'download-start':
            ui.spinner.stop();
            ui.step('Downloading the Microsoft Store installer');
            break;
          case 'progress':
            ui.progress.update(label, event.received, event.total);
            break;
          case 'downloaded':
            ui.progress.done();
            label = event.file.fileName;
            ui.ok(`Downloaded ${event.file.fileName} (${formatBytes(event.file.size)}) ${sym.dot} sha256 ${event.file.sha256.slice(0, 16)}...`);
            ui.spinner.start('Verifying the signature');
            break;
          case 'verified':
            ui.ok(`Signature valid: ${commonName(event.subject)}`);
            ui.spinner.update('Launching the installer');
            break;
          case 'launched':
            ui.spinner.stop();
            ui.ok('Launched the installer');
            break;
          case 'waiting':
            ui.step('Waiting for the Store to finish (Ctrl+C stops waiting, not the install)');
            ui.spinner.start('Installing');
            break;
        }
      },
    });
  } finally {
    ui.spinner.stop();
    ui.progress.done();
  }

  if (values.json) {
    ui.json({
      status: result.status,
      id: result.id,
      name: result.name,
      installerUrl: result.installerUrl,
      installedVersion: result.installedVersion ?? null,
      signer: result.signer ?? null,
      file: result.file ? { path: result.file.path, size: result.file.size, sha256: result.file.sha256 } : null,
    });
  }

  switch (result.status) {
    case 'dry-run':
      ui.ok('Dry run: nothing was downloaded or launched.');
      ui.info(`  Installer  ${result.installerUrl}`);
      ui.info('  Steps      download, verify the Microsoft signature, launch the Store installer');
      return EXIT.OK;
    case 'already-installed':
      ui.ok(`${result.name} is already installed (version ${result.installedVersion}). Use --force to run the Store installer anyway.`);
      return EXIT.OK;
    case 'installed':
      ui.ok(`${style.bold(result.name)} is installed (version ${result.installedVersion}).`);
      return EXIT.OK;
    case 'wait-timeout':
      ui.warn(`${result.name} did not show up as installed within ${timeoutMinutes} min. The Store window may still be working.`);
      return EXIT.ERROR;
    default:
      ui.info(`  Finish the install in the Microsoft Store window that just opened.${values.wait ? '' : style.dim(' (Add --wait to let ghostget wait for it.)')}`);
      return EXIT.OK;
  }
}

/** @param {Context} ctx */
export async function downloadCommand(ctx) {
  const { ui, values, env } = ctx;
  const resolved = await ui.task('Looking up the app', () =>
    resolveProduct(targetOf(ctx), { ...catalogOptions(ctx), details: 'never', exact: values.exact, choose: chooser(ctx) }),
  );
  const name = resolved.candidate?.name ?? resolved.id;
  ui.step(`Downloading the Store installer for ${name} [${resolved.id}]`);
  let label = 'installer';
  const file = await downloadInstaller(resolved.id, {
    dir: values.dir,
    campaignId: values.cid,
    env,
    onProgress: (p) => ui.progress.update(label, p.received, p.total),
  });
  label = file.fileName;
  ui.progress.done();
  ui.ok(`Saved ${file.fileName} (${formatBytes(file.size)}) ${ui.sym.dot} sha256 ${file.sha256}`);

  /** @type {string|null} */
  let signer = null;
  if (values['no-verify']) {
    ui.warn('Skipped the signature check (--no-verify).');
  } else if (isWindows()) {
    signer = commonName((await assertTrustedInstaller(file.path)).subject);
    ui.ok(`Signature valid: ${signer}`);
  } else {
    ui.warn('The signature was not checked: that needs Windows. Check it there before running the file.');
  }

  if (values.json) ui.json({ id: file.id, url: file.url, path: file.path, size: file.size, sha256: file.sha256, signer });
  else ui.print(file.path);
  return EXIT.OK;
}

/** @param {Context} ctx */
export async function urlCommand(ctx) {
  const { ui, values, env } = ctx;
  const resolved = await ui.task('Looking up the app', () =>
    resolveProduct(targetOf(ctx), { ...catalogOptions(ctx), details: 'never', exact: values.exact, choose: chooser(ctx) }),
  );
  const url = buildInstallerUrl(resolved.id, { campaignId: values.cid, env });
  if (values.json) ui.json({ id: resolved.id, name: resolved.candidate?.name ?? null, url });
  else ui.print(url);
  return EXIT.OK;
}

/** @param {Context} ctx */
export async function listCommand(ctx) {
  const { ui, values } = ctx;
  assertWindows('Listing installed Store apps');
  const filter = ctx.args.join(' ').trim();
  const apps = await ui.task('Reading installed apps', () => getInstalledPackages({ filter }));
  if (values.json) {
    ui.json(apps);
  } else if (!apps.length) {
    ui.info(filter ? `No installed Store apps match "${filter}".` : 'No Store apps are installed.');
  } else {
    ui.table(
      apps.map((a) => ({ ...a, publisher: commonName(a.publisher) })),
      [
        { key: 'name', title: 'Name', flex: true, max: 52 },
        { key: 'version', title: 'Version' },
        { key: 'publisher', title: 'Publisher', max: 28 },
      ],
    );
    ui.info(ui.style.dim(`\n${apps.length} installed Store app${apps.length === 1 ? '' : 's'}.`));
  }
  return filter && !apps.length ? EXIT.NOT_FOUND : EXIT.OK;
}

/** @param {Context} ctx */
export async function doctorCommand(ctx) {
  const { ui, values, env } = ctx;
  const report = await ui.task('Checking this PC', () => runDiagnostics({ env }));
  if (values.json) {
    ui.json(report);
    return report.ok ? EXIT.OK : EXIT.ERROR;
  }
  const { style, sym } = ui;
  const s = report.system;
  ui.print(style.bold(`ghostget ${s.ghostget}`) + style.dim(` ${sym.dot} Node ${s.node} ${sym.dot} ${s.platform} ${s.arch}${s.windows ? ` ${sym.dot} ${s.windows}` : ''}`));
  ui.print('');
  const width = Math.max(...report.checks.map((c) => c.label.length));
  const mark = { ok: style.green(sym.ok), warn: style.yellow(sym.warn), fail: style.red(sym.fail), skip: style.gray('-') };
  for (const c of report.checks) ui.print(`${mark[c.status]} ${c.label.padEnd(width)}  ${c.status === 'ok' ? style.dim(c.detail) : c.detail}`);

  const fixes = report.checks.filter((c) => c.fix);
  if (fixes.length) {
    ui.print(`\n${style.bold('Suggested fixes')} ${style.dim('(PowerShell as Administrator; ghostget never changes settings itself)')}`);
    for (const c of fixes) ui.print(`  ${c.fix}`);
  }
  ui.print(`\n${report.ok ? style.green('No blocking problems found.') : style.red('Something needs attention.')}`);
  return report.ok ? EXIT.OK : EXIT.ERROR;
}
