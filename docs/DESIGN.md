# College Blitz — Design Notes (Mockup v0.3)

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
Keyboard rule: **one hand steers, the other hand has every button, no two-button combos**
(the old Turbo+Jump spin and dive were impossible with the arrows on the right-hand side).

| Action | Arrows layout (default) | WASD layout | Gamepad |
|---|---|---|---|
| Move | Arrow keys | W A S D | Left stick / D-pad |
| Turbo (hold) | Space / Shift (thumb) | Space / Shift | RT / RB |
| Pass · switch player · stiff-arm | F (index) | J (index) | A |
| Jump · hurdle | D (middle) | K (middle) | B |
| Spin · dive | S (ring) | L (ring) | X |
| Snap / kick | any of the three | any of the three | A / B / X |
| Pause | Esc / P | Esc / P | Start |

**Passing:** by default every route runner wears a key icon (S D F / J K L / X A B), assigned
left to right as the offense sees them so the keys match the screen. Pressing a receiver's key
throws to him; turbo makes it a bullet. Two receivers take the outside keys, a lone receiver
answers to any key. The classic *aim + pass* style (steer toward a receiver, press Pass) is a
setting. A press made while the snap is still in the air is held until the QB has the ball.

Context moves: ball carrier **Spin = spin move**, **Pass = stiff-arm**, **Jump = hurdle**.
Receiver: **Jump** to go up for the ball (with a pass in the air the leap is sized so its top
meets the ball), **Spin = diving catch** (paced to meet the ball; down where you land).
Defender: **Spin = flying tackle** (homes in on a runner ahead of you, up to ~5 yards out),
**Jump = leap for the ball**, **Pass = switch to the man nearest the ball**. With nobody
steering, the human QB takes his drop automatically.

### Movement ("move like the arcade game")

* Players hang in the air longer than the ball does (their own gravity): a full leap goes about
  1.15 yards up with 0.8 s of hang time and keeps the run-up's momentum (little air steering).
* CPU receivers look ahead for a leap whose apex meets the ball and take nearly every high or
  contested one; lobs and throws into coverage are put up high so they have to. Defenders go up
  to contest. A receiver who is a step short lays out for it. A receiver hit in the air gets
  blown up.
* Dives are flying tackles: launched at where the runner will be, about 0.44 s flat out in the
  air, then a belly slide. A miss costs the diver ~1.5 s on the ground; a runner can still
  break a diving arm tackle, spin out of it or hurdle it.
* Running is motion-captured: jog, run and fast-run cycles measured from the CMU motion-capture
  database (thigh swing, knee fold, foot plant, arm swing, elbow bend, lean, shoulder and hip
  counter-rotation, pelvis roll, hip bounce) and blended by speed, then pushed further at the
  game's sprint and turbo speeds (longer stride, higher heel kick, harder arm pump). Stride
  length grows with speed as it does for real sprinters. Side shuffles are a captured defensive
  shuffle (low and wide, step out and close; mirrored going left), backpedals are the captured
  jog run backwards (short quick steps, hips low, chest over the knees),
  and all of them are blended from the body-relative velocity, the body leans into cuts, and leaps, layouts, flying
  tackles, big-hit tumbles and falls have dedicated motions. Getting up is motion-captured too:
  a push-up off the turf face down, or a sit-up and roll to the knees from the back.
* Leaps and hurdles use captured running leaps (one knee driving up, the trail leg kicking back,
  the right or left knee leading by player), stretched over each leap's own time in the air.
* Acrobatics vary: a leap is a two-handed high-point, a one-handed stab with the body twisting
  to the ball and the legs scissoring, or a sky-high grab with the heels tucked; the shoulders
  and eyes turn to a ball coming over a shoulder. Layouts are two-handed or one-handed on the
  side; flying tackles go in arms-wide or shoulder-first. The man who lays a big hit or gets a
  sack flexes or points down at his victim after the whistle.
* The feel is tunable for vs-CPU games (match rules `hang`, `dives`, `pace`): hang time scales
  leaps and dives at the same height (gravity / h², takeoff speed / h), dives scales how often
  CPU defenders lay out, pace scales every player's top speed and acceleration.
* No flags, like the arcade original: any time a pass is in the air, a defender who dives into
  the intended receiver, or a human-controlled defender who runs through him on turbo, flattens
  him (a receiver in the air is blown up) and the ball sails on, incomplete or there to be
  picked off. Before the throw, contact only bumps. CPU defenders breaking on the ball dive at
  the receiver in the last 0.9 s (CPU_HIT_TIME) when they can't make a play on the ball (scaled
  by the CPU DIVES dial).
* Regular tackles are wrap-ups: the tackler latches on and both go down together the way he was
  driving, him on top. Blockers and rushers lock up with their hands on each other.
* The camera rides a pass out, moves in tight on the catch and stays tight on the runner; after
  a turnover or on a return it cuts around behind the new ball carrier, and the controls turn
  with it (the play owns one view direction that both use), so up is always up the screen.
* Leaps and dives whoosh, a flying tackle that connects gets a beat of hit-stop and a turf spray,
  and catches made in the air or laid out get a crowd reaction, a call and a callout.

## 4. Art direction ("GameCube night game")

* Night stadium under 4 light towers; saturated turf with mowing stripes, crisp white paint,
  team-colored end zones with the state names, midfield state silhouette.
* Bulky, larger-than-life players built to the proportions of the early-2000s arcade models:
  long legs and a small helmet sunk between wide, flat-topped shoulder pads (part of the torso,
  the jersey stretched over them), a deep chest that V-tapers to the belt, big arms with huge
  forearms and painted muscle, gloves with fingers, tight pants over thigh and knee pads,
  ribbed socks over taped ankles, high-top studded cleats and a face inside the helmet, all drawn
  1.3x larger than life (PLAYER_SCALE; the game's positions and jump heights are unchanged) and
  framed by a low camera that stays close to the action so they fill the screen. One
  skinned mesh each (17 bones, ~14k triangles). Uniform texture atlas per player (block
  numbers with an outline and drop shadow, mesh knit, sleeve stripes and ribbed cuffs, belt,
  pants stripes, laces); clear-coated helmets with stripe and state decal, cage masks for
  linemen, two-bar masks for skill players, optional visors.
* Grit over gloss: hard night lighting with stadium-light glints in the helmets, a film finish
  (grain, vignette, contrast grade, bloom on real highlights only), chewed-up turf with dirt down
  the hashes, and uniforms that pick up grass stains, mesh-knit relief, wrinkles and cracked
  block numbers. Linemen get dirtier than receivers.
* HUD and menus are brushed gunmetal plates with steel rims and rivets: down & distance lives on
  a plate in the top-left corner ("2ND & 3"), the score in recessed windows, a segmented turbo
  meter. Big italic chrome text for every result ("FIRST DOWN!", "INTERCEPTED!", "TOUCHDOWN!").
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
src/net/      Sessions with one interface: local (vs CPU) and online. Shared game rooms
              (room.js), WebRTC peer-to-peer (p2p.js), matchmaking API (signal-api.js).
netlify/      Matchmaking function for Netlify, rooms kept in Netlify Blobs.
server/       Optional Node server: static files, matchmaking, WebSocket rooms.
test/         Headless CPU-vs-CPU games for regression + balance numbers.
```

### Online model: authoritative host, peer-to-peer

Hosting target is Netlify (static files + functions, no long-running servers), so the game
runs on one player's machine:

1. Player A clicks **Online → Create**. A's browser makes a WebRTC offer (ICE gathered up
   front, public STUN, optional TURN from env vars) and posts it to `/api/rooms`, getting a
   4-letter code (e.g. `KQZX`). The Netlify function keeps it in Netlify Blobs for 15 minutes.
2. Player B enters the code (or opens the invite link `?join=KQZX`), fetches the offer, posts
   an answer; A polls for it. The browsers connect directly and the record is deleted.
3. A's browser runs a **room**: the exact same lobby / ready / match / rematch code the Node
   server uses (`src/net/room.js`). A plays through an in-page loopback; B through the data
   channel. A picks team and settings, both press Ready.
4. Clients send input (stick + press counters, ~10 Hz plus on change) and discrete commands
   (play picks, PAT choice). The host steps the simulation at 60 Hz on a worker-driven clock
   (keeps running in a background tab) and sends compact snapshots at 30 Hz.
5. Clients render slightly in the past (host ~35 ms, guest 70–220 ms depending on jitter) and
   interpolate; sound/text events fire when their snapshot is reached.
6. Heartbeats both ways: if the guest goes quiet the CPU takes over their team; if the host
   goes quiet the guest is told the game ended.

The optional Node server offers the same rooms over WebSocket ("GAME SERVER" mode), which
avoids NAT problems entirely and keeps both players equal on latency.

Why not lockstep: browser float math is not guaranteed identical across engines, so one side
owns the simulation. The same sim code runs everywhere, so client-side prediction for your own
player can be added later.

## 7. Roadmap after the mockup

1. Feel pass with the user: speeds, pass rush timing, turbo, hit frequency.
2. Client-side prediction for the controlled player (online feel at 100+ ms ping).
3. More teams (state list), uniforms editor, more plays per page, audibles, onside kicks.
4. Couch versus (2 gamepads on one PC), 2v2 online.
5. Desktop packaging (Electron/Tauri).
