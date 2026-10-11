// Online session: a host runs the Match (the game server, or one player's browser in
// peer-to-peer play); we send inputs and render the snapshots it streams back.
// The transport is anything with send(string)/close() and onopen/onmessage/onclose/onerror:
// a WebSocket to the game server, a WebRTC data channel to the host, or (for the host
// itself) an in-page loopback into the room it is running.
import { SnapshotBuffer } from './buffer.js';
import { inputMessage, inputKey } from './wire.js';

export function defaultServerUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }
  return 'ws://localhost:8787/ws';
}

export function socketTransport(url) {
  const ws = new WebSocket(url);
  const t = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    get isOpen() {
      return ws.readyState === 1;
    },
    send(text) {
      if (ws.readyState === 1) ws.send(text);
    },
    close() {
      ws.close();
    },
  };
  ws.onopen = () => t.onopen && t.onopen();
  ws.onclose = () => t.onclose && t.onclose();
  ws.onerror = () => t.onerror && t.onerror(`Could not reach a game server at ${url}. Server play needs the College Blitz server running (npm start).`);
  ws.onmessage = (m) => t.onmessage && t.onmessage(m.data);
  return t;
}

export class OnlineSession {
  // via: 'server' (WebSocket game server), 'host' (this browser runs the room) or 'guest'
  constructor(transport, { minDelay = 0.07, via = 'server', peer = null } = {}) {
    this.kind = 'online';
    this.via = via;
    this.peer = peer; // peer-to-peer connection, closed with the session
    this.transport = transport;
    this.handlers = {};
    this.minDelay = minDelay;
    this.buffer = new SnapshotBuffer(Math.max(minDelay, 0.1));
    this.myTeam = 0;
    this.local = [false, false];
    this.info = null;
    this.started = false;
    this.rtt = 0;
    this.lastSent = '';
    this.sendT = 0;
    this.jitter = 0;
    this.lastArrive = 0;
    this.closed = false;
    this.opened = false;
    transport.onopen = () => {
      if (this.opened) return;
      this.opened = true;
      this.emit('open');
    };
    transport.onclose = () => {
      clearInterval(this.pinger);
      if (!this.closed) this.emit('close');
    };
    // ping on a timer rather than per frame: it keeps going in a background tab, so a
    // peer-to-peer host doesn't mistake a tabbed-out guest for a dropped one
    this.pinger = setInterval(() => this.opened && this.send({ t: 'ping', c: performance.now() }), 2000);
    transport.onerror = (msg) => this.emit('error', msg);
    transport.onmessage = (data) => this.onMessage(data);
    // a transport that is already connected (peer-to-peer) opens once handlers are attached
    if (transport.isOpen) setTimeout(() => transport.onopen && transport.onopen(), 0);
  }

  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
    return this;
  }

  emit(type, data) {
    for (const fn of this.handlers[type] || []) fn(data);
  }

  send(obj) {
    this.transport.send(JSON.stringify(obj));
  }

  onMessage(raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    switch (m.t) {
      case 's': {
        const now = performance.now() / 1000;
        if (this.lastArrive) {
          const gap = now - this.lastArrive;
          this.jitter = this.jitter * 0.9 + Math.abs(gap - 1 / 30) * 0.1;
        }
        this.lastArrive = now;
        // render a little in the past, more on a jittery connection
        this.buffer.delay = Math.min(0.22, Math.max(this.minDelay, this.minDelay - 0.01 + this.jitter * 3));
        this.buffer.push(m.s, m.e || []);
        break;
      }
      case 'start':
        this.info = m.info;
        this.myTeam = m.you;
        this.local = [m.you === 0, m.you === 1];
        this.started = true;
        this.buffer.reset();
        this.emit('start', m);
        break;
      case 'pong':
        this.rtt = performance.now() - m.c;
        this.emit('ping', this.rtt);
        break;
      default:
        this.emit(m.t, m);
    }
  }

  create(name) {
    this.send({ t: 'create', name });
  }

  join(code, name) {
    this.send({ t: 'join', code: String(code || '').toUpperCase().trim(), name });
  }

  lobby(settings) {
    this.send({ t: 'lobby', ...settings });
  }

  ready(ready = true) {
    this.send({ t: 'ready', ready });
  }

  rematch() {
    this.send({ t: 'rematch' });
  }

  update(dt, input) {
    if (!this.started) return;
    this.sendT -= dt;
    const msg = inputMessage(input);
    const key = inputKey(msg);
    if (key !== this.lastSent || this.sendT <= 0) {
      this.lastSent = key;
      this.sendT = 0.1;
      this.send(msg);
    }
  }

  sample(dt) {
    return this.buffer.sample(dt, this.local);
  }

  command(cmd) {
    this.send({ t: 'cmd', cmd });
  }

  setPaused() {}

  close() {
    this.closed = true;
    clearInterval(this.pinger);
    try {
      this.send({ t: 'leave' });
      this.transport.close();
    } catch {
      /* already closed */
    }
    if (this.peer) this.peer.close();
  }
}
