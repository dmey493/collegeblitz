// Peer-to-peer online play over WebRTC. No game server: the host's browser runs the room
// (the same code the Node server runs) and streams it to the guest over a data channel.
// The only server involvement is matchmaking (/api, a Netlify function): the host posts a
// connection offer and gets a 4-letter code, the guest trades it for the offer and posts
// an answer back. ICE candidates are gathered up front, so it is one round trip each way.
import { Hub } from './room.js';

const API = '/api';
const CONNECT_TIMEOUT_MS = 20000;
const SILENCE_MS = 8000;
// A peer whose connection WebRTC still reports healthy gets much longer: a busy page (a slow
// machine building textures or compiling shaders) can go quiet for a while without having
// left. A closed tab closes the channel at once; a lost network fails the connection.
const STALL_MS = 30000;
const silent = (pc, heard) => {
  const quiet = performance.now() - heard;
  return quiet > (pc.connectionState === 'connected' ? STALL_MS : SILENCE_MS);
};

export const p2pSupported = () => typeof RTCPeerConnection === 'function';

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new Error(location.protocol === 'file:'
      ? 'Online play needs the game served from a web host (Netlify, or npm start locally).'
      : 'Could not reach matchmaking. Check your connection and try again.');
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON: most likely no matchmaking function on this host */
  }
  if (!res.ok || !data) {
    if (res.status === 404 && !(data && data.error)) throw new Error('This host has no matchmaking service. Deploy with the Netlify function or run npm start.');
    throw new Error((data && data.error) || `Matchmaking failed (${res.status}).`);
  }
  return data;
}

async function iceServers() {
  try {
    const r = await call('GET', '/ice');
    if (r && Array.isArray(r.iceServers)) return r.iceServers;
  } catch {
    /* fall back to public STUN */
  }
  return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
}

// Wait for the ICE candidates to land in the local description. Gathering can hang on
// odd network interfaces, so stop shortly after the first public (STUN) candidate shows
// up, or after a few seconds with whatever we have.
function gathered(pc, ms = 3000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let soon = null;
    const done = () => {
      clearTimeout(timer);
      clearTimeout(soon);
      pc.removeEventListener('icegatheringstatechange', check);
      pc.removeEventListener('icecandidate', cand);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const cand = (e) => {
      if (e.candidate && / typ (srflx|relay) /.test(e.candidate.candidate) && !soon) soon = setTimeout(done, 500);
    };
    const timer = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
    pc.addEventListener('icecandidate', cand);
  });
}

const desc = (d) => ({ type: d.type, sdp: d.sdp });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function opened(dc, pc, ms = CONNECT_TIMEOUT_MS) {
  if (dc.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const fail = () => {
      clearTimeout(timer);
      reject(new Error("Couldn't connect directly to the other player. Some networks block peer-to-peer games; try another network, or add a TURN server (see README)."));
    };
    const timer = setTimeout(fail, ms);
    dc.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    pc.addEventListener('connectionstatechange', () => pc.connectionState === 'failed' && fail());
  });
}

// Timers in a background tab get throttled to once a second; a worker's don't, so the
// host's game keeps running smoothly for the guest even if the host switches tabs.
export function workerTicker(fn, ms) {
  try {
    const src = 'let id=0;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = () => fn();
    w.postMessage(ms);
    return () => w.terminate();
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}

function channelTransport(dc, pc) {
  const t = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    get isOpen() {
      return dc.readyState === 'open';
    },
    send(text) {
      if (dc.readyState === 'open') dc.send(text);
    },
    close() {
      dc.close();
      pc.close();
    },
  };
  let ended = false;
  let heard = performance.now();
  const end = () => {
    if (ended) return;
    ended = true;
    clearInterval(watch);
    if (t.onclose) t.onclose();
  };
  // the host streams 30 snapshots a second: a long silence means it is gone
  const watch = setInterval(() => silent(pc, heard) && end(), 1000);
  dc.onmessage = (e) => {
    heard = performance.now();
    if (t.onmessage) t.onmessage(e.data);
  };
  dc.onclose = end;
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') end();
  });
  return t;
}

// The host: runs the room in this page and accepts one guest.
export class P2PHost {
  constructor() {
    this.code = null;
    this.closed = false;
    this.hub = new Hub({ maxRooms: 1, code: () => this.code, roomOptions: { ticker: workerTicker, maxCatchUp: 1 } });
    this.pc = null;
    this.dc = null;
    this.guest = null;
  }

  // Create the connection offer and register it; resolves to the room code.
  async open() {
    if (!p2pSupported()) throw new Error("This browser can't make direct connections. Try Chrome, Edge, Firefox or Safari.");
    this.pc = new RTCPeerConnection({ iceServers: await iceServers() });
    this.dc = this.pc.createDataChannel('game', { ordered: true });
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await gathered(this.pc);
    const { code } = await call('POST', '/rooms', { offer: desc(this.pc.localDescription) });
    this.code = code;
    return code;
  }

  // The host's own seat: an in-page loopback into the room.
  localTransport() {
    const t = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      isOpen: true,
      send: (text) => {
        let m;
        try {
          m = JSON.parse(text);
        } catch {
          return;
        }
        this.hub.message(conn, m);
      },
      close: () => this.hub.disconnect(conn),
    };
    // deliver asynchronously so the room never re-enters the caller
    const conn = this.hub.connect((text) => queueMicrotask(() => t.onmessage && t.onmessage(text)));
    return t;
  }

  // Wait for a guest to answer, then seat them in the room.
  async waitForGuest() {
    let answer = null;
    while (!this.closed && !answer) {
      const r = await call('GET', `/rooms/${this.code}/answer`).catch((e) => {
        if (/No room/.test(e.message)) throw new Error('The room expired. Create a new one.');
        return null;
      });
      if (r && r.answer) answer = r.answer;
      else await sleep(1200);
    }
    if (this.closed) return;
    await this.pc.setRemoteDescription(answer);
    await opened(this.dc, this.pc);
    call('DELETE', `/rooms/${this.code}`).catch(() => {});
    const dc = this.dc;
    const conn = this.hub.connect((text) => {
      if (dc.readyState === 'open') dc.send(text);
    });
    this.guest = conn;
    let heard = performance.now();
    dc.onmessage = (e) => {
      heard = performance.now();
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      this.hub.message(conn, m);
    };
    const gone = () => {
      if (this.guest !== conn) return;
      this.guest = null;
      clearInterval(watch);
      this.hub.disconnect(conn);
    };
    // the guest pings every 2 s and sends input 10 times a second while playing
    const watch = setInterval(() => silent(this.pc, heard) && gone(), 1000);
    dc.onclose = gone;
    this.pc.addEventListener('connectionstatechange', () => {
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') gone();
    });
  }

  close() {
    this.closed = true;
    if (this.code && !this.guest) call('DELETE', `/rooms/${this.code}`).catch(() => {});
    try {
      if (this.dc) this.dc.close();
      if (this.pc) this.pc.close();
    } catch {
      /* already closed */
    }
    for (const r of this.hub.rooms.values()) r.close();
  }
}

// The guest: answer the host's offer and hand back a transport once connected.
export async function connectToHost(code) {
  if (!p2pSupported()) throw new Error("This browser can't make direct connections. Try Chrome, Edge, Firefox or Safari.");
  const { offer, answered } = await call('GET', `/rooms/${code}`);
  if (answered) throw new Error('Somebody already joined that room.');
  const pc = new RTCPeerConnection({ iceServers: await iceServers() });
  const channel = new Promise((resolve) => {
    pc.ondatachannel = (e) => resolve(e.channel);
  });
  await pc.setRemoteDescription(offer);
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  try {
    await call('POST', `/rooms/${code}/answer`, { answer: desc(pc.localDescription) });
    const dc = await Promise.race([channel, sleep(CONNECT_TIMEOUT_MS).then(() => null)]);
    if (!dc) throw new Error("Couldn't connect directly to the host. Some networks block peer-to-peer games; try another network, or add a TURN server (see README).");
    await opened(dc, pc);
    return channelTransport(dc, pc);
  } catch (e) {
    pc.close();
    throw e;
  }
}
