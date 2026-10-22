import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PairingBundle } from '@pocket/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { AccountRoom, MAX_FRAME_BYTES, type Conn, type ConnState, type Storage } from './core.js';

class MapStorage implements Storage {
  private readonly data: Map<string, unknown>;

  constructor(private readonly file?: string) {
    let initial: Record<string, unknown> = {};
    if (file) {
      try {
        initial = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        initial = {};
      }
    }
    this.data = new Map(Object.entries(initial));
  }

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.data.get(key)) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, structuredClone(value));
    this.flush();
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
    this.flush();
  }

  private flush(): void {
    if (this.file) writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.data)));
  }
}

class WsConn implements Conn {
  private state: ConnState = { kind: 'device', authed: false, tokens: 0, refill: 0 };
  constructor(readonly ws: WebSocket) {}
  send(text: string): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(text);
  }
  close(code: number, reason: string): void {
    this.ws.close(code, reason);
  }
  getState(): ConnState {
    return this.state;
  }
  setState(state: ConnState): void {
    this.state = state;
  }
}

export interface NodeRelay {
  server: Server;
  url: string;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};

/** Expo's web export: the app lives in `apps/mobile/dist` once `pnpm --filter @pocket/mobile export:web` has run. */
export function defaultStaticDir(): string | undefined {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../mobile/dist');
  return existsSync(join(dir, 'index.html')) ? dir : undefined;
}

/**
 * Serves the exported web app (the Telegram Mini App) next to the relay API. Unknown paths without an
 * extension get `index.html` so the app's own router handles them; hashed bundles are cached for a year.
 */
function serveStatic(root: string, pathname: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const rootAbs = resolve(root);
  let file = resolve(rootAbs, `.${rel}`);
  if (file !== rootAbs && !file.startsWith(rootAbs + sep)) return false;
  const isFile = (f: string) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  };
  if (!isFile(file)) {
    if (extname(rel) !== '') return false;
    file = join(rootAbs, 'index.html');
    if (!isFile(file)) return false;
  }
  const hashed = rel.startsWith('/_expo/static/') || rel.startsWith('/assets/');
  const stat = statSync(file);
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}

/** Self-hosted relay for development, tests, or running on your own box behind a tunnel. */
export async function startNodeRelay(opts: { port?: number; host?: string; dataDir?: string; staticDir?: string } = {}): Promise<NodeRelay> {
  const rooms = new Map<string, { room: AccountRoom; conns: Set<WsConn> }>();
  const pairings = new Map<string, { accountId: string; bundle: PairingBundle }>();
  if (opts.dataDir) mkdirSync(opts.dataDir, { recursive: true });

  const roomFor = (accountId: string) => {
    let entry = rooms.get(accountId);
    if (!entry) {
      const conns = new Set<WsConn>();
      const storage = new MapStorage(opts.dataDir ? join(opts.dataDir, `${accountId}.json`) : undefined);
      const room = new AccountRoom(accountId, {
        storage,
        connections: () => [...conns],
        publishPairing: async (pairingId, bundle) => {
          if (bundle) pairings.set(pairingId, { accountId, bundle });
          else pairings.delete(pairingId);
        },
      });
      entry = { room, conns };
      rooms.set(accountId, entry);
    }
    return entry;
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://relay');
    const pairing = url.pathname.match(/^\/v1\/pairings\/([0-9a-f]{24})$/);
    if (req.method === 'GET' && pairing) {
      const p = pairings.get(pairing[1]!);
      if (!p || p.bundle.expiresAt < Date.now()) {
        res.writeHead(404, { 'access-control-allow-origin': '*' }).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify(p.bundle));
      return;
    }
    if (url.pathname === '/healthz') {
      res.writeHead(200).end('ok');
      return;
    }
    if (opts.staticDir && !url.pathname.startsWith('/v1/') && serveStatic(opts.staticDir, url.pathname, req, res)) return;
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server, maxPayload: MAX_FRAME_BYTES });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://relay');
    const account = url.pathname.match(/^\/v1\/accounts\/([0-9a-f]{32})\/ws$/);
    const pairing = url.pathname.match(/^\/v1\/pairings\/([0-9a-f]{24})\/ws$/);
    let accountId: string | undefined;
    let pairingId: string | undefined;
    if (account) accountId = account[1];
    else if (pairing) {
      pairingId = pairing[1];
      accountId = pairings.get(pairingId!)?.accountId;
      if (!accountId) {
        ws.send(JSON.stringify({ t: 'error', code: 'pairing_expired', message: 'Pairing code not found or expired' }));
        ws.close(4404, 'pairing expired');
        return;
      }
    }
    if (!accountId) {
      ws.close(4404, 'not found');
      return;
    }
    const { room, conns } = roomFor(accountId);
    const conn = new WsConn(ws);
    conns.add(conn);
    const opened = room.onOpen(conn, pairingId);
    ws.on('message', (data) => void opened.then(() => room.onMessage(conn, data.toString())));
    ws.on('close', () => {
      conns.delete(conn);
      void room.onClose(conn);
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 8787, opts.host ?? '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port ?? 8787;
  return {
    server,
    url: `http://${opts.host ?? '127.0.0.1'}:${port}`,
    close: () =>
      new Promise((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '0.0.0.0';
  // STATIC_DIR= (empty) turns the web app off; unset picks up apps/mobile/dist when it has been exported.
  const staticDir = process.env.STATIC_DIR === undefined ? defaultStaticDir() : process.env.STATIC_DIR || undefined;
  const relay = await startNodeRelay({ port, host, dataDir: process.env.DATA_DIR ?? '.relay-data', staticDir });
  console.log(`pocket relay listening on ${relay.url}${staticDir ? `, serving the web app from ${staticDir}` : ''}`);
}
