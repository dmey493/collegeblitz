// Headless regression tests for the game engine: no DOM, no graphics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/sim/match.js';
import { OFF_PLAYS, DEF_PLAYS } from '../src/sim/playbook.js';

function runGame(seed, opts = {}) {
  const m = new Match({ teams: ['IND', 'MICH'], humans: [false, false], seed, ...opts });
  let steps = 0;
  let playSteps = 0;
  let lastPlay = 0;
  while (m.phase !== 'final' && steps < 60 * 60 * 90) {
    m.step(1 / 60);
    m.drainEvents();
    steps++;
    if (m.playNo !== lastPlay) {
      lastPlay = m.playNo;
      playSteps = 0;
    }
    if (m.phase === 'play') {
      playSteps++;
      assert.ok(playSteps < 60 * 40, `play ${m.playNo} (${m.play.kind}) never ended`);
    }
  }
  return m;
}

test('CPU vs CPU games run to a final whistle', () => {
  for (const seed of [11, 22, 33]) {
    const m = runGame(seed, { rules: { quarterSec: 90 } });
    assert.equal(m.phase, 'final');
    assert.ok(m.score[0] + m.score[1] > 0, 'somebody should score');
    assert.notEqual(m.score[0], m.score[1], 'overtime should break ties');
    const s = m.stats;
    assert.ok(s[0].passAtt + s[1].passAtt > 10);
  }
});

test('snapshots are plain JSON and carry 14 players during a play', () => {
  const m = new Match({ teams: ['IND', 'MICH'], humans: [true, false], seed: 5 });
  let sawPlay = false;
  for (let i = 0; i < 60 * 20; i++) {
    m.step(1 / 60);
    const snap = m.snapshot();
    const round = JSON.parse(JSON.stringify(snap));
    assert.deepEqual(round.sc, snap.sc);
    if (snap.pl && snap.pl.ph === 'live') {
      sawPlay = true;
      assert.equal(snap.pl.P.length, 14);
    }
  }
  assert.ok(sawPlay);
});

test('every offensive play runs against every defense without errors', () => {
  for (const o of OFF_PLAYS.filter((p) => !p.special)) {
    for (const d of DEF_PLAYS) {
      const m = new Match({ teams: ['MICH', 'IND'], humans: [false, false], seed: o.id.length * 31 + d.id.length });
      m.poss = 1;
      m.ballOn = 40;
      m.fdOn = 70;
      m.startPlay({ kind: 'scrimmage', off: 1, ballOn: 40, fdOn: 70, offPlayId: o.id, defPlayId: d.id });
      const play = m.play;
      let n = 0;
      while (!play.finished && n < 60 * 30) {
        m.step(1 / 60);
        n++;
      }
      assert.ok(play.finished, `${o.id} vs ${d.id} did not finish`);
      assert.ok(play.result && play.result.type, `${o.id} vs ${d.id} has no result`);
    }
  }
});

test('field goals, punts and PATs resolve', () => {
  for (const kind of ['fg', 'punt', 'pat']) {
    const m = new Match({ teams: ['IND', 'MICH'], humans: [false, false], seed: 9 });
    m.poss = 0;
    m.startPlay({ kind, off: 0, ballOn: kind === 'pat' ? 97 : 70, fdOn: 100 });
    const play = m.play;
    let n = 0;
    while (!play.finished && n < 60 * 30) {
      m.step(1 / 60);
      n++;
    }
    assert.ok(play.finished, `${kind} did not finish`);
  }
});

test('a tie at the end of regulation goes to overtime from the 25', () => {
  const m = new Match({ teams: ['IND', 'MICH'], humans: [false, false], seed: 4, rules: { quarterSec: 30 } });
  m.quarter = 4;
  m.clock = 1;
  m.score = [7, 7];
  let sawOT = false;
  for (let i = 0; i < 60 * 60 * 20 && m.phase !== 'final'; i++) {
    m.step(1 / 60);
    for (const e of m.drainEvents()) {
      if (e.k === 'banner' && e.lines.some((l) => l.includes('OVERTIME'))) sawOT = true;
    }
    if (m.ot && m.phase === 'playSelect') assert.ok(m.ballOn >= 75 || m.conversion || m.down > 1);
  }
  assert.ok(sawOT, 'expected an overtime banner');
  assert.equal(m.phase, 'final');
  assert.notEqual(m.score[0], m.score[1]);
});

test('human picks and two-point tries are honored', () => {
  const m = new Match({ teams: ['IND', 'MICH'], humans: [true, true], seed: 3 });
  m.startPatChoice(0);
  m.command(0, { type: 'pat', choice: 'two' });
  assert.equal(m.phase, 'playSelect');
  assert.equal(m.conversion, true);
  // specials are not allowed on a conversion
  m.command(0, { type: 'pick', id: 'fg' });
  assert.equal(m.picks[0], null);
  m.command(0, { type: 'pick', id: 'slants' });
  m.command(1, { type: 'pick', id: 'safe' });
  assert.equal(m.phase, 'play');
  assert.equal(m.play.kind, 'two');
});

// Drive one human-quarterbacked pass play; `act(play, press)` fires buttons by name.
function humanPassPlay(offPlayId, defPlayId, act, seed = 7) {
  const m = new Match({ teams: ['IND', 'MICH'], humans: [true, false], seed });
  m.poss = 0;
  m.ballOn = 30;
  m.startPlay({ kind: 'scrimmage', off: 0, ballOn: 30, fdOn: 60, offPlayId, defPlayId });
  const play = m.play;
  const inp = { mx: 0, my: 0, turbo: false, a: 0, j: 0, s: 0, c0: 0, c1: 0, c2: 0, pm: 'icons' };
  const press = (k) => inp[k]++;
  const events = [];
  for (let i = 0; i < 60 * 12 && !play.finished; i++) {
    act(play, press, inp);
    m.setInput(0, inp);
    m.step(1 / 60);
    events.push(...m.drainEvents());
  }
  return { m, play, events };
}

test('receiver icons go left to right and each key throws to its own receiver', () => {
  for (const [n, key] of [[0, 'c0'], [1, 'c1'], [2, 'c2']]) {
    let target = null;
    const { play, events } = humanPassPlay('curls', 'safe', (p, press) => {
      if (p.phase === 'presnap' && p.presnapT > 0.3 && !p.snapped) {
        p.snapped = true;
        press('s'); // any button snaps
      }
      if (p.phase === 'live' && p.liveT > 1.2 && !target) {
        target = p.icons[n];
        press(key);
      }
    });
    const xs = play.icons.filter((id) => id >= 0).map((id) => play.F(play.byId.get(id).home).dx);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'icons are ordered left to right');
    const thrown = events.find((e) => e.k === 'throw');
    assert.ok(thrown, `key ${key} should throw`);
    assert.equal(thrown.to, target);
  }
});

test('a single press snaps the ball and never also throws it', () => {
  const { events } = humanPassPlay('curls', 'safe', (p, press) => {
    if (p.phase === 'presnap' && p.presnapT > 0.3 && !p.snapped) {
      p.snapped = true;
      press('a');
      press('c2'); // the pass key doubles as the right-hand icon key
    }
  });
  assert.ok(events.some((e) => e.k === 'snap'));
  assert.ok(!events.some((e) => e.k === 'throw'), 'the snap press must not throw');
});

test('ball carriers spin with one button, no turbo combo', () => {
  const m = new Match({ teams: ['IND', 'MICH'], humans: [true, false], seed: 3 });
  m.poss = 0;
  m.ballOn = 30;
  m.startPlay({ kind: 'scrimmage', off: 0, ballOn: 30, fdOn: 60, offPlayId: 'blast', defPlayId: 'safe' });
  const play = m.play;
  const inp = { mx: 0, my: 1, turbo: false, a: 0, j: 0, s: 0, c0: 0, c1: 0, c2: 0 };
  let spun = false;
  for (let i = 0; i < 60 * 8 && !play.finished; i++) {
    if (play.phase === 'presnap' && play.presnapT > 0.3 && !play.snapped) {
      play.snapped = true;
      inp.j++;
    }
    if (play.phase === 'live' && play.ball.carrier === play.ctrl[0] && play.liveT > 1 && !play.spinPressed) {
      play.spinPressed = true;
      inp.s++;
      inp.c0++;
    }
    m.setInput(0, inp);
    m.step(1 / 60);
    if (m.drainEvents().some((e) => e.k === 'spin')) spun = true;
  }
  assert.ok(spun, 'the spin button spins the runner');
});

function livePlay(seed = 4) {
  const m = new Match({ teams: ['IND', 'MICH'], humans: [false, false], seed });
  m.poss = 0;
  m.ballOn = 30;
  m.startPlay({ kind: 'scrimmage', off: 0, ballOn: 30, fdOn: 60, offPlayId: 'blast', defPlayId: 'safe' });
  for (let i = 0; i < 60 * 6 && m.play.phase !== 'live'; i++) m.step(1 / 60);
  assert.equal(m.play.phase, 'live');
  return m;
}

test('leaps hang in the air like the arcade game', () => {
  const m = livePlay();
  const p = m.play.players.find((q) => q.slot === 'WR1' && q.team === 0);
  m.play.doJump(p);
  let top = 0;
  let air = 0;
  for (let i = 0; i < 120 && (p.y > 0 || p.vy > 0); i++) {
    m.play.integrate(p, 1 / 60);
    top = Math.max(top, p.y);
    air += 1 / 60;
  }
  assert.ok(top > 1.0 && top < 1.4, `leap height ${top}`);
  assert.ok(air > 0.7 && air < 0.95, `hang time ${air}`);
  assert.equal(p.state, 'stand');
});

test('a dive is a flying tackle: airborne, then a belly slide, then down', () => {
  const m = livePlay();
  const p = m.play.players.find((q) => q.slot === 'LB1' && q.team === 1);
  p.actCd = 0;
  m.play.doDive(p, p.x + 4, p.z);
  assert.equal(p.state, 'dive');
  const x0 = p.x;
  let air = 0;
  for (let i = 0; i < 60 && p.y > 0; i++) {
    m.play.integrate(p, 1 / 60);
    air += 1 / 60;
  }
  assert.ok(air > 0.35 && air < 0.5, `flight ${air}`);
  assert.ok(p.x - x0 > 3, `covers ground in the air (${p.x - x0})`);
  assert.equal(p.state, 'dive', 'still sliding after the belly-flop');
  for (let i = 0; i < 60 && p.state === 'dive'; i++) m.play.integrate(p, 1 / 60);
  assert.equal(p.state, 'down');
});

test('CPU games are full of leaping catches and flying tackles', () => {
  const m = new Match({ teams: ['IND', 'MICH'], humans: [false, false], seed: 8, rules: { quarterSec: 90 } });
  const count = {};
  for (let i = 0; i < 60 * 60 * 40 && m.phase !== 'final'; i++) {
    m.step(1 / 60);
    for (const e of m.drainEvents()) count[e.k] = (count[e.k] || 0) + 1;
  }
  assert.ok((count.jump || 0) >= 5, `leaps: ${count.jump}`);
  assert.ok((count.dive || 0) >= 10, `dives: ${count.dive}`);
});
