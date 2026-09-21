import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStyler, formatBytes, renderTable, supportsColor, supportsUnicode, truncate, wrap } from '../src/ui.js';

const plain = createStyler(false);

test('formats byte sizes the way installers are usually described', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(815_136), '796 KB');
  assert.equal(formatBytes(759_383_899), '724 MB');
  assert.equal(formatBytes(5 * 1024 ** 3), '5.0 GB');
  assert.equal(formatBytes(Number.NaN), '');
});

test('truncate shortens with an ellipsis and leaves short text alone', () => {
  assert.equal(truncate('hello', 10), 'hello');
  assert.equal(truncate('hello world', 6), 'hello…');
  assert.equal(truncate('hello world', 6, '...'), 'hel...');
});

test('wrap breaks long text at word boundaries and keeps paragraphs', () => {
  assert.equal(wrap('one two three four', 9), 'one two\nthree\nfour');
  assert.equal(wrap('a\n\nb', 20), 'a\n\nb');
  assert.equal(wrap('a b', 20, '  '), '  a b');
});

test('renders a table with a rule and aligned columns', () => {
  const lines = renderTable(
    [
      { name: 'Alpha', id: '1' },
      { name: 'Be', id: '22' },
    ],
    [
      { key: 'name', title: 'Name' },
      { key: 'id', title: 'Id' },
    ],
    { style: plain },
  );
  assert.deepEqual(lines, ['Name   Id', '---------', 'Alpha  1', 'Be     22']);
});

test('shrinks the flexible column to fit the terminal', () => {
  const long = 'x'.repeat(80);
  const lines = renderTable(
    [{ name: long, id: '9N8CJ4W95TBZ' }],
    [
      { key: 'name', title: 'Name', flex: true },
      { key: 'id', title: 'Id' },
    ],
    { width: 40, style: plain },
  );
  for (const line of lines) assert.ok(line.length <= 40, `line too wide: ${line.length}`);
  assert.match(lines[2], /…/);
  assert.match(lines[2], /9N8CJ4W95TBZ$/, 'the id column is never cut');
});

test('colour is off for NO_COLOR and non-terminals, on for FORCE_COLOR', () => {
  assert.equal(supportsColor({ isTTY: true }, {}), true);
  assert.equal(supportsColor({ isTTY: false }, {}), false);
  assert.equal(supportsColor({ isTTY: true }, { NO_COLOR: '1' }), false);
  assert.equal(supportsColor({ isTTY: false }, { FORCE_COLOR: '1' }), true);
  assert.equal(supportsColor({ isTTY: true }, { TERM: 'dumb' }), false);
});

test('legacy Windows consoles get ASCII symbols, modern terminals get Unicode', () => {
  assert.equal(supportsUnicode({}, 'win32'), false);
  assert.equal(supportsUnicode({ WT_SESSION: 'x' }, 'win32'), true);
  assert.equal(supportsUnicode({ TERM: 'xterm-256color' }, 'linux'), true);
  assert.equal(supportsUnicode({ TERM: 'linux' }, 'linux'), false);
});

test('styling wraps text in ANSI codes only when enabled', () => {
  assert.equal(createStyler(true).green('ok'), '\x1b[32mok\x1b[39m');
  assert.equal(createStyler(false).green('ok'), 'ok');
});
