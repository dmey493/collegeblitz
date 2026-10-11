// One live play: line-up, snap, the action, and the whistle.
// Pure logic — the renderer only ever reads the resulting snapshot.

import {
  HALF_W, GOAL, END, POST_Z, POST_HALF, CROSSBAR, GRAVITY, TURBO_MULT, TURBO_DRAIN, TURBO_REGEN,
  DEF_SLOTS, DIFFICULTY, TEAMMATE_LEVEL, dirOf,
  AIR_GRAVITY, JUMP_VY, HURDLE_VY, DIVE_VY, DIVE_AIR, DIVE_SLIDE, HIT_GRAVITY,
} from './constants.js';
import { clamp, lerp, len, dist, turnToward, angleOf, wrapAngle } from './math.js';
import { Player } from './player.js';
import { FORMATIONS, OL_SPOTS, DEF_BASE_ALIGN, getPlay } from './playbook.js';
import { runAI } from './ai.js';

export const BLOCK_JOBS = new Set([
  'passBlock', 'runBlock', 'leadBlock', 'screenBlock', 'drawBlock', 'stalk', 'returnBlock', 'puntBlock', 'fgBlock', 'leadPath',
]);
const SOLID_STATES = new Set(['stand', 'engaged', 'spin', 'stiff', 'jump', 'hurdle', 'throw', 'catch', 'stumble', 'stance', 'celebrate', 'kneel', 'kick']);
const TIMED_STATES = new Set(['spin', 'stiff', 'throw', 'catch', 'stumble', 'kick']);
// How long a press stays live. Receiver-icon presses wait longer so a throw pressed while the
// snap is still in the air goes out as soon as the quarterback has the ball.
const PRESS_WINDOW = 0.16;
const ICON_WINDOW = 0.35;
const newBuf = () => ({ a: 0, j: 0, s: 0, i: [0, 0, 0] });

export class Play {
  constructor(match, spec) {
    this.m = match;
    this.rng = match.rng;
    this.kind = spec.kind; // scrimmage | two | kickoff | punt | fg | pat
    this.off = spec.off;
    this.def = 1 - spec.off;
    this.dir = dirOf(spec.off);
    this.ballOn = spec.ballOn;
    this.losZ = this.dir * (spec.ballOn - 50);
    this.fdZ = spec.fdOn != null && spec.fdOn < 100 && this.kind === 'scrimmage' ? this.dir * (spec.fdOn - 50) : null;
    this.offPlay = spec.offPlayId ? getPlay(spec.offPlayId) : null;
    this.defPlay = spec.defPlayId ? getPlay(spec.defPlayId) : null;
    this.players = [];
    this.byId = new Map();
    this.slot = [{}, {}];
    this.ball = { state: 'dead', x: 0, y: 0.12, z: this.losZ, vx: 0, vy: 0, vz: 0, carrier: null, f: null, lastTeam: this.off, looseT: 0, kicked: false };
    this.phase = 'lineup';
    this.t = 0;
    this.liveT = 0;
    this.presnapT = 0;
    this.deadT = 0;
    this.deadDur = 2.2;
    this.poss = this.off;
    this.result = null;
    this.finished = false;
    this.clockRunning = false;
    this.passThrown = false;
    this.passer = null;
    this.carrierRunning = false;
    this.revealT = 0;
    this.ctrl = [null, null];
    this.target = [null, null];
    this.buf = [newBuf(), newBuf()];
    this.icons = null; // receiver ids wearing the left / middle / right pass icons
    this.blockTargets = new Map();
    this.nextBlockAssign = 0;
    this.kickInfo = null;
    this.lateHits = new Set();
    this.bigHit = false;
    this.fumbled = false;
    this.turnoverType = null;
    this.firstHolder = null;
    this.handedOff = false;
    this.lastTackle = null;
    this.cpuSnapAt = this.rng.range(0.55, 1.5);
    this.setup();
  }

  // ------------------------------------------------------------- frames
  W(dx, dz) {
    return { x: -this.dir * dx, z: this.losZ + this.dir * dz };
  }

  F(pt) {
    return { dx: -this.dir * pt.x, dz: (pt.z - this.losZ) * this.dir };
  }

  levelFor(team) {
    return this.m.human[team] ? DIFFICULTY[TEAMMATE_LEVEL] : DIFFICULTY[this.m.difficulty] || DIFFICULTY.varsity;
  }

  emit(e) {
    this.m.emit(e);
  }

  // ------------------------------------------------------------- setup
  setup() {
    const T = this.m.teams;
    const mk = (team, slot) => {
      const p = new Player(team, T[team], slot);
      p.lvl = this.levelFor(team);
      p.react = p.lvl.react * this.rng.range(0.8, 1.35);
      this.players.push(p);
      this.byId.set(p.id, p);
      this.slot[team][slot] = p;
      return p;
    };
    const o = this.off;
    const d = this.def;
    if (this.kind === 'scrimmage' || this.kind === 'two') {
      for (const s of ['QB', 'C', 'LG', 'RG', 'WR1', 'WR2', 'RB']) mk(o, s);
      for (const s of DEF_SLOTS) mk(d, s);
      this.placeScrimmage();
      this.rbStays = this.backStaysIn();
      this.icons = this.assignIcons();
    } else if (this.kind === 'punt') {
      for (const s of ['K', 'C', 'LG', 'RG', 'WR1', 'WR2', 'RB']) mk(o, s);
      for (const s of DEF_SLOTS) mk(d, s);
      this.placePunt();
    } else if (this.kind === 'fg' || this.kind === 'pat') {
      for (const s of ['K', 'QB', 'C', 'LG', 'RG', 'WR1', 'RB']) mk(o, s);
      for (const s of DEF_SLOTS) mk(d, s);
      this.placeFG();
    } else if (this.kind === 'kickoff') {
      for (const s of ['K', 'DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2']) mk(o, s);
      for (const s of ['WR1', 'RB', 'WR2', 'LB1', 'LB2', 'S', 'DL1']) mk(d, s);
      this.placeKickoff();
    }
    this.initControl();
  }

  // The back stays in to pick up a blitz when the defense sends more than the line can block.
  backStaysIn() {
    const P = this.offPlay;
    if (!P || P.type !== 'pass' || P.screen || !P.routes.RB || !this.defPlay) return false;
    const rushers = DEF_SLOTS.filter((sl) => this.defPlay.a[sl].t === 'rush').length;
    return rushers > 3 && Math.abs(this.F(this.slot[this.off].RB.home).dx) < 4;
  }

  // Pass icons go to the route runners left to right as the offense sees them, matching the
  // three keys / face buttons left to right. Two receivers take the outside keys, one takes the middle.
  assignIcons() {
    const P = this.offPlay;
    if (!P || P.type !== 'pass') return null;
    const o = this.slot[this.off];
    const recs = ['WR1', 'WR2', 'RB'].filter((sl) => P.routes[sl] && !(sl === 'RB' && this.rbStays)).map((sl) => o[sl]);
    recs.sort((a, b) => this.F(a.home).dx - this.F(b.home).dx);
    const order = recs.length >= 3 ? [0, 1, 2] : recs.length === 2 ? [0, 2] : [1];
    const ids = [-1, -1, -1];
    recs.slice(0, 3).forEach((r, k) => {
      ids[order[k]] = r.id;
    });
    return ids;
  }

  iconReceiver(n) {
    if (!this.icons) return null;
    let id = this.icons[n];
    if (id < 0) {
      // a lone receiver answers to any of the keys
      const live = this.icons.filter((x) => x >= 0);
      if (live.length === 1) id = live[0];
    }
    const r = id >= 0 ? this.byId.get(id) : null;
    return r && (r.job === 'route' || r.job === 'catchBall') ? r : null;
  }

  setHome(p, spot, faceDownfield = p.team === this.off) {
    const w = this.W(spot[0], spot[1]);
    w.x = clamp(w.x, -HALF_W + 0.8, HALF_W - 0.8);
    w.z = clamp(w.z, -END + 0.6, END - 0.6);
    p.home = w;
    p.homeFace = faceDownfield ? angleOf(0, this.dir) : angleOf(0, -this.dir);
  }

  maxDz() {
    // distance from the line of scrimmage to the defense's end line, minus a yard
    return END - this.dir * this.losZ - 1;
  }

  placeScrimmage() {
    const form = FORMATIONS[this.offPlay.form];
    const o = this.slot[this.off];
    for (const s of ['C', 'LG', 'RG']) this.setHome(o[s], OL_SPOTS[s]);
    for (const s of ['QB', 'RB', 'WR1', 'WR2']) this.setHome(o[s], form[s]);
    this.alignDefense();
    // start in huddles and hustle to the line
    const offH = this.W(0, -9);
    const defH = this.W(0, Math.min(8, this.maxDz() - 1));
    const place = (team, c) => {
      const list = this.players.filter((p) => p.team === team);
      list.forEach((p, i) => {
        const a = (i / list.length) * Math.PI * 2;
        p.x = c.x + Math.sin(a) * 1.7;
        p.z = c.z + Math.cos(a) * 1.7;
        p.face = angleOf(c.x - p.x, c.z - p.z);
      });
    };
    place(this.off, offH);
    place(this.def, defH);
  }

  alignDefense() {
    const dp = this.defPlay;
    const d = this.slot[this.def];
    const o = this.slot[this.off];
    const maxDz = this.maxDz();
    for (const s of DEF_SLOTS) {
      const a = dp.a[s];
      let spot;
      if (dp.align && dp.align[s]) spot = dp.align[s];
      else if (a.t === 'man' && o[a.target]) {
        const tf = this.F(o[a.target].home);
        if (s.startsWith('CB')) spot = [tf.dx + (tf.dx > 0 ? -0.8 : 0.8), dp.cbDepth || 5.5];
        else spot = [tf.dx * 0.55, 4.6];
      } else if (s.startsWith('CB')) {
        const wr = o[s === 'CB1' ? 'WR1' : 'WR2'];
        const tf = wr ? this.F(wr.home) : { dx: s === 'CB1' ? -13 : 13 };
        spot = [tf.dx + (tf.dx > 0 ? -1.2 : 1.2), dp.cbDepth || 6.5];
      } else spot = DEF_BASE_ALIGN[s];
      spot = [spot[0], Math.min(spot[1], maxDz)];
      this.setHome(d[s], spot);
    }
  }

  placePunt() {
    const f = FORMATIONS.punt;
    const o = this.slot[this.off];
    const d = this.slot[this.def];
    for (const s of ['C', 'LG', 'RG']) this.setHome(o[s], OL_SPOTS[s]);
    this.setHome(o.K, f.K);
    this.setHome(o.RB, f.RB);
    this.setHome(o.WR1, f.WR1);
    this.setHome(o.WR2, f.WR2);
    // where will it come down?
    const toGoal = 100 - this.ballOn;
    let land = Math.min(this.rng.range(38, 47), toGoal - 7);
    land = Math.max(land, 14);
    this.kickInfo = { landDz: land, landDx: this.rng.range(-6, 6), hang: this.rng.range(3.7, 4.2), apex: this.rng.range(16, 20) };
    const maxDz = this.maxDz();
    this.setHome(d.DL1, [-2.2, 1.0]);
    this.setHome(d.DL2, [2.2, 1.0]);
    this.setHome(d.CB1, [this.F(o.WR1.home).dx + 1.2, 1.4]);
    this.setHome(d.CB2, [this.F(o.WR2.home).dx - 1.2, 1.4]);
    this.setHome(d.LB1, [-4, Math.min(8, maxDz)]);
    this.setHome(d.LB2, [4, Math.min(8, maxDz)]);
    this.setHome(d.S, [this.kickInfo.landDx, Math.min(land + 2, maxDz)]);
    for (const p of this.players) this.teleportHome(p);
  }

  placeFG() {
    const f = FORMATIONS.fg;
    const o = this.slot[this.off];
    const d = this.slot[this.def];
    for (const s of ['C', 'LG', 'RG']) this.setHome(o[s], OL_SPOTS[s]);
    this.setHome(o.K, f.K);
    this.setHome(o.QB, f.QB);
    this.setHome(o.WR1, f.WR1);
    this.setHome(o.RB, f.RB);
    const maxDz = this.maxDz();
    const spots = { DL1: [-1.6, 1], DL2: [1.6, 1], LB1: [-3.6, 1.2], LB2: [3.6, 1.2], CB1: [-5.6, 1.4], CB2: [5.6, 1.4], S: [0, 7] };
    for (const s of DEF_SLOTS) this.setHome(d[s], [spots[s][0], Math.min(spots[s][1], maxDz)]);
    for (const p of this.players) this.teleportHome(p);
  }

  placeKickoff() {
    const k = this.slot[this.off];
    const r = this.slot[this.def];
    this.setHome(k.K, [0, -6]);
    const lanes = { DL1: -20, LB1: -12.5, CB1: -5.5, CB2: 5.5, LB2: 12.5, DL2: 20 };
    for (const s in lanes) this.setHome(k[s], [lanes[s], -1]);
    const toGoal = 100 - this.ballOn;
    const land = toGoal - this.rng.range(-2, 6);
    this.kickInfo = { landDz: land, landDx: this.rng.range(-9, 9), hang: this.rng.range(3.4, 3.8), apex: this.rng.range(15, 18) };
    this.setHome(r.WR1, [this.kickInfo.landDx * 0.5, toGoal - 3]);
    this.setHome(r.RB, [0, toGoal - 15]);
    this.setHome(r.WR2, [-15, 13]);
    this.setHome(r.LB1, [-6, 12]);
    this.setHome(r.DL1, [0, 14]);
    this.setHome(r.LB2, [6, 12]);
    this.setHome(r.S, [15, 13]);
    for (const p of this.players) this.teleportHome(p);
    this.ball.x = 0;
    this.ball.z = this.losZ;
    this.ball.y = 0.3;
  }

  teleportHome(p) {
    p.x = p.home.x;
    p.z = p.home.z;
    p.face = p.homeFace;
  }

  initControl() {
    for (const team of [0, 1]) {
      if (!this.m.human[team]) continue;
      const s = this.slot[team];
      let c = null;
      if (this.kind === 'scrimmage' || this.kind === 'two') {
        if (team === this.off) {
          const op = this.offPlay;
          if (op.type === 'run' && op.mode !== 'keep') {
            c = s[op.carrier];
            c.lockUntil = Infinity;
          } else {
            c = s.QB;
            if (op.type === 'run') c.lockUntil = 0.3;
          }
        } else c = this.defaultDefender(team);
      } else if (this.kind === 'kickoff') {
        c = team === this.off ? s.LB1 : s.WR1;
        c.lockUntil = Infinity; // released at the kick / the catch
      } else if (this.kind === 'punt') {
        c = team === this.off ? s.WR1 : s.S;
        c.lockUntil = Infinity;
      }
      this.ctrl[team] = c;
    }
  }

  defaultDefender(team) {
    const s = this.slot[team];
    const pref = this.m.defPref[team];
    if (pref && s[pref]) return s[pref];
    const a = this.defPlay ? this.defPlay.a : {};
    if (s.S && a.S && a.S.t !== 'rush') return s.S;
    if (s.LB2 && a.LB2 && a.LB2.t !== 'rush') return s.LB2;
    return s.S || s.LB1;
  }

  // ------------------------------------------------------------- step
  step(dt, inputs, presses) {
    this.t += dt;
    for (const team of [0, 1]) {
      const pr = presses[team];
      const bf = this.buf[team];
      for (const k of ['a', 'j', 's']) if (pr[k]) bf[k] = PRESS_WINDOW;
      if (pr.c) for (let n = 0; n < 3; n++) if (pr.c[n]) bf.i[n] = ICON_WINDOW;
    }
    if (this.phase === 'lineup') this.stepLineup(dt);
    else if (this.phase === 'presnap') this.stepPresnap(dt, inputs);
    else if (this.phase === 'live') this.stepLive(dt, inputs);
    else if (this.phase === 'dead') this.stepDead(dt, inputs);
    for (const team of [0, 1]) {
      const bf = this.buf[team];
      for (const k of ['a', 'j', 's']) bf[k] = Math.max(0, bf[k] - dt);
      for (let n = 0; n < 3; n++) bf.i[n] = Math.max(0, bf.i[n] - dt);
    }
  }

  consume(team, key) {
    if (this.buf[team][key] > 0) {
      this.buf[team][key] = 0;
      return true;
    }
    return false;
  }

  // Any button at all (used for the snap and the kick). Clears everything so the same press
  // can't also throw or jump a moment later.
  anyPress(team) {
    const bf = this.buf[team];
    const hit = bf.a > 0 || bf.j > 0 || bf.s > 0 || bf.i.some((v) => v > 0);
    bf.a = 0;
    bf.j = 0;
    bf.s = 0;
    bf.i.fill(0);
    return hit;
  }

  // First live receiver-icon press, if any.
  iconPress(team) {
    const bf = this.buf[team];
    for (let n = 0; n < 3; n++) {
      if (bf.i[n] <= 0) continue;
      bf.i[n] = 0;
      const r = this.iconReceiver(n);
      if (r) return r;
    }
    return null;
  }

  stepLineup(dt) {
    if (this.kind !== 'scrimmage' && this.kind !== 'two') {
      this.toPresnap();
      return;
    }
    let maxD = 0;
    for (const p of this.players) {
      const dx = p.home.x - p.x;
      const dz = p.home.z - p.z;
      const d = len(dx, dz);
      maxD = Math.max(maxD, d);
      if (this.t < 0.45) {
        // break the huddle
        p.ix = 0;
        p.iz = 0;
      } else if (d > 0.05) {
        const m = Math.min(1, d / 0.9);
        p.ix = (dx / d) * m * 0.95;
        p.iz = (dz / d) * m * 0.95;
      } else {
        p.ix = 0;
        p.iz = 0;
      }
      p.wantTurbo = false;
      this.integrate(p, dt);
    }
    if ((maxD < 0.3 && this.t > 0.8) || this.t > 2.2) this.toPresnap();
  }

  toPresnap() {
    this.phase = 'presnap';
    this.presnapT = 0;
    for (const p of this.players) {
      this.teleportHome(p);
      p.vx = 0;
      p.vz = 0;
      p.setState('stance');
    }
    if (this.kind === 'scrimmage' || this.kind === 'two') {
      this.ball.state = 'dead';
      this.ball.x = 0;
      this.ball.z = this.losZ;
      this.ball.y = 0.12;
    }
    this.emit({ k: 'set', kind: this.kind });
  }

  stepPresnap(dt, inputs) {
    this.presnapT += dt;
    const o = this.off;
    const d = this.def;
    // offense snap
    let go = false;
    if (this.m.human[o] && this.ctrl[o] !== null && this.kind !== 'fg' && this.kind !== 'pat') {
      if (this.anyPress(o) && this.presnapT > 0.2) go = true;
      if (this.presnapT > (this.kind === 'kickoff' ? 6 : 12)) go = true;
    } else if (this.presnapT > (this.kind === 'scrimmage' || this.kind === 'two' ? this.cpuSnapAt : 0.9)) go = true;

    // human defender can cycle and shuffle around before the snap
    if (this.m.human[d] && (this.kind === 'scrimmage' || this.kind === 'two')) {
      if (this.consume(d, 'a')) this.cycleDefender(d);
      this.consume(d, 'j');
      this.consume(d, 's');
      const p = this.ctrl[d];
      if (p) {
        const inp = inputs[d];
        const wx = -this.dir * inp.mx;
        const wz = this.dir * inp.my;
        const m = Math.min(1, len(wx, wz));
        if (m > 0.15) {
          if (p.state === 'stance') p.setState('stand');
          p.ix = (wx / len(wx, wz)) * m * 0.6;
          p.iz = (wz / len(wx, wz)) * m * 0.6;
        } else {
          p.ix = 0;
          p.iz = 0;
        }
        p.wantTurbo = false;
        if (p.state !== 'stance') this.integrate(p, dt);
        // stay on our side of the ball
        const f = this.F(p);
        if (f.dz < 1.0) {
          const w = this.W(f.dx, 1.0);
          p.z = w.z;
        }
        p.x = clamp(p.x, -HALF_W + 0.5, HALF_W - 0.5);
        if (m < 0.15 && p.state === 'stand' && p.speed < 0.2) p.face = turnToward(p.face, p.homeFace, 8 * dt);
      }
    }
    if (go) this.snap();
  }

  cycleDefender(team) {
    const list = this.players.filter((p) => p.team === team).sort((a, b) => this.F(a).dx - this.F(b).dx);
    const cur = this.ctrl[team];
    const i = list.indexOf(cur);
    const next = list[(i + 1) % list.length];
    this.ctrl[team] = next;
    this.m.defPref[team] = next.slot;
    this.emit({ k: 'switch', id: next.id, team });
  }

  // ------------------------------------------------------------- snap & jobs
  snap() {
    this.phase = 'live';
    this.liveT = 0;
    for (const p of this.players) {
      if (p.state === 'stance') p.setState('stand');
      p.nextThink = 0;
    }
    for (const team of [0, 1]) this.anyPress(team);
    this.emit({ k: 'snap', kind: this.kind });
    const o = this.slot[this.off];
    if (this.kind === 'kickoff') {
      this.assignKickoffJobs();
      return;
    }
    let to = null;
    if (this.kind === 'punt') to = o.K;
    else if (this.kind === 'fg' || this.kind === 'pat') to = o.QB;
    else to = o.QB;
    const c = o.C;
    const d = dist(c, to);
    this.flight({ kind: 'snap', fx: c.x, fy: 0.35, fz: c.z, tx: to.x, ty: 1.1, tz: to.z, T: clamp(d / 17, 0.16, 0.62), apex: 0.25, to });
    this.firstHolder = to;
    if (this.kind === 'scrimmage' || this.kind === 'two') {
      this.clockRunning = true;
      this.assignScrimmageJobs();
    } else if (this.kind === 'punt') this.assignPuntJobs();
    else this.assignFGJobs();
  }

  routeFrom(p, def) {
    const start = this.F(p.home);
    const side = start.dx < 0 ? 1 : -1;
    const pts = def.pts.map(([a, b, flags]) => {
      const dx = def.abs ? start.dx + a : start.dx + side * a;
      const dz = Math.min(start.dz + b, this.maxDz() - 0.5);
      const w = this.W(dx, dz);
      return { x: clamp(w.x, -HALF_W + 1, HALF_W - 1), z: w.z, sit: !!(flags && flags.sit), wait: (flags && flags.wait) || 0 };
    });
    return this.makeRoute(p, pts);
  }

  pathFrom(p, pathPts) {
    const pts = pathPts.map(([dx, dz, flags]) => {
      const w = this.W(dx, Math.min(dz, this.maxDz() - 0.5));
      return { x: clamp(w.x, -HALF_W + 1, HALF_W - 1), z: w.z, sit: false, wait: (flags && flags.wait) || 0 };
    });
    return this.makeRoute(p, pts);
  }

  makeRoute(p, pts) {
    const n = pts.length;
    const last = pts[n - 1];
    const prev = n > 1 ? pts[n - 2] : { x: p.x, z: p.z };
    let ex = last.x - prev.x;
    let ez = last.z - prev.z;
    const l = len(ex, ez) || 1;
    ex /= l;
    ez /= l;
    return { pts, i: 0, waitT: 0, waited: false, ex, ez };
  }

  assignScrimmageJobs() {
    const o = this.slot[this.off];
    const P = this.offPlay;
    const form = FORMATIONS[P.form];
    if (P.type === 'pass') {
      o.QB.job = 'qbPass';
      const dropTo = this.W(form.QB[0], form.QB[1] - (P.drop || 2));
      o.QB.jd = { drop: dropTo, dropEnd: 0.25 + (P.drop || 2) * 0.17, nextRead: 0, readAt: this.rng.range(0.55, 0.85) * this.levelFor(this.off).qbRead + (P.drop || 2) * 0.12 };
      for (const s of ['C', 'LG', 'RG']) {
        o[s].job = P.screen ? 'screenBlock' : 'passBlock';
        o[s].jd = { anchor: this.W(this.F(o[s].home).dx, -1.6), side: P.screen || 0 };
      }
      for (const s of ['WR1', 'WR2', 'RB']) {
        if (P.routes[s] && !(s === 'RB' && this.rbStays)) {
          o[s].job = 'route';
          o[s].route = this.routeFrom(o[s], P.routes[s]);
        } else {
          o[s].job = 'passBlock';
          o[s].jd = { anchor: this.W(this.F(o[s].home).dx * 0.5, this.F(o[s].home).dz) };
        }
      }
    } else {
      // run
      const carrier = o[P.carrier];
      for (const s of ['C', 'LG', 'RG']) {
        o[s].job = P.draw ? 'drawBlock' : 'runBlock';
        o[s].jd = { runDir: P.runDir || 0, anchor: this.W(this.F(o[s].home).dx, -1.6) };
      }
      for (const s of ['WR1', 'WR2']) {
        o[s].job = 'stalk';
        o[s].route = this.routeFrom(o[s], { pts: [[0, 4.5]], abs: false });
        o[s].jd = {};
      }
      if (P.mode === 'keep') {
        o.QB.job = 'carrierPath';
        o.QB.route = this.pathFrom(o.QB, P.path);
        o.RB.job = 'leadPath';
        o.RB.route = this.pathFrom(o.RB, P.rbPath || [[0, 0]]);
      } else {
        o.QB.job = P.mode === 'pitch' ? 'qbPitch' : 'qbHand';
        o.QB.route = P.qbPath ? this.pathFrom(o.QB, P.qbPath) : null;
        o.QB.jd = {};
        carrier.job = 'rbPath';
        carrier.route = this.pathFrom(carrier, P.path);
      }
    }
    this.assignDefenseJobs();
  }

  assignDefenseJobs() {
    const d = this.slot[this.def];
    const o = this.slot[this.off];
    const maxDz = this.maxDz();
    for (const s of DEF_SLOTS) {
      const p = d[s];
      const a = this.defPlay.a[s];
      p.jd = { lead: this.rng.range(0.55, 1.0) };
      if (a.t === 'rush') {
        p.job = 'rush';
        p.jd.lane = Math.sign(this.F(p.home).dx || (s.endsWith('1') ? -1 : 1));
        p.jd.run = !!a.run;
      } else if (a.t === 'man' && o[a.target]) {
        p.job = 'man';
        p.jd.target = o[a.target];
      } else if (a.t === 'spy') {
        p.job = 'spy';
      } else {
        const at = a.t === 'zone' ? a.at : [0, 16];
        p.job = 'zone';
        p.jd.at = this.W(at[0], Math.min(at[1], maxDz - 0.5));
      }
    }
  }

  assignPuntJobs() {
    const o = this.slot[this.off];
    const d = this.slot[this.def];
    o.K.job = 'punter';
    o.K.jd = {};
    for (const s of ['C', 'LG', 'RG', 'RB']) {
      o[s].job = 'puntBlock';
      o[s].jd = { anchor: this.W(this.F(o[s].home).dx, this.F(o[s].home).dz - 1.2), release: s === 'RB' ? 1.6 : 1.3 };
    }
    for (const s of ['WR1', 'WR2']) {
      o[s].job = 'gunner';
      o[s].jd = { lane: o[s].home.x };
    }
    d.DL1.job = 'rush';
    d.DL1.jd = { lane: -1, lead: 1 };
    d.DL2.job = 'rush';
    d.DL2.jd = { lane: 1, lead: 1 };
    d.CB1.job = 'jam';
    d.CB1.jd = { target: o.WR1, lead: 0.8 };
    d.CB2.job = 'jam';
    d.CB2.jd = { target: o.WR2, lead: 0.8 };
    for (const s of ['LB1', 'LB2']) {
      d[s].job = 'returnBlock';
      d[s].jd = { lane: s === 'LB1' ? -5 : 5, lead: 0.8 };
    }
    d.S.job = 'returner';
    d.S.jd = {};
    this.returner = d.S;
  }

  assignFGJobs() {
    const o = this.slot[this.off];
    const d = this.slot[this.def];
    o.K.job = 'fgKicker';
    o.K.jd = {};
    o.QB.job = 'holder';
    o.QB.jd = {};
    for (const s of ['C', 'LG', 'RG', 'WR1', 'RB']) {
      o[s].job = 'fgBlock';
      o[s].jd = { anchor: { x: o[s].home.x, z: o[s].home.z - this.dir * 0.6 } };
    }
    for (const s of DEF_SLOTS) {
      d[s].job = 'rush';
      d[s].jd = { lane: Math.sign(this.F(d[s].home).dx) || 1, lead: 1, fg: true };
    }
  }

  assignKickoffJobs() {
    const k = this.slot[this.off];
    const r = this.slot[this.def];
    k.K.job = 'kicker';
    k.K.jd = {};
    for (const s of ['DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2']) {
      k[s].job = 'coverage';
      k[s].jd = { lane: k[s].home.x, lead: this.rng.range(0.6, 1.0) };
    }
    r.WR1.job = 'returner';
    r.WR1.jd = {};
    this.returner = r.WR1;
    const lanes = { RB: 0, WR2: -9, LB1: -4, DL1: 0.5, LB2: 4, S: 9 };
    for (const s in lanes) {
      r[s].job = 'returnBlock';
      r[s].jd = { lane: lanes[s], lead: 0.8 };
    }
  }

  // ------------------------------------------------------------- live
  stepLive(dt, inputs) {
    this.liveT += dt;
    this.updateControl(inputs);
    this.updateScripts(dt);
    if (this.t >= this.nextBlockAssign) {
      this.assignBlocks();
      this.nextBlockAssign = this.t + 0.12;
    }
    for (const p of this.players) {
      if (!p.humanDriven) runAI(this, p, dt);
    }
    for (const p of this.players) this.integrate(p, dt);
    this.resolveContacts();
    this.updateEngagements(dt);
    this.updateBall(dt);
    if (this.phase === 'live') this.checkTackles();
    if (this.phase === 'live') this.checkBounds();
    for (const p of this.players) {
      p.tackleCd = Math.max(0, p.tackleCd - dt);
      p.actCd = Math.max(0, p.actCd - dt);
      p.burst = Math.max(0, p.burst - dt);
    }
  }

  isHuman(p) {
    return this.m.human[p.team] && this.ctrl[p.team] === p;
  }

  updateControl(inputs) {
    for (const p of this.players) p.humanDriven = false;
    for (const team of [0, 1]) {
      if (!this.m.human[team]) continue;
      const p = this.ctrl[team];
      if (!p) continue;
      const inp = inputs[team];
      if (this.liveT < p.lockUntil) continue;
      const wx = -this.dir * inp.mx;
      const wz = this.dir * inp.my;
      const l = len(wx, wz);
      const mag = Math.min(1, l);
      const b = this.ball;
      // let the receiver track the ball himself if the player isn't steering
      if (b.state === 'air' && b.f && b.f.kind === 'pass' && b.f.intended === p && mag < 0.2) {
        this.humanActions(team, p, inp);
        continue;
      }
      p.humanDriven = true;
      if (mag > 0.15) {
        p.ix = (wx / l) * mag;
        p.iz = (wz / l) * mag;
        if (p.job === 'qbPass' && p.jd) p.jd.steered = true;
      } else if (p.job === 'qbPass' && p.jd && !p.jd.steered && this.liveT < p.jd.dropEnd + 0.2) {
        // hands off the controls: take the drop like a real quarterback until the player steers
        const dx = p.jd.drop.x - p.x;
        const dz = p.jd.drop.z - p.z;
        const d = len(dx, dz);
        const m = d > 0.05 ? Math.min(1, d / 0.8) : 0;
        p.ix = d > 0.05 ? (dx / d) * m : 0;
        p.iz = d > 0.05 ? (dz / d) * m : 0;
      } else {
        p.ix = 0;
        p.iz = 0;
      }
      p.wantTurbo = !!inp.turbo;
      this.humanActions(team, p, inp);
    }
  }

  // One job per button, no two-button combos:
  //   ball carrier      pass = stiff-arm · jump = hurdle · spin = spin move
  //   QB behind the line, icons: each key throws to the receiver wearing it (turbo = bullet)
  //   QB behind the line, aim:   pass = throw to the highlighted receiver · jump = hurdle · spin = spin
  //   defense / loose ball: pass = switch to the man nearest the ball · jump = jump · spin = dive
  //   offense without the ball: jump = jump for the pass · spin = dive at it
  humanActions(team, p, inp) {
    const b = this.ball;
    const hasBall = b.state === 'held' && b.carrier === p;
    if (hasBall) {
      if (this.canPass(p) && this.offPlay && this.offPlay.type === 'pass') {
        if (inp.pm === 'aim') {
          this.updateTarget(team, p, inp);
          if (this.consume(team, 'a') && this.target[team]) {
            this.throwPass(p, this.target[team], !!inp.turbo);
            return;
          }
          if (this.consume(team, 'j')) this.doHurdle(p);
          if (this.consume(team, 's')) this.doSpin(p);
        } else {
          this.target[team] = null;
          const rec = this.iconPress(team);
          // the action keys double as the icon keys back here, so they never stiff-arm or spin
          this.consume(team, 'a');
          this.consume(team, 'j');
          this.consume(team, 's');
          if (rec) this.throwPass(p, rec, !!inp.turbo);
        }
        return;
      }
      this.target[team] = null;
      if (this.consume(team, 'a')) this.doStiffArm(p);
      if (this.consume(team, 'j')) this.doHurdle(p);
      if (this.consume(team, 's')) this.doSpin(p);
      return;
    }
    this.target[team] = null;
    // the snap is on its way to us: hold any press until the ball arrives
    if (b.state === 'air' && b.f && b.f.kind === 'snap' && b.f.to === p) return;
    if (this.poss === team && b.state !== 'loose') {
      if (this.consume(team, 'j')) this.doJump(p);
      if (this.consume(team, 's')) {
        const f = b.state === 'air' && b.f && b.f.kind === 'pass' && b.f.intended === p ? b.f : null;
        if (f) this.doDive(p, f.tx, f.tz, f.T - f.t);
        else this.doDive(p);
      }
      this.consume(team, 'a');
    } else {
      if (this.consume(team, 'a')) this.switchToNearest(team);
      const cur = this.ctrl[team];
      if (this.consume(team, 'j')) this.doJump(cur);
      if (this.consume(team, 's') && cur) {
        const t = this.diveTarget(cur);
        if (t) this.doDive(cur, t.x, t.z);
        else this.doDive(cur);
      }
    }
  }

  canPass(p) {
    if (this.passThrown || p.slot !== 'QB' || this.ball.carrier !== p) return false;
    if (this.kind !== 'scrimmage' && this.kind !== 'two') return false;
    if (!p.upright || p.state === 'throw') return false;
    return this.dir * (p.z - this.losZ) < 0.25;
  }

  eligibleReceivers(team) {
    return this.players.filter(
      (r) => r.team === team && (r.job === 'route' || r.job === 'catchBall') && r.upright && r.state !== 'engaged',
    );
  }

  updateTarget(team, qb, inp) {
    const recs = this.eligibleReceivers(team);
    if (!recs.length) {
      this.target[team] = null;
      return;
    }
    const sx = -this.dir * inp.mx;
    const sz = this.dir * inp.my;
    const sl = len(sx, sz);
    const cur = this.target[team];
    let aimX;
    let aimZ;
    if (sl > 0.35) {
      aimX = sx / sl;
      aimZ = sz / sl;
    } else if (cur && recs.includes(cur)) return;
    else {
      aimX = 0;
      aimZ = this.dir;
    }
    let best = null;
    let bestA = Infinity;
    for (const r of recs) {
      const dx = r.x - qb.x;
      const dz = r.z - qb.z;
      const d = len(dx, dz) || 1;
      const a = Math.acos(clamp((dx * aimX + dz * aimZ) / d, -1, 1)) + d * 0.004;
      if (a < bestA) {
        bestA = a;
        best = r;
      }
    }
    if (best !== cur) {
      this.target[team] = best;
      this.emit({ k: 'target', id: best.id, team });
    }
  }

  switchToNearest(team) {
    const b = this.ball;
    const ref = b.carrier || b;
    let best = null;
    let bd = Infinity;
    for (const p of this.players) {
      if (p.team !== team || p === this.ctrl[team] || p.state === 'down' || p.state === 'flying') continue;
      let d = dist(p, ref);
      if (b.state === 'air' && b.f) d = len(p.x - b.f.tx, p.z - b.f.tz);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) {
      this.ctrl[team] = best;
      best.lockUntil = 0;
      if (this.kind === 'scrimmage' || this.kind === 'two') this.m.defPref[team] = null;
      this.emit({ k: 'switch', id: best.id, team });
    }
  }

  // ------------------------------------------------------------- moves
  doSpin(p) {
    if (p.actCd > 0 || !p.upright || p.state === 'engaged') return;
    p.setState('spin', 0.42);
    p.spinUsed = false;
    p.actCd = 0.9;
    this.emit({ k: 'spin', id: p.id });
  }

  doStiffArm(p) {
    if (p.actCd > 0 || !p.upright || p.state === 'engaged') return;
    p.setState('stiff', 0.5);
    p.actCd = 0.8;
    this.emit({ k: 'stiff', id: p.id });
  }

  doHurdle(p) {
    if (p.actCd > 0 || p.y > 0.01 || !p.upright) return;
    p.setState('hurdle', (2 * HURDLE_VY) / AIR_GRAVITY);
    p.vy = HURDLE_VY;
    p.actCd = 0.8;
    this.emit({ k: 'hurdle', id: p.id });
  }

  // a leap: high and floaty, carrying the run-up's momentum (vy: a smaller hop)
  doJump(p, vy = JUMP_VY) {
    if (!p || p.y > 0.01 || !p.upright || p.state === 'engaged' || p.actCd > 0) return;
    p.setState('jump', (2 * vy) / AIR_GRAVITY);
    p.vy = vy;
    p.actCd = 0.5;
    this.emit({ k: 'jump', id: p.id });
  }

  // Where a defender's dive should go: at a runner ahead of him, led to where the runner
  // will be when the dive comes down. null if nobody is in range.
  diveTarget(p) {
    const c = this.ball.carrier;
    if (!c || this.ball.state !== 'held' || c.team === p.team || !c.upright) return null;
    let fx = Math.sin(p.face);
    let fz = Math.cos(p.face);
    const il = len(p.ix, p.iz);
    if (il > 0.3) {
      fx = p.ix / il;
      fz = p.iz / il;
    } else if (p.speed > 1) {
      fx = p.vx / p.speed;
      fz = p.vz / p.speed;
    }
    const T = DIVE_AIR * 0.85;
    const tx = c.x + c.vx * T;
    const tz = c.z + c.vz * T;
    const d = len(tx - p.x, tz - p.z);
    if (d > 6 || d < 0.3) return null;
    if (((tx - p.x) * fx + (tz - p.z) * fz) / d < 0.6) return null;
    return { x: tx, z: tz };
  }

  // A dive: a flying tackle, or a layout for the ball. tx/tz: dive at a spot; T: when the
  // ball gets there, so a layout is paced to meet it. Airborne for DIVE_AIR, then a slide.
  doDive(p, tx, tz, T) {
    if (!p || !p.upright || p.state === 'engaged' || p.actCd > 0 || p.y > 0.05) return;
    let fx = Math.sin(p.face);
    let fz = Math.cos(p.face);
    let sp = Math.max(p.speed, 6.5) * 1.25;
    if (tx !== undefined) {
      const dx = tx - p.x;
      const dz = tz - p.z;
      const d = len(dx, dz) || 1;
      fx = dx / d;
      fz = dz / d;
      sp = T !== undefined ? clamp((d - 0.5) / clamp(T, 0.2, DIVE_AIR), 2.5, 10) : clamp(d / DIVE_AIR, 6.5, 11.5);
    } else if (p.speed > 1) {
      fx = p.vx / p.speed;
      fz = p.vz / p.speed;
    }
    p.face = angleOf(fx, fz);
    p.vx = fx * sp;
    p.vz = fz * sp;
    p.vy = DIVE_VY;
    p.y = 0.02;
    p.setState('dive', DIVE_AIR + DIVE_SLIDE);
    p.actCd = 1.2;
    this.emit({ k: 'dive', id: p.id });
  }

  knockDown(p, fromX, fromZ, dur = 1.2) {
    const dx = p.x - fromX;
    const dz = p.z - fromZ;
    const d = len(dx, dz) || 1;
    p.fallFwd = Math.sin(p.face) * dx + Math.cos(p.face) * dz < 0;
    p.vx = (dx / d) * 2.5;
    p.vz = (dz / d) * 2.5;
    this.releaseEngagement(p);
    p.setState('down', dur);
  }

  // ------------------------------------------------------------- scripted events
  updateScripts(dt) {
    const b = this.ball;
    const o = this.slot[this.off];
    if (this.kind === 'scrimmage' || this.kind === 'two') {
      const P = this.offPlay;
      if (P.type === 'run' && !this.handedOff && b.state === 'held' && b.carrier === o.QB) {
        const rb = o[P.carrier];
        if (P.mode === 'hand' && rb && rb !== o.QB) {
          if (this.liveT > (P.handoffAt || 0.3) && dist(rb, o.QB) < 1.3 && rb.upright) this.handoff(o.QB, rb);
          else if (this.liveT > 2.2) {
            this.handedOff = true;
            o.QB.job = 'carrier';
            this.reveal();
          }
        } else if (P.mode === 'pitch' && rb && this.liveT > (o.QB.jd.gotAt || 0) + 0.12 && b.carrier === o.QB) {
          this.pitch(o.QB, rb);
        }
      }
      if (P.mode === 'keep' && b.carrier === o.QB && !this.carrierRunning && this.liveT > 0.6) this.reveal();
      // a human QB who takes off past the line is a runner now
      if (b.state === 'held' && b.carrier && b.carrier.slot === 'QB' && !this.carrierRunning && this.dir * (b.carrier.z - this.losZ) > 0.5) this.reveal();
    } else if (this.kind === 'punt') {
      const k = o.K;
      if (b.state === 'held' && b.carrier === k && !b.kicked && this.liveT > (k.jd.gotAt || 0) + 0.55) this.kickPunt(k);
      if (b.kicked && this.liveT > this.kickT + 0.1) this.releaseKickControl();
    } else if (this.kind === 'fg' || this.kind === 'pat') {
      const h = o.QB;
      const k = o.K;
      if (b.state === 'held' && b.carrier === h && !b.kicked) {
        if (h.state !== 'kneel') h.setState('kneel');
        if (dist(k, h) < 1.25 && this.liveT > (h.jd.gotAt || 0) + 0.35) this.kickFG(k, h);
      }
    } else if (this.kind === 'kickoff') {
      const k = o.K;
      if (!b.kicked && dist(k, b) < 0.75) this.kickOff(k);
    }
  }

  handoff(qb, rb) {
    this.handedOff = true;
    this.ball.carrier = rb;
    rb.job = 'carrier';
    rb.jd = {};
    qb.job = 'fake';
    this.reveal();
    if (this.isHuman(rb)) rb.lockUntil = this.liveT + 0.05;
    this.emit({ k: 'handoff', id: rb.id });
  }

  pitch(qb, rb) {
    this.handedOff = true;
    const T = 0.36;
    const P = this.predict(rb, T);
    this.flight({ kind: 'pitch', fx: qb.x, fy: 1.2, fz: qb.z, tx: P.x, ty: 1.1, tz: P.z, T, apex: 0.45, to: rb });
    qb.job = 'fake';
    qb.setState('throw', 0.3);
    this.emit({ k: 'pitch', id: rb.id });
  }

  reveal() {
    if (this.carrierRunning) return;
    this.carrierRunning = true;
    this.revealT = this.liveT;
  }

  releaseKickControl() {
    for (const team of [0, 1]) {
      const c = this.ctrl[team];
      if (c && team === this.off && c.lockUntil === Infinity) c.lockUntil = 0;
    }
  }

  kickOff(k) {
    const b = this.ball;
    b.kicked = true;
    this.kickT = this.liveT;
    const ki = this.kickInfo;
    const land = this.W(ki.landDx, ki.landDz);
    k.setState('kick', 0.5);
    this.flight({ kind: 'kick', fx: b.x, fy: 0.3, fz: b.z, tx: land.x, ty: 1.3, tz: land.z, T: ki.hang, apex: ki.apex });
    this.kickLand = land;
    this.emit({ k: 'kick', id: k.id, kind: 'kickoff' });
    // coverage and the kicking-team human are free now
    const c = this.ctrl[this.off];
    if (c) c.lockUntil = 0;
  }

  kickPunt(k) {
    const b = this.ball;
    b.kicked = true;
    this.kickT = this.liveT;
    const ki = this.kickInfo;
    const land = this.W(ki.landDx, ki.landDz);
    k.setState('kick', 0.5);
    this.flight({ kind: 'kick', fx: k.x, fy: 1.0, fz: k.z, tx: land.x, ty: 1.3, tz: land.z, T: ki.hang, apex: ki.apex });
    this.kickLand = land;
    this.emit({ k: 'kick', id: k.id, kind: 'punt' });
  }

  kickFG(k, h) {
    const b = this.ball;
    b.kicked = true;
    this.kickT = this.liveT;
    const yards = 100 - this.ballOn + 17;
    const pGood = fgChance(yards);
    const good = this.rng() < pGood;
    let aimX;
    let height;
    if (good) {
      aimX = this.rng.range(-POST_HALF * 0.7, POST_HALF * 0.7);
      height = this.rng.range(CROSSBAR + 1.5, CROSSBAR + 6);
    } else if (yards > 47 && this.rng() < 0.5) {
      aimX = this.rng.range(-POST_HALF * 0.8, POST_HALF * 0.8);
      height = this.rng.range(0.8, CROSSBAR - 0.6);
    } else {
      aimX = (this.rng() < 0.5 ? -1 : 1) * this.rng.range(POST_HALF + 0.5, POST_HALF + 3.5);
      height = this.rng.range(CROSSBAR + 1, CROSSBAR + 5);
    }
    const tz = this.dir * POST_Z;
    const d = Math.abs(tz - h.z);
    const T = d / 23 + 0.35;
    k.setState('kick', 0.5);
    this.flight({ kind: 'fg', fx: h.x, fy: 0.3, fz: h.z, tx: -this.dir * 0 + aimX, ty: height, tz, T, apex: 2.5 + d * 0.07, good });
    this.ball.carrier = null;
    h.setState('stand');
    this.emit({ k: 'kick', id: k.id, kind: this.kind });
  }

  flight(f) {
    const b = this.ball;
    b.state = 'air';
    if (b.carrier) b.lastTeam = b.carrier.team;
    b.carrier = null;
    f.t = 0;
    f.tried = new Set();
    f.resolved = false;
    b.f = f;
    b.x = f.fx;
    b.y = f.fy;
    b.z = f.fz;
  }

  // ------------------------------------------------------------- passing
  predict(p, T) {
    if ((p.job === 'route' || p.job === 'rbPath' || p.job === 'carrierPath') && p.route && !p.humanDriven) {
      const r = p.route;
      let x = p.x;
      let z = p.z;
      let rem = T * p.spd * 0.96;
      let i = r.i;
      let stopped = false;
      while (rem > 0 && i < r.pts.length) {
        const pt = r.pts[i];
        const d = len(pt.x - x, pt.z - z);
        if (d >= rem) {
          x += ((pt.x - x) / d) * rem;
          z += ((pt.z - z) / d) * rem;
          rem = 0;
          break;
        }
        x = pt.x;
        z = pt.z;
        rem -= d;
        i++;
        if (pt.sit && i >= r.pts.length) stopped = true;
      }
      if (rem > 0 && !stopped) {
        x += r.ex * rem;
        z += r.ez * rem;
      }
      return { x: clamp(x, -HALF_W + 0.5, HALF_W - 0.5), z: clamp(z, -END + 0.5, END - 0.5) };
    }
    return { x: clamp(p.x + p.vx * T, -HALF_W + 0.3, HALF_W - 0.3), z: clamp(p.z + p.vz * T, -END + 0.5, END - 0.5) };
  }

  passSpeed(qb, bullet) {
    return bullet ? 27 : 19 + qb.arm * 4;
  }

  leadPoint(qb, rec, bullet) {
    const spd = this.passSpeed(qb, bullet);
    let T = Math.max(0.25, dist(qb, rec) / spd);
    let P = { x: rec.x, z: rec.z };
    for (let k = 0; k < 4; k++) {
      P = this.predict(rec, T + 0.08);
      T = Math.max(0.25, len(P.x - qb.x, P.z - qb.z) / spd);
    }
    return { P, T };
  }

  throwPass(qb, rec, bullet) {
    const { P, T } = this.leadPoint(qb, rec, bullet);
    const d = len(P.x - qb.x, P.z - qb.z);
    let pressure = false;
    for (const q of this.players) if (q.team !== qb.team && q.upright && dist(q, qb) < 2.3) pressure = true;
    let sigma = 0.18 + d * 0.012 + (pressure ? 0.5 : 0) + (qb.speed > 3.5 ? 0.3 : 0) + (bullet ? 0.12 : 0) - qb.arm * 0.1;
    sigma = Math.max(0.08, sigma);
    const tx = P.x + this.rng.gauss() * sigma;
    const tz = P.z + this.rng.gauss() * sigma;
    const apex = bullet ? 0.35 + d * 0.034 : 0.6 + d * 0.088;
    const hand = { x: qb.x + Math.cos(qb.face) * 0.3, z: qb.z - Math.sin(qb.face) * 0.3 };
    // lobs and balls into coverage go up high, where only a leaping receiver gets them
    const covered = this.players.some((q) => q.team !== qb.team && q.upright && len(q.x - P.x, q.z - P.z) < 2.5);
    const ty = 1.35 + (bullet ? 0 : clamp((d - 8) * 0.04, 0, 0.8) + (covered ? 0.35 : 0)) + this.rng() * 0.3;
    this.flight({ kind: 'pass', fx: hand.x, fy: 2.1, fz: hand.z, tx, ty, tz, T, apex, intended: rec, bullet, thrower: qb });
    this.passThrown = true;
    this.passer = qb;
    qb.setState('throw', 0.32);
    qb.job = 'idle';
    rec.job = 'catchBall';
    rec.jd = { x: tx, z: tz };
    if (this.isHuman(qb)) {
      this.ctrl[qb.team] = rec;
      rec.lockUntil = 0;
    }
    this.target[qb.team] = null;
    this.emit({ k: 'throw', id: qb.id, to: rec.id, bullet: !!bullet, d: Math.round(d) });
  }

  throwAway(qb) {
    const side = qb.x >= 0 ? 1 : -1;
    const tx = side * (HALF_W + 4);
    const tz = qb.z + this.dir * 6;
    const d = len(tx - qb.x, tz - qb.z);
    this.flight({ kind: 'pass', fx: qb.x, fy: 2.1, fz: qb.z, tx, ty: 1.0, tz, T: d / 22, apex: 2, intended: null, bullet: false, thrower: qb });
    this.passThrown = true;
    this.passer = qb;
    qb.setState('throw', 0.32);
    qb.job = 'idle';
    this.emit({ k: 'throw', id: qb.id, to: -1, bullet: false, d: Math.round(d) });
  }

  // Evaluate who's open for the CPU quarterback.
  bestTarget(qb, togoYards) {
    let best = null;
    for (const r of this.eligibleReceivers(qb.team)) {
      const bullet = dist(qb, r) < 20;
      const { P, T } = this.leadPoint(qb, r, bullet);
      if (Math.abs(P.x) > HALF_W - 0.8) continue;
      let open = 99;
      for (const d of this.players) {
        if (d.team === qb.team || !d.upright || d.state === 'engaged') continue;
        const tDef = len(d.x - P.x, d.z - P.z) / (d.spd * 1.05) + d.react * 0.8;
        const margin = (tDef - T) * d.spd;
        if (margin < open) open = margin;
      }
      const gain = this.dir * (P.z - this.losZ);
      let score = Math.min(open, 6) + gain * 0.06 + (gain >= togoYards ? 1.2 : 0) - (gain < 1 ? 1.2 : 0);
      if (len(P.x - qb.x, P.z - qb.z) > 45) score -= 2;
      if (!best || score > best.score) best = { rec: r, open, gain, score, bullet: bullet && open < 2.5 };
    }
    return best;
  }

  // ------------------------------------------------------------- ball
  updateBall(dt) {
    const b = this.ball;
    if (b.state === 'held') {
      const c = b.carrier;
      b.x = c.x;
      b.z = c.z;
      b.y = c.y + 1.2;
      b.lastTeam = c.team;
      return;
    }
    if (b.state === 'air') {
      const f = b.f;
      f.t += dt;
      const s = f.t / f.T;
      b.x = lerp(f.fx, f.tx, s);
      b.z = lerp(f.fz, f.tz, s);
      b.y = lerp(f.fy, f.ty, s) + 4 * f.apex * s * (1 - s);
      if (f.kind === 'snap' || f.kind === 'pitch') {
        if (s >= 1) {
          const to = f.to;
          if (to && to.upright && len(to.x - b.x, to.z - b.z) < 1.7) this.giveBall(to, f.kind);
          else this.fumble(b.x, b.z, f.kind === 'pitch' ? 'pitch' : 'snap');
        }
        return;
      }
      if (f.kind === 'pass') {
        if (!f.resolved && s > 0.45) this.checkCatch(f);
        if (b.state === 'air' && b.y <= 0.12 && s > 1) {
          b.y = 0.12;
          this.incomplete();
        }
        return;
      }
      if (f.kind === 'kick') {
        if (s >= 1 && !f.resolved) {
          f.resolved = true;
          this.kickArrives(f);
        }
        return;
      }
      if (f.kind === 'fg') {
        if (s >= 1 && !f.resolved) {
          f.resolved = true;
          this.emit({ k: f.good ? 'fgGood' : 'fgMiss', kind: this.kind });
          this.whistle(this.kind === 'pat' ? 'pat' : 'fg', { good: f.good });
          if (f.good) {
            this.m.addScore(this.off, this.kind === 'pat' ? 1 : 3);
            this.result.scored = true;
          }
        }
        if (b.y <= 0.15 && s > 1) this.restBall();
        return;
      }
      if (f.kind === 'dead') {
        if (b.y <= 0.12 && s > 0.5) {
          b.y = 0.12;
          this.incomplete();
        }
      }
      return;
    }
    if (b.state === 'loose' || b.state === 'bounce') {
      b.looseT += dt;
      b.vy -= GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.y < 0.12) {
        b.y = 0.12;
        if (b.vy < -1.5) {
          b.vy = -b.vy * 0.45;
          b.vx = b.vx * 0.6 + this.rng.range(-2.5, 2.5);
          b.vz = b.vz * 0.6 + this.rng.range(-2.5, 2.5);
        } else {
          b.vy = 0;
          b.vx *= 1 - 3 * dt;
          b.vz *= 1 - 3 * dt;
        }
      }
      if (b.state === 'loose') {
        b.x = clamp(b.x, -HALF_W + 0.3, HALF_W - 0.3);
        b.z = clamp(b.z, -END + 0.3, END - 0.3);
        if (this.phase === 'live') this.checkRecovery(dt);
      }
    }
  }

  restBall() {
    const b = this.ball;
    b.state = 'bounce';
    const f = b.f;
    b.vx = (f.tx - f.fx) / f.T;
    b.vz = (f.tz - f.fz) / f.T;
    b.vy = -2;
  }

  giveBall(p, how) {
    const b = this.ball;
    b.state = 'held';
    b.carrier = p;
    b.f = null;
    b.lastTeam = p.team;
    p.jd.gotAt = this.liveT;
    if (how === 'pitch') {
      p.job = 'carrier';
      p.jd = { gotAt: this.liveT };
      this.reveal();
      if (this.isHuman(p)) p.lockUntil = this.liveT;
      p.setState('catch', 0.2);
      this.emit({ k: 'catch', id: p.id, pitch: true });
    }
  }

  checkCatch(f) {
    const b = this.ball;
    if (b.y > 3.6 || b.y < 0.15) return;
    const cands = [];
    for (const p of this.players) {
      // a diving player is laid out low and long: more reach along the ground, none up high
      const diving = p.state === 'dive' && p.st < DIVE_AIR + 0.06;
      if ((!p.upright && !diving) || p.state === 'engaged' || p === f.thrower || f.tried.has(p.id)) continue;
      const reach = diving ? 1.7 : 2.45 + p.y + (p.state === 'jump' ? 0.3 : 0);
      if (b.y > reach) continue;
      // the ball went under a leaping player
      if (!diving && p.y > 0.25 && b.y < p.y + 0.85) continue;
      const hx = diving ? p.x + Math.sin(p.face) * 0.5 : p.x;
      const hz = diving ? p.z + Math.cos(p.face) * 0.5 : p.z;
      const h = len(hx - b.x, hz - b.z);
      const rad = (p.state === 'jump' ? 1.2 : diving ? 1.3 : 0.95) + (f.intended === p ? 0.15 : 0);
      if (h < rad) cands.push({ p, h });
    }
    if (!cands.length) return;
    const offTeam = f.thrower.team;
    const offC = cands.filter((c) => c.p.team === offTeam).sort((a, c) => a.h - c.h)[0];
    const defC = cands.filter((c) => c.p.team !== offTeam).sort((a, c) => a.h - c.h)[0];
    const rng = this.rng;
    if (defC && (!offC || defC.h < offC.h - 0.2)) {
      f.tried.add(defC.p.id);
      let pInt = 0.06 + defC.p.hands * 0.25 + (defC.p.state === 'jump' ? 0.1 : 0) - (offC ? 0.08 : 0);
      if (this.isHuman(defC.p)) pInt += 0.1;
      pInt = clamp(pInt, 0.05, 0.5);
      if (rng() < pInt) return this.intercept(defC.p);
      if (rng() < 0.6) return this.deflect(defC.p, 'deflect');
    }
    if (offC) {
      f.tried.add(offC.p.id);
      const near = this.players.find((q) => q.team !== offTeam && q.upright && q.state !== 'engaged' && dist(q, offC.p) < 1.35);
      let pc = offC.p.hands * 0.95 + 0.14 - (near ? 0.28 : 0) - offC.h * 0.08 + (offC.p.state === 'jump' ? 0.05 : 0) - (offC.p.state === 'dive' ? 0.06 : 0);
      if (f.bullet) pc -= 0.05;
      if (f.intended !== offC.p) pc -= 0.15;
      pc *= offC.p.lvl.hands;
      pc = clamp(pc, 0.15, 0.97);
      if (rng() < pc) return this.completeCatch(offC.p);
      if (near && rng() < 0.08) return this.intercept(near);
      return this.deflect(offC.p, 'drop');
    }
  }

  deflect(p, why) {
    const b = this.ball;
    const f = b.f;
    f.resolved = true;
    const ang = this.rng.range(0, Math.PI * 2);
    const T = this.rng.range(0.45, 0.8);
    this.flight({ kind: 'dead', fx: b.x, fy: b.y, fz: b.z, tx: b.x + Math.sin(ang) * 2.5, ty: 0.1, tz: b.z + Math.cos(ang) * 2.5, T, apex: this.rng.range(0.4, 1.2) });
    this.emit({ k: why, id: p.id });
  }

  completeCatch(p) {
    const b = this.ball;
    b.f.resolved = true;
    b.state = 'held';
    b.carrier = p;
    b.f = null;
    if (Math.abs(p.x) > HALF_W) {
      // no feet in bounds
      b.state = 'air';
      b.carrier = null;
      this.flight({ kind: 'dead', fx: p.x, fy: 1.3, fz: p.z, tx: p.x + Math.sign(p.x) * 1.5, ty: 0.1, tz: p.z, T: 0.4, apex: 0.3 });
      this.emit({ k: 'oobCatch', id: p.id });
      return;
    }
    p.job = 'carrier';
    p.jd = { gotAt: this.liveT };
    // a leaping or diving catch plays out in the air
    if (p.state !== 'dive' && p.y <= 0.05) p.setState('catch', 0.22);
    this.passCaught = p;
    this.reveal();
    this.onPossession(p, false);
    this.emit({ k: 'catch', id: p.id });
  }

  intercept(p) {
    const b = this.ball;
    if (b.f) b.f.resolved = true;
    b.state = 'held';
    b.carrier = p;
    b.f = null;
    p.job = 'carrier';
    p.jd = { gotAt: this.liveT };
    if (p.state !== 'dive' && p.y <= 0.05) p.setState('catch', 0.22);
    p.gotInOwnEZ = dirOf(p.team) * p.z <= -GOAL;
    this.turnoverType = 'int';
    this.reveal();
    this.onPossession(p, true);
    this.emit({ k: 'int', id: p.id });
  }

  incomplete() {
    if (this.phase !== 'live') return;
    this.emit({ k: 'incomplete' });
    this.whistle('incomplete', { spotZ: this.losZ });
  }

  kickArrives(f) {
    const b = this.ball;
    // anyone on the receiving team close enough fields it
    let best = null;
    let bd = 1.8;
    for (const p of this.players) {
      if (p.team === this.off || !p.upright) continue;
      const d = len(p.x - b.x, p.z - b.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) {
      b.state = 'held';
      b.carrier = best;
      b.f = null;
      best.job = 'carrier';
      best.jd = { gotAt: this.liveT };
      best.setState('catch', 0.25);
      best.gotInOwnEZ = dirOf(best.team) * best.z <= -GOAL;
      this.clockRunning = true;
      this.reveal();
      this.onPossession(best, true, true);
      this.emit({ k: 'catch', id: best.id, kick: true });
      return;
    }
    // it hits the turf
    b.state = 'loose';
    b.f = null;
    b.vx = this.rng.range(-3, 3);
    b.vz = this.dir * this.rng.range(1, 4);
    b.vy = this.rng.range(2, 4);
    b.looseT = 0;
    this.looseFromKick = true;
    this.emit({ k: 'bounce' });
    this.onLoose();
  }

  fumble(x, z, why = 'hit') {
    const b = this.ball;
    const prev = b.carrier;
    b.state = 'loose';
    b.carrier = null;
    b.f = null;
    b.x = x;
    b.z = z;
    b.y = 1.1;
    const a = this.rng.range(0, Math.PI * 2);
    const sp = this.rng.range(2, 5);
    b.vx = Math.sin(a) * sp;
    b.vz = Math.cos(a) * sp;
    b.vy = this.rng.range(2.5, 4.5);
    b.looseT = 0;
    this.fumbled = true;
    if (prev) b.lastTeam = prev.team;
    this.emit({ k: 'fumble', why, id: prev ? prev.id : -1 });
    this.onLoose();
  }

  onLoose() {
    for (const p of this.players) {
      this.releaseEngagement(p);
      if (p.upright) p.job = 'recover';
    }
    this.reveal();
  }

  checkRecovery(dt) {
    const b = this.ball;
    if (b.y > 0.9) return;
    let best = null;
    let bd = 0.95;
    for (const p of this.players) {
      if (!(p.upright || p.state === 'dive')) continue;
      const d = len(p.x - b.x, p.z - b.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best && b.looseT > 3.5) {
      bd = Infinity;
      for (const p of this.players) {
        const d = len(p.x - b.x, p.z - b.z);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
    }
    if (!best) return;
    if (b.looseT < 3.5 && this.rng() > 1 - Math.pow(0.6, dt * 60)) return;
    const prevTeam = b.lastTeam;
    b.state = 'held';
    b.carrier = best;
    b.looseT = 0;
    best.job = 'carrier';
    best.jd = { gotAt: this.liveT };
    this.emit({ k: 'recover', id: best.id, team: best.team, lost: best.team !== prevTeam });
    if (this.looseFromKick && best.team === this.off) {
      // kicking team downs it
      this.whistle('downed', { spotZ: best.z, team: this.def });
      return;
    }
    if (best.team !== prevTeam) this.turnoverType = this.turnoverType || 'fumble';
    best.gotInOwnEZ = dirOf(best.team) * best.z <= -GOAL;
    this.onPossession(best, best.team !== this.poss);
    if (best.state === 'dive' || this.rng() < 0.45) {
      // falls on it
      best.setState('down', 1.2);
      this.whistle('tackle', { spotZ: best.z });
    }
  }

  onPossession(carrier, changed, kick = false) {
    this.poss = carrier.team;
    for (const p of this.players) {
      this.releaseEngagement(p);
      if (p === carrier) continue;
      if (p.team === carrier.team) {
        p.job = 'leadBlock';
      } else {
        p.job = 'pursue';
        if (!p.jd || p.jd.lead === undefined) p.jd = { lead: this.rng.range(0.55, 1) };
      }
    }
    if (changed || kick) {
      // human control follows the ball
      for (const team of [0, 1]) {
        if (!this.m.human[team]) continue;
        if (team === carrier.team) {
          this.ctrl[team] = carrier;
          carrier.lockUntil = 0;
        } else {
          let best = null;
          let bd = Infinity;
          for (const p of this.players) {
            if (p.team !== team || !p.upright) continue;
            const d = dist(p, carrier);
            if (d < bd) {
              bd = d;
              best = p;
            }
          }
          if (best) {
            this.ctrl[team] = best;
            best.lockUntil = 0;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------- blocking
  assignBlocks() {
    const poss = this.poss;
    const carrier = this.ball.carrier;
    const qb = this.slot[this.off].QB;
    const blockers = this.players.filter((p) => p.team === poss && BLOCK_JOBS.has(p.job) && p !== carrier && p.upright);
    const defenders = this.players.filter((p) => p.team !== poss && p.upright);
    this.blockTargets.clear();
    const taken = new Map();
    for (const b of blockers) {
      if (b.eng) {
        this.blockTargets.set(b.id, b.eng);
        taken.set(b.eng.id, (taken.get(b.eng.id) || 0) + 1);
      }
    }
    const pairs = [];
    for (const b of blockers) {
      if (b.eng) continue;
      for (const d of defenders) {
        const s = this.blockScore(b, d, carrier, qb);
        if (s < Infinity) pairs.push({ b, d, s });
      }
    }
    pairs.sort((a, c) => a.s - c.s);
    const used = new Set();
    for (const pr of pairs) {
      if (used.has(pr.b.id) || (taken.get(pr.d.id) || 0) >= 1) continue;
      used.add(pr.b.id);
      taken.set(pr.d.id, (taken.get(pr.d.id) || 0) + 1);
      this.blockTargets.set(pr.b.id, pr.d);
    }
    // leftovers double-team the most urgent threat
    for (const pr of pairs) {
      if (used.has(pr.b.id) || (taken.get(pr.d.id) || 0) >= 2) continue;
      used.add(pr.b.id);
      taken.set(pr.d.id, (taken.get(pr.d.id) || 0) + 1);
      this.blockTargets.set(pr.b.id, pr.d);
    }
  }

  blockScore(b, d, carrier, qb) {
    const job = b.job;
    if (job === 'passBlock' || job === 'screenBlock' || job === 'drawBlock' || job === 'fgBlock' || job === 'puntBlock') {
      const protect = this.kind === 'punt' ? this.slot[this.off].K : this.kind === 'fg' || this.kind === 'pat' ? this.slot[this.off].QB : qb;
      if (!protect) return Infinity;
      const dz = this.F(d).dz;
      if (dz > 9) return Infinity;
      if (d.job !== 'rush' && d.job !== 'pursue' && dist(d, protect) > 3.5) return Infinity;
      return dist(d, protect) + dist(b, d) * 0.8;
    }
    if (job === 'runBlock') {
      const db = dist(b, d);
      if (db > 8) return Infinity;
      const dz = this.F(d).dz;
      if (dz < -2) return Infinity;
      return db + Math.abs(this.F(d).dx - this.F(b).dx - (b.jd.runDir || 0) * 1.5) * 0.4;
    }
    // escort blocking: block whoever threatens the ball carrier
    const ref = carrier || this.ball;
    const goal = dirOf(this.poss);
    const ahead = (d.z - ref.z) * goal;
    if (ahead < -2.5) return Infinity;
    const dc = len(d.x - ref.x, d.z - ref.z);
    if (dc > 22) return Infinity;
    return dc + dist(b, d) * 0.7;
  }

  tryEngage(a, b) {
    let o;
    let d;
    if (a.team === this.poss) {
      o = a;
      d = b;
    } else {
      o = b;
      d = a;
    }
    if (o.team !== this.poss || d.team === this.poss) return false;
    if (!BLOCK_JOBS.has(o.job) || o.eng || o.state !== 'stand') return false;
    if (this.ball.carrier === o || this.ball.carrier === d) return false;
    if (!(d.state === 'stand' || d.state === 'engaged' || d.state === 'stumble')) return false;
    if ((d.immune[o.id] || 0) > this.t) return false;
    if (d.engBy.length >= 2) return false;
    // don't get sucked into a double team on the way to your own man
    if (d.engBy.length && this.blockTargets.get(o.id) !== d) return false;
    // pass protectors only take on people actually coming after the passer
    const pro = o.job === 'passBlock' || o.job === 'screenBlock' || o.job === 'drawBlock' || o.job === 'puntBlock' || o.job === 'fgBlock';
    if (pro && d.job !== 'rush' && d.job !== 'pursue' && this.blockTargets.get(o.id) !== d) return false;
    if (this.ball.state === 'air' && this.ball.f && this.ball.f.kind === 'pass' && d.job === 'ballHawk') return false;
    o.eng = d;
    o.setState('engaged');
    d.engBy.push(o);
    if (d.state !== 'engaged') {
      d.setState('engaged');
      d.shedT = this.shedTime(o, d);
    } else d.shedT += 0.6;
    d.armTried = false;
    return true;
  }

  shedTime(o, d) {
    const passPro = o.job === 'passBlock' || o.job === 'fgBlock' || o.job === 'puntBlock' || o.job === 'screenBlock' || o.job === 'drawBlock';
    const base = passPro ? this.rng.range(1.5, 3.3) : this.rng.range(1.0, 2.4);
    const mult = clamp(0.85 + (o.str - d.str) * 1.4, 0.45, 1.5);
    // a blitzing backer or safety picked up by a lineman slips him quicker than a tackle would
    const quick = passPro && d.pos !== 'DL' ? 0.62 : 1;
    return base * mult * quick * d.lvl.shed;
  }

  releaseEngagement(p) {
    if (p.eng) {
      const d = p.eng;
      d.engBy = d.engBy.filter((x) => x !== p);
      if (!d.engBy.length && d.state === 'engaged') d.setState('stand');
      p.eng = null;
      if (p.state === 'engaged') p.setState('stand');
    }
    if (p.engBy.length) {
      for (const o of p.engBy) {
        o.eng = null;
        if (o.state === 'engaged') o.setState('stand');
      }
      p.engBy = [];
      if (p.state === 'engaged') p.setState('stand');
    }
  }

  updateEngagements(dt) {
    const carrier = this.ball.carrier;
    for (const d of this.players) {
      if (!d.engBy.length) continue;
      d.engBy = d.engBy.filter((o) => o.eng === d && o.state === 'engaged');
      if (!d.engBy.length) {
        if (d.state === 'engaged') d.setState('stand');
        continue;
      }
      if (d.state !== 'engaged') {
        this.releaseEngagement(d);
        continue;
      }
      const o = d.engBy[0];
      // where the defender wants to go
      let ux = d.ix;
      let uz = d.iz;
      let ul = len(ux, uz);
      if (ul < 0.1) {
        ux = o.x - d.x;
        uz = o.z - d.z;
        ul = len(ux, uz) || 1;
      }
      ux /= ul;
      uz /= ul;
      const passPro = o.job === 'passBlock' || o.job === 'fgBlock' || o.job === 'puntBlock' || o.job === 'screenBlock' || o.job === 'drawBlock';
      let bStr = o.str;
      if (d.engBy.length > 1) bStr += d.engBy[1].str * 0.6;
      let vx;
      let vz;
      if (passPro) {
        const adv = clamp(0.5 + 1.3 * (d.str - bStr * 0.9), 0.1, 1.2);
        vx = ux * adv;
        vz = uz * adv;
      } else {
        // the blocker drives the defender back
        let bx = d.x - o.x;
        let bz = d.z - o.z;
        const bl = len(bx, bz) || 1;
        bx /= bl;
        bz /= bl;
        const drive = clamp(0.35 + 1.5 * (bStr - d.str * 0.85), -0.5, 1.5);
        vx = bx * drive + ux * 0.35;
        vz = bz * drive + uz * 0.35;
      }
      d.vx = vx;
      d.vz = vz;
      d.x += vx * dt;
      d.z += vz * dt;
      d.face = turnToward(d.face, angleOf(o.x - d.x, o.z - d.z), 10 * dt);
      // blockers stay glued between the defender and his target
      d.engBy.forEach((b, i) => {
        const side = i === 0 ? 0 : 0.55;
        const px = -uz * side;
        const pz = ux * side;
        b.x = d.x + ux * (d.r + b.r - 0.08) + px;
        b.z = d.z + uz * (d.r + b.r - 0.08) + pz;
        b.vx = vx;
        b.vz = vz;
        b.face = angleOf(d.x - b.x, d.z - b.z);
      });
      let rate = 1;
      if (d.engBy.length > 1) rate *= 0.55;
      if (this.isHuman(d)) rate *= 1.35;
      if (carrier && carrier.team !== d.team && this.carrierRunning && dist(carrier, d) > 4) rate *= 1.4;
      d.shedT -= dt * rate;
      // arm tackle on a runner squeezing past
      if (carrier && carrier.team !== d.team && !d.armTried && dist(carrier, d) < d.r + carrier.r + 0.45) {
        d.armTried = true;
        if (this.rng() < 0.3 * d.tkl) {
          this.releaseEngagement(d);
          d.immune[o.id] = this.t + 1;
          this.resolveTackle(d, carrier, true);
          continue;
        }
      }
      if (d.shedT <= 0) this.shed(d);
    }
  }

  shed(d) {
    for (const o of d.engBy) {
      o.eng = null;
      o.setState('stumble', 0.4);
      d.immune[o.id] = this.t + 1.1;
    }
    d.engBy = [];
    d.setState('stand');
    d.burst = 0.35;
  }

  // ------------------------------------------------------------- physics
  turboAllowed(p) {
    const side = this.poss === p.team ? 'off' : 'def';
    if (this.m.fire[p.team][side]) return true;
    if (this.isHuman(p)) return this.m.turbo[p.team] > 0.01;
    return p.tm > 0.02;
  }

  integrate(p, dt) {
    p.st += dt;
    const st = p.state;
    if (st === 'down') {
      const f = Math.max(0, 1 - 7 * dt);
      p.vx *= f;
      p.vz *= f;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.y = 0;
      if (p.st >= p.stDur && this.phase !== 'dead') p.setState('getup', 0.45);
      else if (p.st >= p.stDur + 0.6) p.setState('getup', 0.45);
      return;
    }
    if (st === 'getup') {
      p.vx = 0;
      p.vz = 0;
      if (p.st >= p.stDur) p.setState('stand');
      return;
    }
    if (st === 'flying') {
      p.vy -= HIT_GRAVITY * dt;
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      if (p.y <= 0 && p.vy < 0) {
        p.y = 0;
        p.vx *= 0.35;
        p.vz *= 0.35;
        p.setState('down', 1.7);
      }
      return;
    }
    if (st === 'dive') {
      if (p.y > 0 || p.vy > 0) {
        p.vy -= AIR_GRAVITY * dt;
        p.y += p.vy * dt;
        if (p.y <= 0) {
          // belly-flop into the turf
          p.y = 0;
          p.vy = 0;
          p.vx *= 0.6;
          p.vz *= 0.6;
        }
      } else {
        const f = Math.max(0, 1 - 6 * dt);
        p.vx *= f;
        p.vz *= f;
      }
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      if (p.st >= p.stDur) {
        p.fallFwd = true;
        p.y = 0;
        p.setState('down', 0.6);
      }
      return;
    }
    if (st === 'engaged' || st === 'stance' || st === 'kneel') {
      if (st !== 'engaged') {
        p.vx = 0;
        p.vz = 0;
      }
      return;
    }
    // ---- normal locomotion
    const human = this.isHuman(p);
    let max = p.spd * (human ? 1 : p.lvl.speed);
    const wantT = p.wantTurbo && this.turboAllowed(p);
    p.turboOn = wantT && len(p.ix, p.iz) > 0.3;
    if (p.turboOn) max *= TURBO_MULT;
    if (p.burst > 0) max *= 1.1;
    if (this.ball.carrier === p) max *= 0.97;
    if (st === 'stumble') max *= 0.5;
    else if (st === 'throw') max *= 0.4;
    else if (st === 'catch') max *= 0.8;
    else if (st === 'spin') max *= 0.92;
    else if (st === 'kick') max *= 0.3;
    else if (st === 'celebrate') max *= 0.5;
    // turbo bookkeeping
    const side = this.poss === p.team ? 'off' : 'def';
    const onFire = this.m.fire[p.team][side];
    if (p.turboOn && !onFire) {
      if (human) this.m.turbo[p.team] = Math.max(0, this.m.turbo[p.team] - TURBO_DRAIN * dt);
      else p.tm = Math.max(0, p.tm - TURBO_DRAIN * dt);
    } else if (!p.turboOn) {
      if (human) this.m.turbo[p.team] = Math.min(1, this.m.turbo[p.team] + TURBO_REGEN * dt);
      else p.tm = Math.min(1, p.tm + TURBO_REGEN * dt);
    }
    const tvx = p.ix * max;
    const tvz = p.iz * max;
    let ax = tvx - p.vx;
    let az = tvz - p.vz;
    const al = len(ax, az);
    // the player you steer gets an arcade edge: quicker off the mark, stops and cuts on a dime
    let acc = p.acc * (p.turboOn ? 1.2 : 1) * (human ? 1.5 : 1);
    // little steering in the air: a leap carries the run-up's momentum
    if (p.y > 0) acc *= 0.35;
    if (p.vx * tvx + p.vz * tvz < 0) acc *= human ? 1.9 : 1.6;
    else if (human && tvx === 0 && tvz === 0) acc *= 1.4;
    const maxDv = acc * dt;
    if (al > maxDv) {
      ax = (ax / al) * maxDv;
      az = (az / al) * maxDv;
    }
    p.vx += ax;
    p.vz += az;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    // facing
    const sp = p.speed;
    if (st !== 'spin') {
      let target = null;
      // a quarterback dropping or drifting back keeps his eyes downfield
      if (p.job === 'qbPass' && this.dir * p.vz < -0.4) target = angleOf(p.vx * 0.35, this.dir);
      else if (sp > 0.8) target = angleOf(p.vx, p.vz);
      else if (len(p.ix, p.iz) > 0.1) target = angleOf(p.ix, p.iz);
      if (target !== null) p.face = turnToward(p.face, target, (human ? 18 : 13) * dt);
    }
    // jumping
    if (p.y > 0 || p.vy > 0) {
      p.vy -= AIR_GRAVITY * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        if (st === 'jump' || st === 'hurdle') p.setState('stand');
      }
    }
    if (TIMED_STATES.has(st) && p.st >= p.stDur) p.setState('stand');
    // keep everyone near the field
    p.x = clamp(p.x, -HALF_W - 5, HALF_W + 5);
    p.z = clamp(p.z, -END - 5, END + 5);
  }

  resolveContacts() {
    const P = this.players;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (!SOLID_STATES.has(a.state)) continue;
      for (let j = i + 1; j < P.length; j++) {
        const b = P[j];
        if (!SOLID_STATES.has(b.state)) continue;
        if (a.eng === b || b.eng === a) continue;
        if (a.eng && b.eng && a.eng === b.eng) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const R = a.r + b.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R || d2 < 1e-8) continue;
        if (a.team !== b.team && this.phase === 'live' && this.tryEngage(a, b)) continue;
        const d = Math.sqrt(d2);
        const ov = R - d;
        const nx = dx / d;
        const nz = dz / d;
        const wa = b.mass / (a.mass + b.mass);
        const wb = a.mass / (a.mass + b.mass);
        if (a.state !== 'engaged') {
          a.x -= nx * ov * wa;
          a.z -= nz * ov * wa;
        }
        if (b.state !== 'engaged') {
          b.x += nx * ov * wb;
          b.z += nz * ov * wb;
        }
      }
    }
  }

  // ------------------------------------------------------------- tackling
  checkTackles() {
    const c = this.ball.carrier;
    if (c && this.ball.state === 'held' && c.state === 'down') {
      // college rules: a runner who hits the ground is down, touched or not (diving catches)
      this.carrierDown(c, c.x, c.z);
      return;
    }
    if (!c || this.ball.state !== 'held' || !(c.upright || c.state === 'dive')) return;
    if (c.state === 'kneel') return;
    for (const d of this.players) {
      if (d.team === c.team || d.tackleCd > 0) continue;
      if (!(d.upright || d.state === 'dive') || d.state === 'engaged' || d.state === 'kneel') continue;
      let px = d.x;
      let pz = d.z;
      let reach = d.r + c.r + 0.12;
      if (d.state === 'dive') {
        // laid out: the arms are well ahead of the hips, and the slide still trips a runner
        if (d.st > DIVE_AIR + 0.12) continue;
        px += Math.sin(d.face) * 0.6;
        pz += Math.cos(d.face) * 0.6;
        reach += 0.45;
      }
      if (len(px - c.x, pz - c.z) < reach) {
        this.resolveTackle(d, c, false);
        if (this.phase !== 'live' || this.ball.carrier !== c) return;
      }
    }
  }

  resolveTackle(d, c, arm) {
    const rng = this.rng;
    d.tackleCd = 0.45;
    // evasive moves
    const diving = d.state === 'dive';
    if (c.state === 'spin' && !c.spinUsed) {
      c.spinUsed = true;
      d.tackleCd = 0.7;
      if (!diving) d.setState('stumble', 0.45);
      this.emit({ k: 'juke', id: c.id, by: d.id });
      return;
    }
    if (c.state === 'hurdle' && c.y > 0.3 && (d.state === 'dive' || rng() < 0.55)) {
      d.tackleCd = 0.7;
      this.emit({ k: 'hurdled', id: c.id, by: d.id });
      return;
    }
    if (c.state === 'stiff' && !diving) {
      const fx = Math.sin(c.face);
      const fz = Math.cos(c.face);
      const toward = ((d.x - c.x) * fx + (d.z - c.z) * fz) / (dist(c, d) || 1);
      if (toward > -0.2 && rng() < clamp(0.55 + (c.str - d.str) * 0.8, 0.3, 0.85)) {
        this.knockDown(d, c.x, c.z, 1.1);
        d.tackleCd = 1;
        this.emit({ k: 'stiffArmed', id: c.id, by: d.id });
        return;
      }
    }
    // broken tackle?
    let pBreak = 0.06 + 0.22 * (c.str - d.tkl * 0.8) + (c.turboOn ? 0.05 : 0) - (d.turboOn ? 0.04 : 0);
    if (arm) pBreak += 0.3;
    if (d.state === 'dive') pBreak += 0.04;
    if (c.slot === 'QB' && !this.carrierRunning) pBreak *= 0.5;
    const helpers = this.players.filter((q) => q.team === d.team && q !== d && q.upright && dist(q, c) < 1.6).length;
    pBreak -= helpers * 0.08;
    if (this.m.fire[c.team].off) pBreak += 0.08;
    pBreak = clamp(pBreak, 0.02, 0.45);
    if (diving) pBreak += 0.1;
    if (rng() < pBreak) {
      c.setState('stumble', 0.32);
      if (d.state !== 'dive') d.setState('stumble', 0.55);
      d.tackleCd = 1.0;
      this.emit({ k: 'broken', id: c.id, by: d.id });
      return;
    }
    // the tackle
    const rel = len(d.vx - c.vx, d.vz - c.vz);
    const fire = this.m.fire[d.team].def;
    // a receiver hit in the air goes for a ride
    const big = !arm && ((d.turboOn && rel > 8.5 && rng() < 0.55) || (rel > 12 && rng() < 0.3) || (fire && rng() < 0.45) || (c.y > 0.35 && rng() < 0.6));
    const sack = c.slot === 'QB' && c.team === this.off && !this.passThrown && this.dir * (c.z - this.losZ) < 0 && this.kind === 'scrimmage' && this.offPlay && this.offPlay.type === 'pass';
    const spotZ = c.z;
    const spotX = c.x;
    let fumbleP = big ? 0.065 : 0.012;
    if (sack) fumbleP += 0.05;
    if (fire) fumbleP += 0.04;
    const fumbled = rng() < fumbleP;
    // who falls where
    const hx = d.vx;
    const hz = d.vz;
    const hl = len(hx, hz) || 1;
    if (big) {
      c.vx = (hx / hl) * 5 + c.vx * 0.25;
      c.vz = (hz / hl) * 5 + c.vz * 0.25;
      c.vy = rng.range(5.5, 7.5);
      c.y = 0.05;
      c.fallFwd = Math.sin(c.face) * hx + Math.cos(c.face) * hz > 0;
      c.setState('flying');
      if (!diving) d.setState('stumble', 0.5);
      d.vx *= 0.3;
      d.vz *= 0.3;
      this.bigHit = true;
      this.m.hitStop(0.09, 0.55);
    } else {
      c.fallFwd = Math.sin(c.face) * hx + Math.cos(c.face) * hz > 0;
      c.vx = c.vx * 0.4 + (hx / hl) * 1.5;
      c.vz = c.vz * 0.4 + (hz / hl) * 1.5;
      c.setState('down', 1.4);
      d.fallFwd = true;
      // a diver keeps flying and lands on top of him
      d.vx *= diving ? 0.35 : 0.5;
      d.vz *= diving ? 0.35 : 0.5;
      if (!diving) d.setState('down', 1.0);
    }
    this.lastTackle = { by: d.id, on: c.id, big, x: spotX, z: spotZ };
    this.emit({ k: 'tackle', id: c.id, by: d.id, big, sack, x: Math.round(spotX * 10) / 10, z: Math.round(spotZ * 10) / 10 });
    if (fumbled && !(dirOf(c.team) * spotZ >= GOAL)) {
      this.fumble(spotX, spotZ, big ? 'bigHit' : 'hit');
      return;
    }
    this.carrierDown(c, spotX, spotZ, { sack, by: d.id });
  }

  carrierDown(c, x, z, extra = {}) {
    const g = dirOf(c.team) * z;
    if (g >= GOAL) return this.touchdown(c);
    if (g <= -GOAL) {
      if (c.gotInOwnEZ && !c.leftEZ) return this.whistle('touchback', { team: c.team });
      return this.whistle('safety', { team: c.team });
    }
    this.whistle('tackle', { spotZ: z, spotX: x, ...extra });
  }

  checkBounds() {
    const c = this.ball.carrier;
    if (!c || this.ball.state !== 'held') return;
    const g = dirOf(c.team) * c.z;
    if (g > -GOAL + 0.01) c.leftEZ = true;
    if (g >= GOAL && c.state !== 'down') return this.touchdown(c);
    if (Math.abs(c.x) > HALF_W) {
      this.emit({ k: 'oob', id: c.id });
      if (g >= GOAL) return this.touchdown(c);
      if (g <= -GOAL) {
        if (c.gotInOwnEZ && !c.leftEZ) return this.whistle('touchback', { team: c.team });
        return this.whistle('safety', { team: c.team });
      }
      return this.whistle('oob', { spotZ: c.z, spotX: Math.sign(c.x) * HALF_W });
    }
    if (g <= -END) {
      if (c.gotInOwnEZ && !c.leftEZ) return this.whistle('touchback', { team: c.team });
      return this.whistle('safety', { team: c.team });
    }
  }

  touchdown(c) {
    if (this.phase !== 'live') return;
    this.emit({ k: 'td', id: c.id, team: c.team });
    this.scorer = c;
    this.whistle('td', { team: c.team, spotZ: c.z });
    this.deadDur = 3.4;
    // put it on the board right away (conversions settle after the play)
    if (this.kind === 'scrimmage') {
      this.m.addScore(c.team, 6);
      this.result.scored = true;
    }
  }

  whistle(type, data = {}) {
    if (this.phase !== 'live') return;
    this.phase = 'dead';
    this.deadT = 0;
    this.clockRunning = false;
    const c = this.ball.carrier;
    const team = data.team !== undefined ? data.team : c ? c.team : this.ball.lastTeam;
    this.result = {
      type,
      team,
      spotZ: data.spotZ !== undefined ? data.spotZ : c ? c.z : this.ball.z,
      good: data.good,
      sack: !!data.sack,
      turnover: this.turnoverType,
      passThrown: this.passThrown,
      passComplete: !!this.passCaught && this.passCaught.team === this.off,
      receiver: this.passCaught ? this.passCaught.id : -1,
      carrier: c ? c.id : -1,
      carrierSlot: c ? c.slot : null,
      big: this.bigHit,
      kind: this.kind,
    };
    this.lateTeam = null;
    for (const p of this.players) {
      if (p.state === 'engaged') this.releaseEngagement(p);
    }
    this.emit({ k: 'whistle', type });
  }

  // ------------------------------------------------------------- after the whistle
  stepDead(dt, inputs) {
    this.deadT += dt;
    const res = this.result;
    for (const p of this.players) {
      p.humanDriven = false;
      p.wantTurbo = false;
      if (res && res.type === 'td' && p === this.scorer && p.upright) {
        if (p.state !== 'celebrate' && this.deadT > 0.35) p.setState('celebrate');
        p.ix = 0;
        p.iz = 0;
        continue;
      }
      if (res && res.type === 'td' && p.team === res.team && p.upright && this.deadT > 0.6 && this.scorer) {
        // teammates run over to celebrate
        const d = dist(p, this.scorer);
        if (d > 2.2) {
          p.ix = (this.scorer.x - p.x) / d * 0.7;
          p.iz = (this.scorer.z - p.z) / d * 0.7;
        } else {
          p.ix = 0;
          p.iz = 0;
        }
        continue;
      }
      // coast to a stop
      p.ix *= 0.9;
      p.iz *= 0.9;
      if (len(p.ix, p.iz) < 0.05) {
        p.ix = 0;
        p.iz = 0;
      }
    }
    // late hits by whoever the humans are steering
    for (const team of [0, 1]) {
      if (!this.m.human[team] || this.deadT > 1.6) continue;
      const p = this.ctrl[team];
      if (!p || !p.upright) continue;
      const inp = inputs[team];
      const wx = -this.dir * inp.mx;
      const wz = this.dir * inp.my;
      const l = len(wx, wz);
      if (l > 0.15) {
        p.ix = (wx / l) * Math.min(1, l);
        p.iz = (wz / l) * Math.min(1, l);
      }
      p.wantTurbo = !!inp.turbo;
      p.humanDriven = true;
      this.consume(team, 'a');
      this.consume(team, 'j');
      if (this.consume(team, 's')) this.doDive(p);
      for (const q of this.players) {
        if (q.team === team || !q.upright || this.lateHits.has(q.id)) continue;
        const reach = p.r + q.r + (p.state === 'dive' ? 0.5 : 0.1);
        if (dist(p, q) < reach && (p.speed > 5 || p.state === 'dive')) {
          this.lateHits.add(q.id);
          if (p.turboOn || p.state === 'dive') {
            q.vx = p.vx * 0.6;
            q.vz = p.vz * 0.6;
            q.vy = 4.5;
            q.y = 0.05;
            q.fallFwd = false;
            q.setState('flying');
          } else this.knockDown(q, p.x, p.z, 1.1);
          this.emit({ k: 'lateHit', id: q.id, by: p.id, x: q.x, z: q.z });
        }
      }
    }
    for (const p of this.players) this.integrate(p, dt);
    this.resolveContacts();
    this.updateBall(dt);
    if (res && res.type === 'td' && this.scorer && this.deadT > 1.0 && this.ball.state === 'held' && this.ball.carrier === this.scorer && this.rng() < 0.03) {
      // spike it
      const b = this.ball;
      b.state = 'bounce';
      b.carrier = null;
      b.vx = Math.sin(this.scorer.face) * 2;
      b.vz = Math.cos(this.scorer.face) * 2;
      b.vy = -9;
      this.emit({ k: 'spike', id: this.scorer.id });
    }
    if (this.deadT >= this.deadDur) this.finished = true;
  }
}

export function fgChance(yards) {
  const table = [[20, 0.98], [30, 0.95], [35, 0.92], [40, 0.86], [45, 0.78], [50, 0.66], [55, 0.5], [60, 0.32], [65, 0.12], [70, 0.03]];
  if (yards <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (yards <= table[i][0]) {
      const [y0, p0] = table[i - 1];
      const [y1, p1] = table[i];
      return p0 + ((yards - y0) / (y1 - y0)) * (p1 - p0);
    }
  }
  return 0.01;
}

export { wrapAngle };
