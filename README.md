# College Blitz (working title)

Arcade 7-on-7 college football for the PC, built to feel like the early-2000s console arcade
football games: **1st & 30, no flags, no mercy.** This is a playable mockup:
**Indiana** (red/white) vs **Michigan** (blue/yellow). It uses state names only, no school branding.

- Play **vs CPU** in any modern desktop browser (keyboard or gamepad).
- Play **online, head-to-head**: one player hosts the game in their browser and the other connects
  straight to them. It deploys to **Netlify** as a static site plus one tiny function.

Design notes, rules and the networking model live in [`docs/DESIGN.md`](docs/DESIGN.md).

## Quick start

Requires Node.js 20.19+ (or 22.12+).

```bash
npm install
npm run dev        # http://localhost:5173: play vs CPU
npm test           # headless engine, controls and matchmaking tests
```

Single file you can double-click (vs CPU, works offline):

```bash
npm run build      # -> dist/index.html (~1 MB, everything inlined)
```

## Deploy to Netlify (recommended)

The repo is ready to go: [`netlify.toml`](netlify.toml) builds the game and deploys the
matchmaking function in [`netlify/functions/rooms.mjs`](netlify/functions/rooms.mjs), which
stores rooms in Netlify Blobs for a few minutes.

1. Push the repo to GitHub and in Netlify choose **Add new site → Import an existing project**.
2. Netlify reads the settings from `netlify.toml` (build `npm run build`, publish `dist`,
   functions `netlify/functions`, Node 22). Nothing else to configure.
3. Open the site: **PLAY ONLINE → CREATE GAME** gives you a 4-letter code and an invite link.
   Your friend opens the link (or enters the code under **JOIN GAME**), you both press **READY**.

To try the Netlify setup locally, use `npx netlify dev`.

### How online play works

There is no game server. Whoever creates the game is the **host**: their browser runs the
authoritative match (the same room code the Node server uses) and streams it to the other
player over a WebRTC data channel at 30 snapshots a second. The Netlify function only swaps the
two browsers' connection details:

- the host posts a connection offer and gets a room code,
- the guest trades the code for the offer and posts an answer,
- the host picks up the answer, and the browsers then talk to each other directly.

Things to know:

- **The host keeps the tab open.** The game runs there. It keeps running if the host switches
  tabs, but closing the tab ends it. If the guest drops, the CPU takes over their team.
- **Some networks block direct connections** (strict corporate or campus firewalls, some mobile
  carriers). Most home networks are fine with the public STUN servers the game uses. If players
  see *"Couldn't connect directly"*, add a TURN relay (for example from Cloudflare, Twilio or
  Metered) by setting these environment variables in Netlify: `TURN_URLS` (comma separated, e.g.
  `turn:turn.example.com:3478,turns:turn.example.com:5349`), `TURN_USERNAME`, `TURN_CREDENTIAL`.
  The function hands them to the browsers at `/api/ice`.
- The host has a small latency edge (no network hop); the guest's view runs about one
  round trip behind.

### Optional: your own game server

`npm start` runs a Node server that serves the built game, the same matchmaking API (so direct
play works when you self-host), and server-hosted rooms over WebSocket:

```bash
npm run build
npm start          # http://localhost:8787
```

In **PLAY ONLINE**, set **CONNECTION** to **GAME SERVER** to have the server run the match for
both players instead of the host's browser. That needs a host with WebSockets (Render, Railway,
Fly.io, a VPS…; the platform's `PORT` is picked up automatically). A page served from somewhere
else can point at a server with `?server=wss://your-host/ws`.

While developing, run `npm start` and `npm run dev` together: Vite proxies `/api` and `/ws` to it.

## Controls

One hand steers and the other hand has every button. There are no two-button combos. Pick the
layout under **SETTINGS → CONTROLS** (or on the vs-CPU setup screen).

| | Arrows layout (default) | WASD layout | Gamepad |
|---|---|---|---|
| Move | Arrow keys | W A S D | Left stick / D-pad |
| Turbo (hold) | Space or Shift | Space or Shift | RT / RB |
| Pass · Switch player · Stiff-arm | F | J | A |
| Jump · Hurdle | D | K | B |
| Spin · Dive | S | L | X |
| Snap / kick | any of the three | any of the three | A / B / X |
| Throw to a receiver | S / D / F | J / K / L | X / A / B |
| Pause / menu | Esc or P | Esc or P | Start |

- **QB (receiver keys, the default):** every receiver wears a key icon, laid out left to right like
  the keys. Press a receiver's key to throw to him. Hold turbo for a bullet. Set **PASSING → AIM +
  PASS** for the classic style: steer toward a receiver to highlight him, then press Pass.
- **Ball carrier:** Spin to juke, Pass to stiff-arm, Jump to hurdle.
- **Receiver with the ball in the air:** Jump to go up for it, Spin to dive for it (a diving catch is
  down where it lands).
- **Defense:** Pass switches to the defender nearest the ball, Jump to swat, Spin for a dive tackle.
- Late hits after the whistle are legal.

## Rules (arcade)

- 7 players a side, **4 downs to gain 30 yards** (25 or 10 selectable for vs CPU).
- No penalties. Ball always spotted in the middle of the field.
- TD 6, kick for 1 or go for 2 from the 3, FG 3, safety 2. Kickoffs and punts are live.
- 3 straight completions or 2 straight sacks put a team **ON FIRE** (unlimited turbo).
- Tied after regulation → college overtime from the 25.

## Project layout

```
src/sim/            game engine (pure JS, runs in the browser and on the server)
src/render/         Three.js: field, stadium, skinned procedural players, effects, camera
src/ui/             menus, HUD, play select (route diagrams drawn from the playbook)
src/audio/          procedural Web Audio (no sound files) + optional TTS announcer
src/net/            sessions: local (vs CPU), online client, shared game rooms,
                    WebRTC peer-to-peer, matchmaking API
netlify/functions/  matchmaking function for Netlify (Blobs-backed)
server/             optional Node server: static files, matchmaking, WebSocket rooms
test/               headless engine, controls and networking tests (npm test)
```

Every texture (uniforms, helmets, field paint, crowd, state outlines), every player model and
every sound is generated at runtime, so there are no art or audio assets to license.

## Known limitations of the mockup

- No client-side prediction yet, so the guest's player feels a little delayed above ~100 ms ping.
- Animation is procedural posing rather than motion capture.
- Two teams, 21 offensive and 9 defensive plays.
