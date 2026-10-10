// Online session: the server runs the Match; we send inputs and render its snapshots.
import { SnapshotBuffer } from './buffer.js';

export function defaultServerUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }
  return 'ws://localhost:8787/ws';
}

export class OnlineSession {
  constructor(url) {
    this.kind = 'online';
    this.url = url;
    this.handlers = {};
    this.buffer = new SnapshotBuffer(0.1);
    this.myTeam = 0;
    this.local = [false, false];
    this.info = null;
    this.started = false;
    this.rtt = 0;
    this.lastSent = '';
    this.sendT = 0;
    this.pingT = 0;
    this.jitter = 0;
    this.lastArrive = 0;
    this.closed = false;
    this.ws = new WebSocket(url);
    this.opened = false;
    this.ws.onopen = () => {
      this.opened = true;
      this.emit('open');
    };
    this.ws.onclose = () => {
      if (!this.closed) this.emit('close');
    };
    this.ws.onerror = () => this.emit('error', `Could not reach a game server at ${url}. Online play needs the College Blitz server running (npm start).`);
    this.ws.onmessage = (m) => this.onMessage(m.data);
  }

  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
    return this;
  }

  emit(type, data) {
    for (const fn of this.handlers[type] || []) fn(data);
  }

  send(obj) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
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
        this.buffer.delay = Math.min(0.22, Math.max(0.07, 0.06 + this.jitter * 3));
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
    this.pingT -= dt;
    if (this.pingT <= 0 && this.ws.readyState === 1) {
      this.pingT = 2;
      this.send({ t: 'ping', c: performance.now() });
    }
    if (!this.started) return;
    this.sendT -= dt;
    const msg = { t: 'in', mx: Math.round(input.mx * 100) / 100, my: Math.round(input.my * 100) / 100, tb: input.turbo ? 1 : 0, a: input.a, j: input.j };
    const key = `${msg.mx},${msg.my},${msg.tb},${msg.a},${msg.j}`;
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
    try {
      this.send({ t: 'leave' });
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}
