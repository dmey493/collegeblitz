// Peer-to-peer matchmaking ("signaling"): the host posts a WebRTC offer and gets a room
// code, the guest fetches the offer by code and posts an answer back, the host picks the
// answer up, and from then on the two browsers talk directly. Shared by the Netlify
// function (netlify/functions/rooms.mjs, stored in Netlify Blobs) and the Node server
// (server/index.js, stored in memory), so both expose the same API:
//
//   GET    /api/ice                  -> { iceServers }
//   POST   /api/rooms         {offer} -> { code }
//   GET    /api/rooms/:code           -> { offer }            404 if unknown / expired
//   POST   /api/rooms/:code/answer {answer}                   409 if already answered
//   GET    /api/rooms/:code/answer    -> { answer }  or 204 while waiting
//   DELETE /api/rooms/:code
import { makeCode, isCode } from './codes.js';

export const ROOM_TTL_MS = 15 * 60 * 1000;
const MAX_SDP = 24 * 1024;

const STUN = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// STUN covers most home networks. Strict NATs need a TURN relay: set TURN_URLS
// (comma separated), TURN_USERNAME and TURN_CREDENTIAL in the host's environment.
export function iceServers(env = {}) {
  const list = [...STUN];
  if (env.TURN_URLS) {
    list.push({
      urls: String(env.TURN_URLS).split(',').map((s) => s.trim()).filter(Boolean),
      username: env.TURN_USERNAME || undefined,
      credential: env.TURN_CREDENTIAL || undefined,
    });
  }
  return list;
}

const validDesc = (d, type) => d && typeof d === 'object' && d.type === type && typeof d.sdp === 'string' && d.sdp.length > 0 && d.sdp.length <= MAX_SDP;

// store: { get(code) -> record | null, set(code, record), del(code) }  (all may be async)
// Returns { status, body } where body is a JSON-able object or null.
export async function handleSignal({ method, path, body, store, env = {}, now = Date.now() }) {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean); // ['api', 'rooms', code, 'answer']
  if (parts[0] !== 'api') return { status: 404, body: { error: 'Not found' } };
  if (parts[1] === 'ice' && parts.length === 2 && method === 'GET') return { status: 200, body: { iceServers: iceServers(env) } };
  if (parts[1] !== 'rooms') return { status: 404, body: { error: 'Not found' } };

  const live = async (code) => {
    const r = await store.get(code);
    if (r && now - r.t > ROOM_TTL_MS) {
      await store.del(code);
      return null;
    }
    return r;
  };

  if (parts.length === 2) {
    if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
    if (!validDesc(body && body.offer, 'offer')) return { status: 400, body: { error: 'Missing offer' } };
    for (let k = 0; k < 20; k++) {
      const code = makeCode();
      if (await live(code)) continue;
      await store.set(code, { offer: body.offer, answer: null, t: now });
      return { status: 201, body: { code } };
    }
    return { status: 503, body: { error: 'Could not make a room code. Try again.' } };
  }

  const code = String(parts[2] || '').toUpperCase();
  if (!isCode(code)) return { status: 400, body: { error: 'Room codes are 4 letters.' } };

  if (parts.length === 3) {
    if (method === 'GET') {
      const r = await live(code);
      return r ? { status: 200, body: { offer: r.offer, answered: !!r.answer } } : { status: 404, body: { error: `No room called ${code}.` } };
    }
    if (method === 'DELETE') {
      await store.del(code);
      return { status: 204, body: null };
    }
    return { status: 405, body: { error: 'Method not allowed' } };
  }

  if (parts.length === 4 && parts[3] === 'answer') {
    const r = await live(code);
    if (!r) return { status: 404, body: { error: `No room called ${code}.` } };
    if (method === 'GET') return r.answer ? { status: 200, body: { answer: r.answer } } : { status: 204, body: null };
    if (method === 'POST') {
      if (!validDesc(body && body.answer, 'answer')) return { status: 400, body: { error: 'Missing answer' } };
      if (r.answer) return { status: 409, body: { error: 'Somebody already joined that room.' } };
      await store.set(code, { ...r, answer: body.answer });
      return { status: 200, body: { ok: true } };
    }
    return { status: 405, body: { error: 'Method not allowed' } };
  }
  return { status: 404, body: { error: 'Not found' } };
}

// In-memory store for the Node server and tests.
export function memoryStore() {
  const m = new Map();
  return {
    get: (k) => m.get(k) || null,
    set: (k, v) => void m.set(k, v),
    del: (k) => void m.delete(k),
    sweep: (now = Date.now()) => {
      for (const [k, v] of m) if (now - v.t > ROOM_TTL_MS) m.delete(k);
    },
    size: () => m.size,
  };
}
