import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { GhostgetError, resolveProduct } from '../src/index.js';
import { startMockStore } from './support/mock-store.js';

let mock;
let threeCards;
before(async () => {
  mock = await startMockStore();
  threeCards = mock.state.storeSearch.body;
});
after(() => mock.close());
beforeEach(() => {
  mock.state.storeSearch.body = threeCards;
  mock.state.manifestSearch.body = { Data: [] };
  mock.state.catalogStatus = 200;
  mock.state.requests.length = 0;
});

const opts = (extra = {}) => ({ endpoints: mock.endpoints, market: 'US', locale: 'en-US', retries: 0, details: 'never', ...extra });
const oneCard = (index) => ({ Payload: { SearchResults: [threeCards.Payload.SearchResults[index]] } });

test('an id is used as-is and its details are loaded', async () => {
  const r = await resolveProduct('9N8CJ4W95TBZ', opts({ details: 'auto' }));
  assert.equal(r.id, '9N8CJ4W95TBZ');
  assert.equal(r.via, 'id');
  assert.equal(r.product?.name, 'ChatGPT (Beta)');
});

test('an id needs no network when details are skipped', async () => {
  const r = await resolveProduct('9N8CJ4W95TBZ', opts());
  assert.equal(r.product, null);
  assert.deepEqual(mock.state.requests, []);
});

test('a Store URL resolves to its id', async () => {
  const r = await resolveProduct('https://apps.microsoft.com/detail/9n8cj4w95tbz?hl=en-US', opts());
  assert.equal(r.id, '9N8CJ4W95TBZ');
});

test('one exact name match wins even when there are other results', async () => {
  const r = await resolveProduct('spotify - music and podcasts', opts());
  assert.equal(r.id, '9NCBCSZSJRSB');
  assert.equal(r.via, 'search');
  assert.equal(r.candidate?.publisher, 'Spotify AB');
});

test('a single result is accepted without an exact name match', async () => {
  mock.state.storeSearch.body = oneCard(1);
  const r = await resolveProduct('apple', opts());
  assert.equal(r.id, threeCards.Payload.SearchResults[1].ProductId);
});

test('several results are never guessed: the error carries the candidates', async () => {
  await assert.rejects(resolveProduct('music', opts()), (err) => {
    assert.ok(err instanceof GhostgetError);
    assert.equal(err.code, 'E_AMBIGUOUS');
    assert.equal(err.exitCode, 4);
    assert.equal(err.details.candidates.length, 3);
    return true;
  });
});

test('a chooser can settle an ambiguous match', async () => {
  let seen;
  const r = await resolveProduct('music', opts({ choose: async (candidates) => ((seen = candidates), candidates[2]) }));
  assert.equal(seen.length, 3);
  assert.equal(r.id, threeCards.Payload.SearchResults[2].ProductId);
});

test('a chooser that cancels stops the install', async () => {
  await assert.rejects(resolveProduct('music', opts({ choose: async () => null })), (err) => err.code === 'E_CANCELLED');
});

test('--exact refuses a near match', async () => {
  mock.state.storeSearch.body = oneCard(0);
  await assert.rejects(resolveProduct('spotify', opts({ exact: true })), (err) => err.code === 'E_NOT_FOUND' && err.exitCode === 3);
});

test('no results is a not-found error', async () => {
  mock.state.storeSearch.body = { Payload: { SearchResults: [] } };
  await assert.rejects(resolveProduct('nothing here', opts()), (err) => err.code === 'E_NOT_FOUND');
});

test('a product that does not exist is an error even for a plain id', async () => {
  await assert.rejects(resolveProduct('9ZZZZZZZZZZZ', opts({ details: 'auto' })), (err) => err.code === 'E_NOT_FOUND');
});

test('a flaky details call only warns, so an install is not blocked', async () => {
  mock.state.catalogStatus = 500;
  const warnings = [];
  const r = await resolveProduct('9N8CJ4W95TBZ', opts({ details: 'auto', onWarn: (m) => warnings.push(m) }));
  assert.equal(r.id, '9N8CJ4W95TBZ');
  assert.equal(r.product, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Continuing without them/);
});

test('details: always turns that same failure into an error', async () => {
  mock.state.catalogStatus = 500;
  await assert.rejects(resolveProduct('9N8CJ4W95TBZ', opts({ details: 'always' })), (err) => err.code === 'E_HTTP');
});

test('an empty target is a usage error', async () => {
  await assert.rejects(resolveProduct('  ', opts()), (err) => err.code === 'E_USAGE');
});
