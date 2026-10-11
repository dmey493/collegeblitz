// Netlify Function: matchmaking for peer-to-peer online play. Rooms live in Netlify Blobs
// for a few minutes, just long enough for two browsers to swap connection details.
// The logic (and the API) is shared with the Node server: see src/net/signal-api.js.
import { getStore } from '@netlify/blobs';
import { handleSignal } from '../../src/net/signal-api.js';

const json = (status, body) =>
  body === null
    ? new Response(null, { status, headers: { 'cache-control': 'no-store' } })
    : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req) => {
  let body = null;
  if (req.method === 'POST') {
    const text = await req.text();
    if (text.length > 64 * 1024) return json(413, { error: 'Too large' });
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'Bad JSON' });
    }
  }
  const blobs = getStore({ name: 'college-blitz-rooms', consistency: 'strong' });
  const store = {
    get: (k) => blobs.get(k, { type: 'json' }),
    set: (k, v) => blobs.setJSON(k, v),
    del: (k) => blobs.delete(k),
  };
  try {
    const out = await handleSignal({ method: req.method, path: new URL(req.url).pathname, body, store, env: process.env });
    return json(out.status, out.body);
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Matchmaking is unavailable right now.' });
  }
};

export const config = { path: ['/api/ice', '/api/rooms', '/api/rooms/*'] };
