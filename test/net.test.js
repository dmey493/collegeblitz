// Matchmaking API and the shared game room, without any network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSignal, memoryStore, ROOM_TTL_MS } from '../src/net/signal-api.js';
import { Hub } from '../src/net/room.js';
import { inputMessage } from '../src/net/wire.js';

const offer = { type: 'offer', sdp: 'v=0 offer' };
const answer = { type: 'answer', sdp: 'v=0 answer' };

test('matchmaking: create, fetch, answer, pick up, delete', async () => {
  const store = memoryStore();
  const call = (method, path, body, now) => handleSignal({ method, path, body, store, now });
  const made = await call('POST', '/api/rooms', { offer });
  assert.equal(made.status, 201);
  const { code } = made.body;
  assert.match(code, /^[A-Z]{4}$/);
  assert.deepEqual((await call('GET', `/api/rooms/${code}`)).body, { offer, answered: false });
  assert.equal((await call('GET', `/api/rooms/${code}/answer`)).status, 204);
  assert.equal((await call('POST', `/api/rooms/${code}/answer`, { answer })).status, 200);
  assert.equal((await call('POST', `/api/rooms/${code}/answer`, { answer })).status, 409, 'only one guest');
  assert.deepEqual((await call('GET', `/api/rooms/${code}/answer`)).body, { answer });
  assert.equal((await call('DELETE', `/api/rooms/${code}`)).status, 204);
  assert.equal((await call('GET', `/api/rooms/${code}`)).status, 404);
});

test('matchmaking: rejects junk and expires old rooms', async () => {
  const store = memoryStore();
  const call = (method, path, body, now) => handleSignal({ method, path, body, store, now });
  assert.equal((await call('POST', '/api/rooms', { offer: { type: 'answer', sdp: 'x' } })).status, 400);
  assert.equal((await call('POST', '/api/rooms', { offer: { type: 'offer', sdp: 'x'.repeat(30000) } })).status, 400);
  assert.equal((await call('GET', '/api/rooms/abc')).status, 400);
  assert.equal((await call('GET', '/api/rooms/ZZZZ')).status, 404);
  const t0 = Date.now();
  const { code } = (await call('POST', '/api/rooms', { offer }, t0)).body;
  assert.equal((await call('GET', `/api/rooms/${code}`, null, t0 + ROOM_TTL_MS + 1)).status, 404);
  const ice = await handleSignal({ method: 'GET', path: '/api/ice', store, env: { TURN_URLS: 'turn:a:3478, turns:b:5349', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'p' } });
  const turn = ice.body.iceServers.find((s) => s.username);
  assert.deepEqual(turn, { urls: ['turn:a:3478', 'turns:b:5349'], username: 'u', credential: 'p' });
});

test('room hub: two players create, join, ready up and play', async () => {
  let ticks = null;
  const hub = new Hub({ roomOptions: { ticker: (fn) => ((ticks = fn), () => (ticks = null)) } });
  const inbox = [[], []];
  const conns = [0, 1].map((i) => hub.connect((text) => inbox[i].push(JSON.parse(text))));
  hub.message(conns[0], { t: 'create', name: 'host' });
  const code = inbox[0].find((m) => m.t === 'room').code;
  hub.message(conns[1], { t: 'join', code, name: 'guest' });
  assert.equal(inbox[1].find((m) => m.t === 'room').slot, 1);
  hub.message(conns[0], { t: 'lobby', team: 'MICH', rules: { quarterSec: 60, fdYards: 25 } });
  hub.message(conns[0], { t: 'ready', ready: true });
  hub.message(conns[1], { t: 'ready', ready: true });
  const start = inbox[1].find((m) => m.t === 'start');
  assert.ok(start, 'game starts when both are ready');
  assert.equal(start.you, 1);
  assert.deepEqual(start.info.teams, ['MICH', 'IND']);
  assert.equal(start.info.rules.quarterSec, 60);
  // run a few seconds of game through the room's clock
  const room = conns[0].room;
  const input = { mx: 0, my: 1, turbo: true, a: 0, j: 0, s: 0, c0: 0, c1: 0, c2: 0, pm: 'icons' };
  for (let k = 0; k < 200; k++) {
    hub.message(conns[1], inputMessage(input));
    room.stopLoop && ticks && ticks();
    await new Promise((r) => setTimeout(r, 2));
  }
  const snaps = inbox[0].filter((m) => m.t === 's');
  assert.ok(snaps.length > 5, 'snapshots stream to the players');
  // the guest leaves mid-game: the CPU takes over and the host keeps playing
  hub.disconnect(conns[1]);
  assert.ok(inbox[0].some((m) => m.t === 'left' && m.slot === 1));
  assert.equal(room.match.human[1], false);
  hub.disconnect(conns[0]);
  assert.equal(hub.rooms.size, 0, 'empty rooms close');
});
