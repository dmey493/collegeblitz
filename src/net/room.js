// Two-player game rooms: lobby, ready-up, the authoritative Match, snapshot streaming,
// rematches and CPU takeover. Transport-agnostic and runs anywhere: the Node game server
// hosts many rooms over WebSockets, and in peer-to-peer play the host's browser runs a
// single room for itself and its opponent.
//
// A connection is anything with send(string). Messages are JSON, see src/net/online.js.
import { Match } from '../sim/match.js';
import { TEAMS } from '../sim/teams.js';
import { HZ } from '../sim/constants.js';
import { inputFromMessage } from './wire.js';
import { makeCode, cleanName } from './codes.js';

const QUARTERS = [60, 90, 120, 180, 300];

const send = (conn, obj) => conn && conn.send(JSON.stringify(obj));

// Default clock: a plain interval. The browser host passes one that keeps running in a
// background tab.
const intervalTicker = (fn, ms) => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
};

export class Room {
  constructor(code, { onEmpty, ticker = intervalTicker, maxCatchUp = 0.25 } = {}) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.ticker = ticker;
    this.maxCatchUp = maxCatchUp;
    this.players = [null, null];
    this.ready = [false, false];
    this.rematch = [false, false];
    // online games play at TURBO speed, like a fresh vs-CPU game
    this.lobby = { team: 'IND', rules: { quarterSec: 120, fdYards: 30, pace: 1.2 } };
    this.match = null;
    this.stopLoop = null;
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
    for (const p of this.players) send(p, obj);
  }

  pushLobby() {
    this.broadcast({ t: 'lobby', lobby: this.lobbyState() });
  }

  seat(conn, slot) {
    this.players[slot] = conn;
    conn.room = this;
    send(conn, { t: 'room', code: this.code, slot, lobby: this.lobbyState() });
    if (slot === 1) this.pushLobby();
  }

  start() {
    const host = this.lobby.team;
    const guest = Object.keys(TEAMS).find((id) => id !== host);
    this.match = new Match({ teams: [host, guest], humans: [!!this.players[0], !!this.players[1]], rules: this.lobby.rules });
    this.rematch = [false, false];
    const info = this.match.info();
    this.players.forEach((p, i) => send(p, { t: 'start', info, you: i }));
    this.runLoop();
  }

  runLoop() {
    this.stop();
    const dt = 1 / HZ;
    let last = performance.now();
    let acc = 0;
    let tick = 0;
    let pending = [];
    this.stopLoop = this.ticker(() => {
      const now = performance.now();
      acc += Math.min(this.maxCatchUp, (now - last) / 1000);
      last = now;
      while (acc >= dt) {
        acc -= dt;
        this.match.step(dt);
        pending.push(...this.match.drainEvents());
        tick++;
        if (tick % 2 === 0) {
          // 30 Hz snapshots carry every event since the last one
          const msg = JSON.stringify({ t: 's', s: this.match.snapshot(), e: pending });
          pending = [];
          for (const p of this.players) if (p) p.send(msg);
        }
      }
    }, 1000 / HZ / 2);
  }

  stop() {
    if (this.stopLoop) this.stopLoop();
    this.stopLoop = null;
  }

  leave(conn) {
    const i = this.players.indexOf(conn);
    if (i < 0) return;
    this.players[i] = null;
    this.ready[i] = false;
    conn.room = null;
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
    if (this.onEmpty) this.onEmpty(this);
  }

  // Messages from a seated player.
  handle(conn, m) {
    const i = this.players.indexOf(conn);
    if (i < 0) return;
    switch (m.t) {
      case 'lobby': {
        if (this.match || i !== 0) return;
        if (m.team in TEAMS) this.lobby.team = m.team;
        if (m.rules) {
          const q = Number(m.rules.quarterSec);
          const f = Number(m.rules.fdYards);
          if (QUARTERS.includes(q)) this.lobby.rules.quarterSec = q;
          if (f === 25 || f === 30) this.lobby.rules.fdYards = f;
        }
        this.ready = [false, false];
        this.pushLobby();
        return;
      }
      case 'ready':
        if (this.match) return;
        this.ready[i] = !!m.ready;
        this.pushLobby();
        if (this.players[0] && this.players[1] && this.ready[0] && this.ready[1]) this.start();
        return;
      case 'in':
        if (this.match) this.match.setInput(i, inputFromMessage(m));
        return;
      case 'cmd':
        if (this.match) this.match.command(i, m.cmd);
        return;
      case 'rematch': {
        if (!this.match || this.match.phase !== 'final') return;
        this.rematch[i] = true;
        const others = this.players.map((p, k) => (p ? this.rematch[k] : true));
        if (others.every(Boolean)) {
          this.stop();
          this.start();
        } else this.broadcast({ t: 'rematchWanted', slot: i });
        return;
      }
      default:
    }
  }
}

// Front door for connections: room codes, create / join, and routing to rooms.
export class Hub {
  constructor({ maxRooms = 500, code = makeCode, roomOptions = {} } = {}) {
    this.rooms = new Map();
    this.maxRooms = maxRooms;
    this.code = code;
    this.roomOptions = roomOptions;
  }

  connect(sendFn) {
    return { send: sendFn, name: 'PLAYER', room: null };
  }

  message(conn, m) {
    if (!m || typeof m.t !== 'string') return;
    const room = conn.room;
    switch (m.t) {
      case 'ping':
        send(conn, { t: 'pong', c: m.c });
        return;
      case 'create': {
        if (room) room.leave(conn);
        if (this.rooms.size >= this.maxRooms) return send(conn, { t: 'err', msg: 'Server is full. Try again soon.' });
        let code = null;
        for (let k = 0; k < 1000 && !code; k++) {
          const c = this.code();
          if (c && !this.rooms.has(c)) code = c;
        }
        if (!code) return send(conn, { t: 'err', msg: 'Could not create a room.' });
        const r = new Room(code, { ...this.roomOptions, onEmpty: (rm) => this.rooms.delete(rm.code) });
        this.rooms.set(code, r);
        conn.name = cleanName(m.name);
        r.seat(conn, 0);
        return undefined;
      }
      case 'join': {
        const code = String(m.code || '').toUpperCase();
        const r = this.rooms.get(code);
        if (!r) return send(conn, { t: 'err', msg: `No room called ${code || '????'}.` });
        if (r.match) return send(conn, { t: 'err', msg: 'That game already started.' });
        if (r.players[1]) return send(conn, { t: 'err', msg: 'That room is full.' });
        if (room) room.leave(conn);
        conn.name = cleanName(m.name);
        r.seat(conn, 1);
        return undefined;
      }
      case 'leave':
        if (room) room.leave(conn);
        return undefined;
      default:
        if (room) room.handle(conn, m);
        return undefined;
    }
  }

  disconnect(conn) {
    if (conn.room) conn.room.leave(conn);
  }

  // Drop lobbies nobody started.
  sweep(maxAgeMs = 30 * 60 * 1000) {
    const now = Date.now();
    for (const r of [...this.rooms.values()]) if (!r.match && now - r.created > maxAgeMs) r.close();
  }
}
