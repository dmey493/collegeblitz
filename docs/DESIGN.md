# College Blitz — Design Notes (Mockup v0.1)

Working title taken from the repo name. Goal: a PC arcade college-football game that
plays and *looks* like the early-2000s console arcade football games (GameCube era),
with online head-to-head for two players.

Teams in the mockup are states only — **INDIANA** (red / white) and **MICHIGAN**
(blue / yellow). No university names, mascots, logos or real player names (college
football games traditionally show numbers only, which also keeps us clear of
likeness issues).

---

## 1. Core loop

| | |
|---|---|
| **Verb** | Run, throw, hit. Every few seconds the player is steering one athlete at full speed and deciding *throw now / juke / dive*. |
| **Loop** | Pick a play (≤ 10 s) → snap → 3–8 s of chaos → big result text → next down. |
| **Tension** | **1st & 30** with 4 downs, a pass rush that gets home in ~3 s, a running game clock, and a human opponent picking plays blind against you. |
| **Escalation** | Score race + clock; "ON FIRE" streaks (3 straight completions / 2 straight sacks) give unlimited turbo until the other side answers. |
| **Session** | 4 quarters × 2:00 of game clock ≈ 12–15 minutes real time. Rematch is one button. |
| **Failure** | Sacks, picks and fumbles are the most spectacular moments: big hits launch players, freeze-frame, shake, crowd "OOOH". |

## 2. Rules (arcade, not NCAA)

* 7-on-7. Offense: QB, C, 2 G, 2 WR, RB. Defense: 2 DL, 2 LB, 2 CB, S.
* **4 downs to gain 30 yards** (25 selectable in settings).
* No penalties. Late hits after the whistle are allowed (the controlled player keeps moving for ~1.5 s).
* Ball is always re-spotted in the middle of the field.
* Passes: one forward pass, from behind the line of scrimmage. Turbo + pass = bullet pass.
* Scoring: TD 6, PAT kick 1 or go for 2 from the 3, FG 3, safety 2.
* Kickoffs from the 35 with live returns; punts and field goals selectable on 4th down.
* College touches: white-striped ball, orange pylons, college hash marks, numbers only on jerseys,
  touchback to the 25.
* Clock runs only while the ball is live, plus a short run-off after in-bounds tackles.

## 3. Controls

Screen-relative (up = away from camera; the camera always sits behind the offense like the originals).

| Action | Keyboard (A) | Keyboard (B) | Gamepad |
|---|---|---|---|
| Move | W A S D | Arrow keys | Left stick / D-pad |
| Pass / Snap / Switch player | J or Space | C | A |
| Jump / Hurdle / Dive | K | X | B or X |
| Turbo (hold) | L or Shift | Z | RT / RB / Y |
| Pause | Esc / P | | Start |

Context moves: ball carrier **Turbo+Jump = spin**, **Pass = stiff-arm**, **Jump = hurdle**.
Defender **Turbo+Jump = dive tackle**, **Jump = leap for the ball**, **Pass = switch to the man nearest the ball**.
The QB throws to the receiver in the direction you hold (a target marker shows who).

## 4. Art direction ("GameCube night game")

* Night stadium under 4 light towers; saturated turf with mowing stripes, crisp white paint,
  team-colored end zones with the state names, midfield state silhouette.
* Chunky, glossy players: oversized shoulder pads and helmets, team-colored jerseys with
  numbers front and back, specular helmets (environment-mapped).
* Big italic chrome text for every result ("FIRST DOWN!", "INTERCEPTED!", "TOUCHDOWN!").
* Palette: team colors + near-black UI (`#0B0D12`), chrome/steel gradients, flame orange `#FF6A00`
  and gold `#FFD23F` reserved for "hot" states (fire, big plays).
* One font family: **Kanit** (900 italic for headlines, 600 for UI).

## 5. Audio identity

* **World:** a packed college stadium at night — crowd roar, pads cracking, ref whistles, brass stabs.
* **Timbre family:** mechanical/impact (pad cracks = noise bursts + low thumps); brass-ish saw
  stabs as the musical accent.
* **Key:** E minor pentatonic (E G A B D) — all stingers and UI ticks use these notes.
* **Success motif:** rising E–G–B–E brass stab (first downs: short version; touchdowns: full fanfare).
* **Failure motif:** the same notes descending B–G–E into a low thud (turnovers).
* **Signature sound:** the big-hit "CRACK" followed by a crowd "OOOH".
* **Music:** menus get a driving 140 BPM synth-rock loop; in-game is crowd ambience only.
* Optional text-to-speech announcer for the big calls (toggle in settings).

## 6. Architecture

```
src/sim/      Pure JavaScript game engine (no DOM, no Three.js). Rules, physics,
              AI, match flow. Runs in the browser (vs CPU) AND on the server (online).
src/render/   Three.js renderer that draws whatever snapshot it is given.
src/ui/       DOM screens + HUD.
src/audio/    Procedural Web Audio (no audio files).
src/net/      Local host (vs CPU) and WebSocket client (online) — same interface.
server/       Node + ws: rooms with 4-letter codes, runs the authoritative Match at 60 Hz.
test/         Headless CPU-vs-CPU games for regression + balance numbers.
```

### Online model: authoritative server

1. Player A clicks **Online → Create**; the server makes a room and returns a code (e.g. `KQZX`).
2. Player B enters the code (or opens the invite link `?join=KQZX`).
3. A picks the team & settings, both press Ready; the server starts a `Match`.
4. Clients send input (stick + buttons, ~60 Hz) and discrete commands (play picks, PAT choice).
5. The server steps the simulation at 60 Hz and broadcasts compact snapshots at 30 Hz.
6. Clients render ~70 ms in the past and interpolate between snapshots; sound/text events
   are played when their snapshot is reached.
7. If a player disconnects, the CPU takes over their team so the other player can finish.

Why not peer-to-peer lockstep: browser float math is not guaranteed identical across engines,
and a server avoids NAT/firewall problems. The same sim code runs on both ends, so adding
client-side prediction for your own player later is straightforward.

## 7. Roadmap after the mockup

1. Feel pass with the user: speeds, pass rush timing, turbo, hit frequency.
2. Client-side prediction for the controlled player (online feel at 100+ ms ping).
3. More teams (state list), uniforms editor, more plays per page, audibles, onside kicks.
4. Couch versus (2 gamepads on one PC), 2v2 online.
5. Desktop packaging (Electron/Tauri) and a hosted server for matchmaking.
