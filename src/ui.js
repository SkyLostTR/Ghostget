// @ts-check

/**
 * Small terminal toolkit: colour, symbols, tables, spinner and progress bar. No dependencies.
 * Data goes to stdout; progress, warnings and errors go to stderr so pipes stay clean.
 */

const STYLES = /** @type {const} */ ({
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  cyan: [36, 39],
  gray: [90, 39],
});

/** @typedef {Record<keyof typeof STYLES, (text: unknown) => string>} Styler */

/**
 * @param {boolean} enabled
 * @returns {Styler}
 */
export function createStyler(enabled) {
  /** @param {keyof typeof STYLES} name */
  const make = (name) => (/** @type {unknown} */ text) => (enabled ? `\x1b[${STYLES[name][0]}m${text}\x1b[${STYLES[name][1]}m` : String(text));
  return { bold: make('bold'), dim: make('dim'), red: make('red'), green: make('green'), yellow: make('yellow'), cyan: make('cyan'), gray: make('gray') };
}

/**
 * @param {{ isTTY?: boolean }|undefined} stream
 * @param {NodeJS.ProcessEnv} env
 */
export function supportsColor(stream, env) {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') return true;
  if (env.TERM === 'dumb') return false;
  return Boolean(stream?.isTTY);
}

/**
 * Legacy Windows consoles render many Unicode symbols as boxes, so fall back to ASCII there.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [platform]
 */
export function supportsUnicode(env, platform = process.platform) {
  if (platform !== 'win32') return env.TERM !== 'linux';
  return Boolean(env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuTask || env.TERM === 'xterm-256color');
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/**
 * @param {string} text
 * @param {number} max
 * @param {string} [ellipsis]
 */
export function truncate(text, max, ellipsis = '…') {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - ellipsis.length))}${ellipsis}`;
}

/**
 * Word-wrap `text` to `width` columns, keeping paragraph breaks.
 * @param {string} text
 * @param {number} width
 * @param {string} [indent]
 */
export function wrap(text, width, indent = '') {
  const lines = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(indent + line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line ? indent + line : '');
  }
  // Trim blank lines around the block but keep the first line's indent.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
}

/**
 * @typedef {object} Column
 * @property {string} key
 * @property {string} title
 * @property {number} [max] Longest cell before truncating.
 * @property {boolean} [flex] Shrinks first when the table is wider than the terminal.
 */

/**
 * Plain-text table with a header rule, like `winget search`.
 * @param {Record<string, unknown>[]} rows
 * @param {Column[]} columns
 * @param {{ width?: number, style: Styler, ellipsis?: string }} opts
 * @returns {string[]}
 */
export function renderTable(rows, columns, { width = 100, style, ellipsis = '…' }) {
  const cell = (/** @type {Record<string, unknown>} */ row, /** @type {Column} */ col) => String(row[col.key] ?? '').replace(/\s+/g, ' ');
  const widths = columns.map((col) => {
    const longest = Math.max(col.title.length, ...rows.map((row) => cell(row, col).length));
    return col.max ? Math.min(longest, col.max) : longest;
  });
  const gap = 2;
  const total = () => widths.reduce((a, b) => a + b, 0) + gap * (columns.length - 1);
  const flexIndex = columns.findIndex((c) => c.flex);
  if (flexIndex >= 0 && total() > width) {
    widths[flexIndex] = Math.max(columns[flexIndex].title.length, 16, widths[flexIndex] - (total() - width));
  }
  const pad = (/** @type {string} */ s, /** @type {number} */ w) => truncate(s, w, ellipsis).padEnd(w);
  const header = columns.map((c, i) => pad(c.title, widths[i])).join(' '.repeat(gap)).trimEnd();
  const rule = '-'.repeat(Math.min(total(), width));
  const body = rows.map((row) => columns.map((c, i) => pad(cell(row, c), widths[i])).join(' '.repeat(gap)).trimEnd());
  return [style.bold(header), rule, ...body];
}

/**
 * @typedef {object} Io
 * @property {NodeJS.WritableStream & { isTTY?: boolean, columns?: number }} stdout
 * @property {NodeJS.WritableStream & { isTTY?: boolean, columns?: number }} stderr
 * @property {NodeJS.ProcessEnv} env
 */

/**
 * @param {Io & { json?: boolean, color?: boolean, verbose?: boolean, statusToStderr?: boolean }} opts
 */
export function createUi({ stdout, stderr, env, json = false, color, verbose = false, statusToStderr = false }) {
  const status = statusToStderr ? stderr : stdout;
  const style = createStyler(color ?? supportsColor(status, env));
  const unicode = supportsUnicode(env);
  const sym = unicode
    ? { ok: '✔', warn: '⚠', fail: '✖', step: '›', dot: '·', down: '↓', bar: ['█', '░'], ellipsis: '…', spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] }
    : { ok: '+', warn: '!', fail: 'x', step: '>', dot: '-', down: 'v', bar: ['#', '-'], ellipsis: '...', spinner: ['-', '\\', '|', '/'] };
  const live = Boolean(stderr.isTTY) && !json;
  const CLEAR = '\r\x1b[K';

  /** @type {ReturnType<typeof setInterval>|null} */
  let timer = null;
  let spinnerText = '';
  let frame = 0;
  let barShown = false;
  let lastBar = 0;

  const drawSpinner = () => stderr.write(`${CLEAR}${style.cyan(sym.spinner[frame++ % sym.spinner.length])} ${spinnerText}`);
  const clearLive = () => {
    if (timer || barShown) stderr.write(CLEAR);
    barShown = false;
  };

  /** @param {NodeJS.WritableStream} stream @param {string} text */
  const write = (stream, text) => {
    clearLive();
    stream.write(`${text}\n`);
  };

  const spinner = {
    /** @param {string} text */
    start(text) {
      spinnerText = text;
      if (!live) return;
      if (!timer) timer = setInterval(drawSpinner, 80);
      drawSpinner();
    },
    /** @param {string} text */
    update(text) {
      spinnerText = text;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (live) stderr.write(CLEAR);
    },
  };

  return {
    style,
    sym,
    isJson: json,
    spinner,

    /** Data for the caller: always stdout. */
    /** @param {string} [text] */
    print: (text = '') => write(stdout, text),
    /** @param {unknown} value */
    json: (value) => write(stdout, JSON.stringify(value, null, 2)),

    /** Human status text: hidden in --json mode. */
    /** @param {string} text */
    info: (text) => {
      if (!json) write(status, text);
    },
    /** @param {string} text */
    ok: (text) => {
      if (!json) write(status, `${style.green(sym.ok)} ${text}`);
    },
    /** @param {string} text */
    step: (text) => {
      if (!json) write(status, `${style.cyan(sym.step)} ${text}`);
    },
    /** @param {string} text */
    warn: (text) => write(stderr, `${style.yellow(sym.warn)} ${text}`),
    /** @param {string} text */
    fail: (text) => write(stderr, `${style.red(sym.fail)} ${text}`),
    /** @param {string} text */
    hint: (text) => write(stderr, `  ${style.dim(text)}`),
    /** @param {string} text */
    debug: (text) => {
      if (verbose) write(stderr, style.gray(`  [debug] ${text}`));
    },

    /**
     * @param {Record<string, unknown>[]} rows
     * @param {Column[]} columns
     * @param {{ toStderr?: boolean }} [opts]
     */
    table(rows, columns, { toStderr = false } = {}) {
      const stream = toStderr ? stderr : stdout;
      const width = (stream.columns ?? 100) - 1;
      for (const line of renderTable(rows, columns, { width, style, ellipsis: sym.ellipsis })) write(stream, line);
    },

    /**
     * Run `fn` while showing a spinner (TTY only).
     * @template T
     * @param {string} text
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async task(text, fn) {
      spinner.start(text);
      try {
        return await fn();
      } finally {
        spinner.stop();
      }
    },

    progress: {
      /**
       * @param {string} label
       * @param {number} received
       * @param {number|null} total
       */
      update(label, received, total) {
        if (!live) return;
        const now = Date.now();
        if (now - lastBar < 80 && received !== total) return;
        lastBar = now;
        const barWidth = 24;
        const ratio = total ? Math.min(1, received / total) : 0;
        const filled = Math.round(ratio * barWidth);
        const bar = sym.bar[0].repeat(filled) + sym.bar[1].repeat(barWidth - filled);
        const pct = total ? `${Math.floor(ratio * 100)}%`.padStart(4) : '';
        const size = total ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received);
        stderr.write(`${CLEAR}${style.cyan(sym.down)} ${label} ${style.cyan(bar)} ${pct} ${style.dim(size)}`);
        barShown = true;
      },
      done() {
        if (barShown) stderr.write(CLEAR);
        barShown = false;
      },
    },
  };
}

/** @typedef {ReturnType<typeof createUi>} Ui */
