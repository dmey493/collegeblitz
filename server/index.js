// College Blitz game server (optional: Netlify hosting needs none of this).
//  - Serves the built game (dist/index.html) over HTTP.
//  - Peer-to-peer matchmaking at /api (same API as the Netlify function), so "DIRECT"
//    online play works when you self-host or run `npm run dev` alongside it.
//  - Server-hosted rooms over WebSocket at /ws: the server runs the authoritative Match
//    at 60 Hz and streams snapshots at 30 Hz. Pick "GAME SERVER" in the online menu.
//
//   npm run build && npm start        (PORT defaults to 8787)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Hub } from '../src/net/room.js';
import { handleSignal, memoryStore } from '../src/net/signal-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 8787);

const hub = new Hub({ maxRooms: 500 });
const signals = memoryStore();

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  let body = null;
  try {
    if (req.method === 'POST') body = JSON.parse((await readBody(req)) || 'null');
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad request' }));
    return;
  }
  const out = await handleSignal({ method: req.method, path: url.pathname, body, store: signals, env: process.env });
  res.writeHead(out.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(out.body === null ? '' : JSON.stringify(out.body));
}

// ------------------------------------------------------------------ http
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: hub.rooms.size, p2pRooms: signals.size() }));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (process.env.DEBUG) console.log(req.method, url.pathname);
    api(req, res, url).catch((e) => {
      console.error('api error', e);
      res.writeHead(500);
      res.end();
    });
    return;
  }
  let file = path.normalize(path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(DIST, 'index.html');
    fs.readFile(file, (err2, data) => {
      if (err2) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('College Blitz server is running. Build the client with `npm run build` to serve the game here.');
        return;
      }
      const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      res.end(data);
    });
  });
});

// ------------------------------------------------------------------ websocket rooms
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024, perMessageDeflate: false });
wss.on('connection', (ws) => {
  const conn = hub.connect((text) => {
    if (ws.readyState === 1) ws.send(text);
  });
  let msgs = 0;
  let windowStart = Date.now();
  ws.on('message', (data) => {
    // simple flood guard
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      msgs = 0;
    }
    if (++msgs > 240) return;
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    try {
      hub.message(conn, m);
    } catch (e) {
      console.error('message error', e);
    }
  });
  ws.on('close', () => hub.disconnect(conn));
});

// clean up abandoned lobbies and stale matchmaking entries
setInterval(() => {
  hub.sweep();
  signals.sweep();
}, 60 * 1000);

server.listen(PORT, () => {
  console.log(`College Blitz server on http://localhost:${PORT}  (WebSocket rooms: ws://localhost:${PORT}/ws, matchmaking: /api)`);
});
