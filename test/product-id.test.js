import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractProductId } from '../src/index.js';

test('accepts 12-character 9... ids and normalises case', () => {
  assert.equal(extractProductId('9N8CJ4W95TBZ'), '9N8CJ4W95TBZ');
  assert.equal(extractProductId('  9n8cj4w95tbz  '), '9N8CJ4W95TBZ');
});

test('accepts 14-character XP... ids (Win32 apps such as VS Code)', () => {
  assert.equal(extractProductId('XP9KHM4BK9FZ7Q'), 'XP9KHM4BK9FZ7Q');
  assert.equal(extractProductId('xp9khm4bk9fz7q'), 'XP9KHM4BK9FZ7Q');
});

test('pulls the id out of Store URLs', () => {
  const id = '9N8CJ4W95TBZ';
  assert.equal(extractProductId('https://apps.microsoft.com/detail/9n8cj4w95tbz?hl=en-US&gl=US'), id);
  assert.equal(extractProductId('https://apps.microsoft.com/store/detail/chatgpt/9N8CJ4W95TBZ'), id);
  assert.equal(extractProductId('https://www.microsoft.com/store/productId/9N8CJ4W95TBZ'), id);
  assert.equal(extractProductId('https://www.microsoft.com/en-us/p/some-app/9n8cj4w95tbz?activetab=pivot:overviewtab'), id);
  assert.equal(extractProductId('apps.microsoft.com/detail/9n8cj4w95tbz'), id);
});

test('pulls the id out of ms-windows-store links', () => {
  assert.equal(extractProductId('ms-windows-store://pdp/?productid=9N8CJ4W95TBZ'), '9N8CJ4W95TBZ');
  assert.equal(extractProductId('ms-windows-store://pdp/?ProductId=9n8cj4w95tbz&mode=mini'), '9N8CJ4W95TBZ');
});

test('treats anything else as a search term', () => {
  for (const text of ['chatgpt', 'visual studio code', '9N8CJ4W95TB', '9N8CJ4W95TBZZ', 'ABCDEFGHIJKL', '', '   ', null, undefined]) {
    assert.equal(extractProductId(text), null, `expected null for ${JSON.stringify(text)}`);
  }
});

test('ignores URLs that carry no product id', () => {
  assert.equal(extractProductId('https://apps.microsoft.com/search?query=chatgpt'), null);
  assert.equal(extractProductId('https://example.com/nothing'), null);
});
