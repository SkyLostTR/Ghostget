// A tiny stand-in for the three Microsoft hosts ghostget talks to, so tests never touch the network.
import { readFileSync } from 'node:fs';
import http from 'node:http';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

/** The headers Microsoft's real installer endpoint sent when this project was written. */
export const REAL_DISPOSITION = `attachment; filename="ChatGPT (Beta) Installer.exe"; filename*=UTF-8''ChatGPT%20%28Beta%29%20Installer.exe`;

/** A minimal but plausible PE file: "MZ" plus padding. Never executed. */
export const fakeExe = (size = 4096) => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(size - 2, 7)]);

/**
 * @param {object} [initial] Behaviour knobs; tests can change `mock.state` between calls.
 */
export async function startMockStore(initial = {}) {
  const state = {
    requests: [],
    storeSearch: { status: 200, body: fixture('store-search.json') },
    manifestSearch: { status: 200, body: fixture('manifest-search.json') },
    edgeProduct: { status: 200, body: { Payload: { Installer: { Type: 'WindowsUpdate' } } } },
    // Win32 (`XP...`) apps: only the Store's own product API knows them, the display catalog does not.
    edgeProducts: { XP9KHM4BK9FZ7Q: fixture('edge-vscode.json'), XPFD4T9N395QN6: fixture('edge-photoshop.json') },
    catalog: { '9N8CJ4W95TBZ': fixture('catalog-free.json'), '9PGLL77C201J': fixture('catalog-paid.json') },
    catalogStatus: 200,
    installer: { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': REAL_DISPOSITION }, body: fakeExe(), truncateAt: null },
    ...initial,
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    state.requests.push(`${req.method} ${url.pathname}${url.search}`);
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/edge/search') return json(state.storeSearch.status, state.storeSearch.body);
    if (url.pathname === '/edge/manifestSearch') return json(state.manifestSearch.status, state.manifestSearch.body);
    if (url.pathname.startsWith('/edge/products/')) {
      const id = url.pathname.split('/').pop().toUpperCase();
      if (state.edgeProducts[id]) return json(state.edgeProduct.status, state.edgeProducts[id]);
      return json(state.edgeProduct.status, state.edgeProduct.body);
    }

    if (url.pathname === '/dc/products') {
      if (state.catalogStatus !== 200) return json(state.catalogStatus, { error: 'boom' });
      const id = (url.searchParams.get('bigIds') ?? '').toUpperCase();
      return json(200, state.catalog[id] ?? { Products: [] });
    }

    if (url.pathname.startsWith('/installer/')) {
      const id = url.pathname.split('/').pop();
      if (id === '9ZZZZZZZZZZZ') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('Product not found');
      }
      const { status, headers, body, truncateAt } = state.installer;
      res.writeHead(status, { ...headers, 'content-length': String(body.length) });
      if (truncateAt !== null) {
        res.write(body.subarray(0, truncateAt));
        return setTimeout(() => res.destroy(), 10);
      }
      return res.end(body);
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    state,
    /** Endpoint overrides for the library options. */
    endpoints: { installer: `${base}/installer`, displayCatalog: `${base}/dc`, storeEdge: `${base}/edge` },
    /** The same overrides as environment variables, for the CLI. */
    env: {
      GHOSTGET_INSTALLER_URL: `${base}/installer`,
      GHOSTGET_DISPLAY_CATALOG_URL: `${base}/dc`,
      GHOSTGET_STORE_EDGE_URL: `${base}/edge`,
      GHOSTGET_MARKET: 'US',
      GHOSTGET_LOCALE: 'en-US',
      NO_COLOR: '1',
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

/** Capture what a CLI run writes. */
export function fakeStream({ isTTY = false, columns = 120 } = {}) {
  let text = '';
  return {
    isTTY,
    columns,
    write(chunk) {
      text += chunk;
      return true;
    },
    get text() {
      return text;
    },
  };
}
