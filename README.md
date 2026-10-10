# College Blitz (working title)

Arcade 7-on-7 college football for the PC, built to feel like the early-2000s console arcade
football games: **1st & 30, no flags, no mercy.** This is the first playable mockup:
**Indiana** (red/white) vs **Michigan** (blue/yellow) — states only, no school branding.

- Play **vs CPU** in any modern desktop browser (keyboard or gamepad).
- Play **online, head-to-head** through a small Node server with room codes.

Design notes, rules and the networking model live in [`docs/DESIGN.md`](docs/DESIGN.md).

## Quick start

Requires Node.js 20.19+ (or 22.12+).

```bash
npm install
npm run dev        # http://localhost:5173  — play vs CPU
```

Single file you can double-click (vs CPU, works offline):

```bash
npm run build      # -> dist/index.html (~1 MB, everything inlined)
```

## Online head-to-head

The server runs the game simulation for both players and also serves the game page.

```bash
npm run build
npm start          # http://localhost:8787  (WebSocket on /ws)
```

1. Player 1 opens the page, picks **PLAY ONLINE → CREATE GAME** and gets a 4-letter room code.
2. Player 2 opens the same address and picks **JOIN GAME** with the code, or uses the invite link (`?join=CODE`).
3. The host picks the team and game length; both press **READY**.

For two people on different networks, deploy the server anywhere that runs Node with WebSockets
(Render, Railway, Fly.io, a VPS…): build command `npm install && npm run build`, start command
`npm start`, and the platform's `PORT` is picked up automatically. Both players then open that URL.
A page served from somewhere else can point at a server with `?server=wss://your-host/ws`.

While developing, run `npm run server` and `npm run dev` together — Vite proxies `/ws` to the server.

## Controls

| | Keyboard | Alt keys | Gamepad |
|---|---|---|---|
| Move | W A S D | Arrows | Left stick / D-pad |
| Pass · Snap · Switch player | J or Space | C | A |
| Jump · Hurdle · Dive | K | X | B / X |
| Turbo (hold) | L or Shift | Z | RT / RB / Y |
| Pause / menu | Esc or P | | Start |

- **QB:** hold the stick toward a receiver (a red marker shows the target) and press Pass. Turbo + Pass = bullet.
- **Ball carrier:** Turbo + Jump = spin, Pass = stiff-arm, Jump = hurdle.
- **Defense:** Pass switches to the defender nearest the ball, Turbo + Jump = dive tackle, Jump = leap for the ball.
- Late hits after the whistle are legal.

## Rules (arcade)

- 7 players a side, **4 downs to gain 30 yards** (25 or 10 selectable for vs CPU).
- No penalties. Ball always spotted in the middle of the field.
- TD 6, kick for 1 or go for 2 from the 3, FG 3, safety 2. Kickoffs and punts are live.
- 3 straight completions or 2 straight sacks put a team **ON FIRE** (unlimited turbo).
- Tied after regulation → college overtime from the 25.

## Project layout

```
src/sim/      game engine (pure JS, runs in the browser and on the server)
src/render/   Three.js: field, stadium, procedural players, effects, camera
src/ui/       menus, HUD, play select (route diagrams drawn from the playbook)
src/audio/    procedural Web Audio (no sound files) + optional TTS announcer
src/net/      local session (vs CPU) and online session (WebSocket client)
server/       Node + ws: rooms, lobby, authoritative 60 Hz match, 30 Hz snapshots
test/         headless CPU-vs-CPU regression tests (npm test)
```

Every texture (field paint, crowd, numbers, state outlines) and every sound is generated at
runtime, so there are no art or audio assets to license.

## Known limitations of the mockup

- Online uses server-authoritative play with interpolation; there's no client-side prediction yet,
  so the controlled player feels a little delayed above ~100 ms ping.
- Players are built from primitive shapes, and animations are procedural.
- Two teams and 21 offensive / 9 defensive plays.
