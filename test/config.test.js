import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveEndpoints, resolveLocale } from '../src/config.js';

test('defaults to Microsoft https endpoints', () => {
  const e = resolveEndpoints({}, {});
  assert.equal(e.installer, 'https://get.microsoft.com/installer/download');
  assert.match(e.displayCatalog, /^https:\/\/displaycatalog\.mp\.microsoft\.com/);
  assert.match(e.storeEdge, /^https:\/\/storeedgefd\.dsx\.mp\.microsoft\.com/);
});

test('endpoint overrides must be https, except for localhost', () => {
  assert.equal(resolveEndpoints({ installer: 'http://127.0.0.1:8080/x/' }, {}).installer, 'http://127.0.0.1:8080/x');
  assert.equal(resolveEndpoints({}, { GHOSTGET_INSTALLER_URL: 'https://mirror.example.com/dl' }).installer, 'https://mirror.example.com/dl');
  assert.throws(() => resolveEndpoints({ installer: 'http://mirror.example.com/dl' }, {}), /https/);
  assert.throws(() => resolveEndpoints({ installer: 'ftp://x' }, {}), /https/);
  assert.throws(() => resolveEndpoints({ installer: 'not a url' }, {}), /valid URL/);
});

test('an explicit option beats the environment, which beats the system locale', () => {
  assert.deepEqual(resolveLocale({ market: 'de', locale: 'de-DE', env: { GHOSTGET_MARKET: 'TR' } }), { market: 'DE', locale: 'de-DE' });
  assert.deepEqual(resolveLocale({ env: { GHOSTGET_MARKET: 'tr', GHOSTGET_LOCALE: 'tr-TR' } }), { market: 'TR', locale: 'tr-TR' });
});

test('the market follows an explicit locale when no market is given', () => {
  assert.equal(resolveLocale({ locale: 'fr-CA', env: {} }).market, 'CA');
});

test('rejects malformed locale and market values', () => {
  assert.throws(() => resolveLocale({ locale: 'not a locale', env: {} }), /valid locale/);
  assert.throws(() => resolveLocale({ market: 'USA', env: {} }), /valid market/);
});
