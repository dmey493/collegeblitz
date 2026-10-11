// College Blitz online server.
//  - Serves the built game (dist/index.html) over HTTP.
//  - Hosts 2-player rooms over WebSocket at /ws.
//  - Runs the authoritative Match for each room at 60 Hz and streams snapshots at 30 Hz.
//
//   npm run build && npm start        (PORT defaults to 8787)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Match } from '../src/sim/match.js';
import { TEAMS } from '../src/sim/teams.js';
import { HZ } from '../src/sim/constants.js';
import { inputFromMessage } from '../src/net/wire.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 8787);
const MAX_ROOMS = 500;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const QUARTERS = [60, 90, 120, 180, 300];

const rooms = new Map();

function makeCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

const send = (ws, obj) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
};
const clean = (s, n = 12) => String(s || 'PLAYER').toUpperCase().replace(/[^A-Z0-9 _.-]/g, '').slice(0, n) || 'PLAYER';

class Room {
  constructor(code) {
    this.code = code;
    this.players = [null, null];
    this.ready = [false, false];
    this.rematch = [false, false];
    this.lobby = { team: 'IND', rules: { quarterSec: 120, fdYards: 30 } };
    this.match = null;
    this.loop = null;
    this.created = Date.now();
  }

  lobbyState() {
    return {
      team: this.lobby.team,
      rules: this.lobby.rules,
      players: this.players.map((p, i) => (p ? { name: p.name, ready: this.ready[i] } : null)),
    };
  }

  broadcast(obj) {
    for (const p of this.players) if (p) send(p.ws, obj);
  }

  pushLobby() {
    this.broadcast({ t: 'lobby', lobby: this.lobbyState() });
  }

  start() {
    const host = this.lobby.team;
    const guest = Object.keys(TEAMS).find((id) => id !== host);
    this.match = new Match({
      teams: [host, guest],
      humans: [!!this.players[0], !!this.players[1]],
      rules: this.lobby.rules,
    });
    this.rematch = [false, false];
    const info = this.match.info();
    this.players.forEach((p, i) => p && send(p.ws, { t: 'start', info, you: i }));
    this.runLoop();
  }

  runLoop() {
    clearInterval(this.loop);
    const dt = 1 / HZ;
    let last = performance.now();
    let acc = 0;
    let tick = 0;
    let pending = [];
    this.loop = setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= dt) {
        acc -= dt;
        this.match.step(dt);
        pending.push(...this.match.drainEvents());
        tick++;
        if (tick % 2 === 0) {
          const msg = JSON.stringify({ t: 's', s: this.match.snapshot(), e: pending });
          pending = [];
          for (const p of this.players) if (p && p.ws.readyState === 1) p.ws.send(msg);
        }
      }
    }, 1000 / HZ / 2);
  }

  stop() {
    clearInterval(this.loop);
    this.loop = null;
  }

  leave(conn) {
    const i = this.players.indexOf(conn);
    if (i < 0) return;
    this.players[i] = null;
    this.ready[i] = false;
    if (this.match) {
      // keep the game going for whoever is left: the CPU takes over
      this.match.setHuman(i, false);
      this.broadcast({ t: 'left', slot: i });
    } else if (i === 0) {
      // host left the lobby: close the room
      this.broadcast({ t: 'err', msg: 'The host left the room.' });
      for (const p of this.players) if (p) p.room = null;
      this.players = [null, null];
    } else {
      this.broadcast({ t: 'left', slot: i });
      this.pushLobby();
    }
    if (!this.players[0] && !this.players[1]) this.close();
  }

  close() {
    this.stop();
    rooms.delete(this.code);
  }
}

function handle(conn, m) {
  const room = conn.room;
  switch (m.t) {
    case 'ping':
      return send(conn.ws, { t: 'pong', c: m.c });
    case 'create': {
      if (room) room.leave(conn);
      if (rooms.size >= MAX_ROOMS) return send(conn.ws, { t: 'err', msg: 'Server is full. Try again soon.' });
      const code = makeCode();
      if (!code) return send(conn.ws, { t: 'err', msg: 'Could not create a room.' });
      const r = new Room(code);
      rooms.set(code, r);
      conn.name = clean(m.name);
      conn.room = r;
      r.players[0] = conn;
      send(conn.ws, { t: 'room', code, slot: 0, lobby: r.lobbyState() });
      return undefined;
    }
    case 'join': {
      const code = String(m.code || '').toUpperCase();
      const r = rooms.get(code);
      if (!r) return send(conn.ws, { t: 'err', msg: `No room called ${code || '????'}.` });
      if (r.match) return send(conn.ws, { t: 'err', msg: 'That game already started.' });
      if (r.players[1]) return send(conn.ws, { t: 'err', msg: 'That room is full.' });
      if (room) room.leave(conn);
      conn.name = clean(m.name);
      conn.room = r;
      r.players[1] = conn;
      send(conn.ws, { t: 'room', code, slot: 1, lobby: r.lobbyState() });
      r.pushLobby();
      return undefined;
    }
    case 'lobby': {
      if (!room || room.match || room.players[0] !== conn) return undefined;
      if (m.team in TEAMS) room.lobby.team = m.team;
      if (m.rules) {
        const q = Number(m.rules.quarterSec);
        const f = Number(m.rules.fdYards);
        if (QUARTERS.includes(q)) room.lobby.rules.quarterSec = q;
        if (f === 25 || f === 30) room.lobby.rules.fdYards = f;
      }
      room.ready = [false, false];
      room.pushLobby();
      return undefined;
    }
    case 'ready': {
      if (!room || room.match) return undefined;
      const i = room.players.indexOf(conn);
      room.ready[i] = !!m.ready;
      room.pushLobby();
      if (room.players[0] && room.players[1] && room.ready[0] && room.ready[1]) room.start();
      return undefined;
    }
    case 'in': {
      if (!room || !room.match) return undefined;
      const i = room.players.indexOf(conn);
      if (i < 0) return undefined;
      room.match.setInput(i, inputFromMessage(m));
      return undefined;
    }
    case 'cmd': {
      if (!room || !room.match) return undefined;
      const i = room.players.indexOf(conn);
      if (i >= 0) room.match.command(i, m.cmd);
      return undefined;
    }
    case 'rematch': {
      if (!room || !room.match || room.match.phase !== 'final') return undefined;
      const i = room.players.indexOf(conn);
      room.rematch[i] = true;
      const others = room.players.map((p, k) => (p ? room.rematch[k] : true));
      if (others.every(Boolean)) {
        room.stop();
        room.start();
      } else room.broadcast({ t: 'rematchWanted', slot: i });
      return undefined;
    }
    case 'leave':
      if (room) room.leave(conn);
      conn.room = null;
      return undefined;
    default:
      return undefined;
  }
}

// ------------------------------------------------------------------ http
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
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

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024, perMessageDeflate: false });
wss.on('connection', (ws) => {
  const conn = { ws, name: 'PLAYER', room: null, msgs: 0, window: Date.now() };
  ws.on('message', (data) => {
    // simple flood guard
    const now = Date.now();
    if (now - conn.window > 1000) {
      conn.window = now;
      conn.msgs = 0;
    }
    if (++conn.msgs > 240) return;
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m && typeof m.t === 'string') {
      try {
        handle(conn, m);
      } catch (e) {
        console.error('message error', e);
      }
    }
  });
  ws.on('close', () => {
    if (conn.room) conn.room.leave(conn);
    conn.room = null;
  });
});

// clean up abandoned lobbies
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (!r.match && now - r.created > 30 * 60 * 1000) r.close();
  }
}, 60 * 1000);

server.listen(PORT, () => {
  console.log(`College Blitz server on http://localhost:${PORT}  (WebSocket: ws://localhost:${PORT}/ws)`);
});
