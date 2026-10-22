import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startNodeRelay, type NodeRelay } from '../src/node-server.js';

let relay: NodeRelay;
let bare: NodeRelay;

/** Raw request so that `..` segments reach the server untouched (fetch normalises them away). */
const raw = (base: string, path: string, method = 'GET') =>
  new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const url = new URL(base);
    const req = request({ host: url.hostname, port: url.port, path, method }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocket-static-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Pocket</title>');
  mkdirSync(join(dir, '_expo/static/js/web'), { recursive: true });
  writeFileSync(join(dir, '_expo/static/js/web/app-abc123.js'), 'console.log(1)');
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'assets/icon.0123.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(dir, 'secret.txt'), 'inside');
  relay = await startNodeRelay({ port: 0, staticDir: dir });
  bare = await startNodeRelay({ port: 0 });
});

afterAll(async () => {
  await relay.close();
  await bare.close();
});

describe('web app hosting', () => {
  it('serves the exported app with the right types and caching', async () => {
    const index = await raw(relay.url, '/');
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(index.headers['cache-control']).toBe('no-cache');
    expect(index.body).toContain('<title>Pocket</title>');

    const js = await raw(relay.url, '/_expo/static/js/web/app-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(js.body).toBe('console.log(1)');

    const png = await raw(relay.url, '/assets/icon.0123.png');
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['content-length']).toBe('4');

    const head = await raw(relay.url, '/', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  it('hands app routes to index.html but keeps the relay API and missing files as 404', async () => {
    for (const path of ['/pair', '/direct/abc', '/settings?code=ABCD']) {
      const res = await raw(relay.url, path);
      expect(res.status, path).toBe(200);
      expect(res.body, path).toContain('<title>Pocket</title>');
    }
    expect((await raw(relay.url, '/missing.js')).status).toBe(404);
    expect((await raw(relay.url, '/v1/pairings/000000000000000000000000')).status).toBe(404);
    expect((await raw(relay.url, '/v1/whatever')).status).toBe(404);
    expect((await raw(relay.url, '/healthz')).body).toBe('ok');
    expect((await raw(relay.url, '/', 'POST')).status).toBe(404);
  });

  it('never leaves the static folder', async () => {
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/_expo/%2e%2e/%2e%2e/package.json', '/%zz']) {
      const res = await raw(relay.url, path);
      expect(res.status, path).toBe(404);
    }
    expect((await raw(relay.url, '/secret.txt')).body).toBe('inside');
  });

  it('stays API-only without a static folder', async () => {
    expect((await raw(bare.url, '/')).status).toBe(404);
    expect((await raw(bare.url, '/pair')).status).toBe(404);
  });
});
