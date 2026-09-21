import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { GhostgetError, getProduct, searchStore } from '../src/index.js';
import { startMockStore } from './support/mock-store.js';

let mock;
before(async () => {
  mock = await startMockStore();
});
after(() => mock.close());
beforeEach(() => {
  const fresh = { status: 200 };
  mock.state.requests.length = 0;
  mock.state.storeSearch.status = fresh.status;
  mock.state.manifestSearch.status = fresh.status;
  mock.state.edgeProduct.status = fresh.status;
  mock.state.catalogStatus = 200;
});

const opts = (extra = {}) => ({ endpoints: mock.endpoints, market: 'US', locale: 'en-US', retries: 0, ...extra });
const rejectsWith = (promise, code, exitCode) =>
  assert.rejects(promise, (err) => err instanceof GhostgetError && err.code === code && (exitCode === undefined || err.exitCode === exitCode));

test('search maps the Store cards', async () => {
  const results = await searchStore('music', opts());
  assert.equal(results.length, 3);
  assert.deepEqual(results[0], {
    id: '9NCBCSZSJRSB',
    name: 'Spotify - Music and Podcasts',
    publisher: 'Spotify AB',
    price: 'Free',
    categories: ['Music'],
    rating: 4.3,
    packageFamilyNames: ['SpotifyAB.SpotifyMusic_zpdnekdrzrea0'],
    delivery: 'WindowsUpdate',
  });
});

test('search honours the limit', async () => {
  assert.equal((await searchStore('music', opts({ limit: 2 }))).length, 2);
});

test('search sends market, locale and device family', async () => {
  await searchStore('music', opts({ market: 'TR', locale: 'tr-TR' }));
  const request = mock.state.requests.find((r) => r.startsWith('GET /edge/search'));
  assert.match(request, /query=music/);
  assert.match(request, /market=TR/);
  assert.match(request, /locale=tr-TR/);
  assert.match(request, /deviceFamily=Windows\.Desktop/);
});

test('search falls back to the winget msstore API when the Store search fails', async () => {
  mock.state.storeSearch.status = 500;
  const results = await searchStore('python', opts());
  assert.equal(results.length, 3);
  assert.ok(mock.state.requests.some((r) => r === 'POST /edge/manifestSearch'));
  assert.equal(results[0].price, '');
  assert.equal(results[0].delivery, null);
});

test('search falls back when the Store search finds nothing', async () => {
  const original = mock.state.storeSearch.body;
  mock.state.storeSearch.body = { Payload: { SearchResults: [] } };
  try {
    const results = await searchStore('python', opts());
    assert.equal(results.length, 3);
  } finally {
    mock.state.storeSearch.body = original;
  }
});

test('search reports the primary error when both searches fail', async () => {
  mock.state.storeSearch.status = 503;
  mock.state.manifestSearch.status = 500;
  await rejectsWith(searchStore('music', opts()), 'E_HTTP', 5);
});

test('search returns an empty list when nothing matches, even if the fallback errors', async () => {
  const original = mock.state.storeSearch.body;
  mock.state.storeSearch.body = { Payload: { SearchResults: [] } };
  mock.state.manifestSearch.status = 500;
  try {
    assert.deepEqual(await searchStore('zzz', opts()), []);
  } finally {
    mock.state.storeSearch.body = original;
  }
});

test('search rejects an empty query', async () => {
  await rejectsWith(searchStore('   ', opts()), 'E_USAGE', 2);
});

test('searching for an id returns that one product', async () => {
  const results = await searchStore('9N8CJ4W95TBZ', opts());
  assert.equal(results.length, 1);
  assert.equal(results[0].id, '9N8CJ4W95TBZ');
  assert.equal(results[0].price, 'Free');
});

test('getProduct normalises a free app', async () => {
  const p = await getProduct('9n8cj4w95tbz', opts());
  assert.equal(p.id, '9N8CJ4W95TBZ');
  assert.equal(p.name, 'ChatGPT (Beta)');
  assert.equal(p.publisher, 'OpenAI');
  assert.deepEqual(p.price, { amount: 0, currency: 'USD', free: true });
  assert.equal(p.version, '26.727.4816.0');
  assert.equal(p.packageFamilyName, 'OpenAI.CodexBeta_2p2nqsd0c76g0');
  assert.deepEqual(p.architectures.sort(), ['arm64', 'x64']);
  assert.ok(p.downloadSize > 0);
  assert.equal(p.delivery, 'WindowsUpdate');
  assert.equal(p.storeUrl, 'https://apps.microsoft.com/detail/9n8cj4w95tbz?hl=en-US&gl=US');
  assert.equal(p.market, 'US');
});

test('getProduct reads the price from the availability that can be purchased', async () => {
  const p = await getProduct('9PGLL77C201J', opts());
  // Other availabilities of this product list a price of 0; only the "Purchase" one is the real price.
  assert.deepEqual(p.price, { amount: 59.99, currency: 'USD', free: false });
  assert.equal(p.kind, 'Game');
});

test('getProduct still works when the delivery lookup fails', async () => {
  mock.state.edgeProduct.status = 500;
  const p = await getProduct('9N8CJ4W95TBZ', opts());
  assert.equal(p.delivery, null);
  assert.equal(p.name, 'ChatGPT (Beta)');
});

test('getProduct says so when the product does not exist', async () => {
  await rejectsWith(getProduct('9ZZZZZZZZZZZ', opts()), 'E_NOT_FOUND', 3);
});

test('getProduct refuses input that is not an id', async () => {
  await rejectsWith(getProduct('chatgpt', opts()), 'E_USAGE', 2);
});

test('getProduct surfaces a catalog outage as a network error', async () => {
  mock.state.catalogStatus = 500;
  await rejectsWith(getProduct('9N8CJ4W95TBZ', opts()), 'E_HTTP', 5);
});

test('getProduct falls back to the Store product API for Win32 apps (XP ids)', async () => {
  // The display catalog knows none of the XP... ids; only the Store's own product API does.
  const p = await getProduct('XP9KHM4BK9FZ7Q', opts());
  assert.equal(p.name, 'Visual Studio Code');
  assert.equal(p.publisher, 'Microsoft Corporation');
  assert.equal(p.delivery, 'WPM');
  assert.deepEqual(p.price, { amount: 0, currency: null, free: true });
  assert.deepEqual(p.architectures, ['x64', 'arm64']);
  assert.deepEqual(p.packageFamilyNames, []);
  assert.equal(p.kind, 'Application');
  assert.equal(p.website, 'https://code.visualstudio.com/');
  assert.equal(p.storeUrl, 'https://apps.microsoft.com/detail/xp9khm4bk9fz7q?hl=en-US&gl=US');
});

test('a paid Win32 app is not mistaken for a free one just because its numeric price is 0', async () => {
  const p = await getProduct('XPFD4T9N395QN6', opts());
  assert.equal(p.name, 'Adobe Photoshop');
  assert.deepEqual(p.price, { amount: null, currency: null, free: false });
});

test('an unfamiliar price label leaves free/paid unknown instead of guessing', async () => {
  const base = mock.state.edgeProducts.XP9KHM4BK9FZ7Q.Payload;
  mock.state.edgeProducts.XPTESTINCLUDE0 = { Payload: { ...base, ProductId: 'XPTESTINCLUDE0', DisplayPrice: 'Included', Price: 0 } };
  try {
    assert.equal((await getProduct('XPTESTINCLUDE0', opts())).price.free, null);
  } finally {
    delete mock.state.edgeProducts.XPTESTINCLUDE0;
  }
});

test('a positive numeric price on a Win32 app counts as paid and keeps the amount', async () => {
  const base = mock.state.edgeProducts.XP9KHM4BK9FZ7Q.Payload;
  mock.state.edgeProducts.XPTESTPRICED00 = { Payload: { ...base, ProductId: 'XPTESTPRICED00', DisplayPrice: '$9.99', Price: 9.99 } };
  try {
    const p = await getProduct('XPTESTPRICED00', opts());
    assert.deepEqual(p.price, { amount: 9.99, currency: null, free: false });
  } finally {
    delete mock.state.edgeProducts.XPTESTPRICED00;
  }
});

test('the Store product API is asked in English whatever the user language, so "Paid" is recognisable', async () => {
  await getProduct('XPFD4T9N395QN6', opts({ market: 'TR', locale: 'tr-TR' }));
  const request = mock.state.requests.find((r) => r.startsWith('GET /edge/products/XPFD4T9N395QN6'));
  assert.match(request, /locale=en-US/);
  assert.match(request, /market=TR/);
});

test('when the display catalog is down, the Store product API still answers', async () => {
  mock.state.catalogStatus = 500;
  assert.equal((await getProduct('XP9KHM4BK9FZ7Q', opts())).name, 'Visual Studio Code');
});
