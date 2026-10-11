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
