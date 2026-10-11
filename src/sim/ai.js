// AI for every player who isn't being steered by a human.
// Each job sets p.ix/p.iz (desired direction scaled 0..1) and p.wantTurbo.

import { HALF_W, GOAL, dirOf } from './constants.js';
import { clamp, lerp, len, dist } from './math.js';

function seek(p, tx, tz, arrive = 0.01, frac = 1) {
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.03) {
    p.ix = 0;
    p.iz = 0;
    return d;
  }
  const m = Math.min(1, d / Math.max(arrive, 0.01)) * frac;
  p.ix = (dx / d) * m;
  p.iz = (dz / d) * m;
  return d;
}

function stop(p) {
  p.ix = 0;
  p.iz = 0;
}

function turbo(p, want) {
  p.wantTurbo = !!want && p.tm > 0.12;
}

function opponents(play, p) {
  return play.players.filter((q) => q.team !== p.team);
}

function nearestOpp(play, p, uprightOnly = true) {
  let best = null;
  let bd = Infinity;
  for (const q of play.players) {
    if (q.team === p.team) continue;
    if (uprightOnly && (!q.upright || q.state === 'engaged')) continue;
    const d = dist(p, q);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best ? { p: best, d: bd } : null;
}

// Defensive "has the play declared itself?" check, with per-player reaction time.
function readRun(play, p) {
  const b = play.ball;
  if (!play.carrierRunning || b.state !== 'held' || !b.carrier || b.carrier.team === p.team) return false;
  // pass defenders are reading the quarterback first, so they're late to a run
  const cover = p.job === 'zone' || p.job === 'man' || p.job === 'spy';
  const hesitate = cover && !play.passThrown && b.carrier.slot !== 'QB' ? 0.35 : 0;
  return play.liveT > play.revealT + p.react + hesitate;
}

// Defenders break on a thrown ball if they can get there.
function hawk(play, p) {
  const b = play.ball;
  if (b.state !== 'air' || !b.f || b.f.kind !== 'pass' || b.f.resolved || !b.f.intended) return false;
  const f = b.f;
  if (f.t < p.react) return false;
  const tLeft = f.T - f.t;
  const d = len(f.tx - p.x, f.tz - p.z);
  if (d > p.spd * Math.max(0, tLeft - 0.05) + 1.6) return false;
  let ux = f.fx - f.tx;
  let uz = f.fz - f.tz;
  const ul = len(ux, uz) || 1;
  ux /= ul;
  uz /= ul;
  seek(p, f.tx + ux * 0.5, f.tz + uz * 0.5, 0.25);
  turbo(p, d > 1.5 && d < 5);
  maybeJumpForBall(play, p);
  return true;
}

function maybeJumpForBall(play, p) {
  const b = play.ball;
  if (b.state !== 'air' || !b.f || b.f.kind !== 'pass' || p.y > 0 || p.actCd > 0) return;
  const h = len(b.x - p.x, b.z - p.z);
  const desc = b.f.t > b.f.T * 0.5;
  if (desc && h < 1.6 && b.y > 2.2 && b.y < 3.4 && play.rng() < 0.35) play.doJump(p);
}

export function runAI(play, p, dt) {
  if (p.state === 'down' || p.state === 'flying' || p.state === 'getup' || p.state === 'dive') {
    stop(p);
    return;
  }
  p.wantTurbo = false;
  if (p.state === 'engaged') {
    engagedIntent(play, p);
    return;
  }
  const fn = JOBS[p.job] || JOBS.idle;
  fn(play, p, dt);
}

function engagedIntent(play, p) {
  // defender keeps pushing toward what he wants; blocker leans into the defender
  if (p.eng) {
    seek(p, p.eng.x, p.eng.z);
    return;
  }
  const b = play.ball;
  let t = b.carrier || b;
  if (!play.carrierRunning && b.carrier && b.carrier.team !== p.team) t = b.carrier;
  seek(p, t.x, t.z);
}

// ---------------------------------------------------------------- routes
function followRoute(play, p, dt) {
  const r = p.route;
  if (!r) return stop(p);
  while (r.i < r.pts.length) {
    const pt = r.pts[r.i];
    const d = len(pt.x - p.x, pt.z - p.z);
    if (d < 0.7) {
      if (pt.wait && !r.waited) {
        r.waited = true;
        r.waitT = pt.wait;
      }
      if (r.waitT > 0) {
        r.waitT -= dt;
        seek(p, pt.x, pt.z, 0.6, 0.4);
        return;
      }
      r.i++;
      r.waited = false;
      continue;
    }
    break;
  }
  if (r.i >= r.pts.length) {
    const last = r.pts[r.pts.length - 1];
    if (last.sit) {
      // settle and work back to the quarterback a touch
      const qb = play.slot[p.team] && play.slot[p.team].QB;
      if (qb) {
        const ux = qb.x - last.x;
        const uz = qb.z - last.z;
        const ul = len(ux, uz) || 1;
        seek(p, last.x + (ux / ul) * 0.6, last.z + (uz / ul) * 0.6, 0.8, 0.5);
      } else seek(p, last.x, last.z, 0.8);
      r.done = true;
      return;
    }
    let ex = r.ex;
    let ez = r.ez;
    // bend upfield when the sideline gets close
    if (Math.abs(p.x) > HALF_W - 2.5 && Math.sign(ex) === Math.sign(p.x)) {
      ex = 0;
      ez = Math.sign(ez || play.dir);
    }
    // stay out of the back of the end zone
    if (dirOf(p.team) * p.z > 57) {
      ez = 0;
      ex = -Math.sign(p.x) || 1;
    }
    p.ix = ex;
    p.iz = ez;
    r.done = true;
    return;
  }
  const pt = r.pts[r.i];
  seek(p, pt.x, pt.z, 0.01);
}

// ---------------------------------------------------------------- offense
function qbPass(play, p) {
  const jd = p.jd;
  const b = play.ball;
  if (b.carrier !== p) {
    seek(p, jd.drop.x, jd.drop.z, 0.8);
    return;
  }
  if (!play.canPass(p)) {
    p.job = 'carrier';
    return;
  }
  const threat = nearestOpp(play, p);
  const pressure = threat && threat.d < 2.8;
  if (play.liveT < jd.dropEnd) {
    seek(p, jd.drop.x, jd.drop.z, 0.8);
  } else if (pressure) {
    // slide away from the rush but stay behind the line
    let ax = p.x - threat.p.x;
    let az = p.z - threat.p.z;
    const al = len(ax, az) || 1;
    ax /= al;
    az /= al;
    let tx = p.x + ax * 3;
    let tz = p.z + az * 3;
    const maxZ = play.losZ - play.dir * 1.5;
    if (play.dir * (tz - maxZ) > 0) tz = maxZ;
    tx = clamp(tx, -HALF_W + 3, HALF_W - 3);
    seek(p, tx, tz, 0.4);
    turbo(p, threat.d < 1.8);
  } else {
    seek(p, jd.drop.x, jd.drop.z, 1.0, 0.4);
  }
  if (play.liveT < jd.nextRead) return;
  jd.nextRead = play.liveT + 0.15;
  const elapsed = play.liveT - jd.readAt;
  if (elapsed < 0) return;
  const togo = play.fdZ !== null ? play.dir * (play.fdZ - play.losZ) : GOAL - play.dir * play.losZ;
  const best = play.bestTarget(p, togo);
  const thresh = lerp(3.4, 0.5, clamp(elapsed / (2.6 * p.lvl.qbRead), 0, 1));
  if (best && (best.open > thresh || (pressure && best.open > 0.8))) {
    play.throwPass(p, best.rec, best.bullet);
    return;
  }
  if (pressure && threat.d < 1.4) {
    if (best && best.open > -0.3 && play.rng() < 0.5) return play.throwPass(p, best.rec, true);
    if (play.rng() < 0.25) return play.throwAway(p);
  }
  if (elapsed > 3.4) {
    if (best && best.open > 0 && play.rng() < 0.6) return play.throwPass(p, best.rec, best.bullet);
    // tuck it and run
    p.job = 'carrier';
    p.jd = { scramble: true };
  }
}

function qbHand(play, p) {
  // step to the mesh point and wait for the back
  const pt = p.route && p.route.pts[0];
  if (pt) seek(p, pt.x, pt.z, 0.5, 0.8);
  else stop(p);
}

function qbPitch(play, p) {
  stop(p);
}

function fake(play, p, dt) {
  if (p.route && p.route.i === 0 && p.route.pts.length > 1) p.route.i = 1;
  if (p.route && p.route.i < p.route.pts.length) followRoute(play, p, dt);
  else {
    p.ix *= 0.9;
    p.iz *= 0.9;
  }
}

function carrierPath(play, p, dt) {
  followRoute(play, p, dt);
  const past = play.dir * (p.z - play.losZ) > 1.5;
  if (p.route.done || past) p.job = 'carrier';
}

function rbPath(play, p, dt) {
  followRoute(play, p, dt);
  if (p.route.done && play.ball.carrier !== p) p.job = 'leadBlock';
}

function leadPath(play, p, dt) {
  followRoute(play, p, dt);
  if (p.route.done) p.job = 'leadBlock';
}

function route(play, p, dt) {
  followRoute(play, p, dt);
  // scramble drill: when the QB is on the move, settle into space facing him
  const b = play.ball;
  if (b.state === 'held' && b.carrier && b.carrier.slot === 'QB' && b.carrier.team === p.team && b.carrier.job === 'carrier' && p.route && p.route.done) {
    const q = nearestOpp(play, p);
    if (q && q.d < 3) {
      const ax = p.x - q.p.x;
      const az = p.z - q.p.z;
      const al = len(ax, az) || 1;
      seek(p, p.x + (ax / al) * 3, p.z + (az / al) * 3, 0.5, 0.8);
    }
  }
}

function catchBall(play, p) {
  const b = play.ball;
  if (!(b.state === 'air' && b.f && b.f.kind === 'pass' && b.f.intended === p && !b.f.resolved)) {
    p.job = p.route ? 'route' : 'idle';
    return;
  }
  const f = b.f;
  const tLeft = Math.max(0.02, f.T - f.t);
  const d = len(f.tx - p.x, f.tz - p.z);
  const need = d / tLeft;
  const frac = clamp(need / p.spd, 0.3, 1);
  seek(p, f.tx, f.tz, 0.25, d > 1.2 ? 1 : frac);
  turbo(p, need > p.spd * 0.95);
  maybeJumpForBall(play, p);
}

function passBlock(play, p) {
  const t = play.blockTargets.get(p.id);
  const protect = protecteeOf(play, p);
  const anchor = p.jd.anchor || p.home;
  if (t && protect) {
    let ux = protect.x - t.x;
    let uz = protect.z - t.z;
    const ul = len(ux, uz) || 1;
    ux /= ul;
    uz /= ul;
    let tx = t.x + ux * 0.9;
    let tz = t.z + uz * 0.9;
    // a rusher looping around a pile: drop into the pocket and meet him on his way to the passer
    if (t.state !== 'engaged' && pathBlocked(play, p, tx, tz)) {
      const dq = len(t.x - protect.x, t.z - protect.z);
      const r = clamp(dq - 0.9, 1.2, 2.4);
      tx = protect.x - ux * r;
      tz = protect.z - uz * r;
    }
    // hold the pocket: never chase past the line, never drift far from home
    const maxZ = play.losZ - play.dir * 0.6;
    if (play.dir * (tz - maxZ) > 0) tz = maxZ;
    const ax = tx - anchor.x;
    const az = tz - anchor.z;
    const al = len(ax, az);
    if (al > 2.6) {
      tx = anchor.x + (ax / al) * 2.6;
      tz = anchor.z + (az / al) * 2.6;
    }
    seek(p, tx, tz, 0.25);
  } else seek(p, anchor.x, anchor.z, 0.8, 0.6);
}

// Is there an engaged pile between p and the spot he wants?
function pathBlocked(play, p, tx, tz) {
  const dx = tx - p.x;
  const dz = tz - p.z;
  const L = len(dx, dz);
  if (L < 0.5) return false;
  const ux = dx / L;
  const uz = dz / L;
  for (const q of play.players) {
    if (q === p || q.state !== 'engaged') continue;
    const rx = q.x - p.x;
    const rz = q.z - p.z;
    const along = rx * ux + rz * uz;
    if (along < 0.2 || along > L) continue;
    if (Math.abs(rx * uz - rz * ux) < p.r + q.r) return true;
  }
  return false;
}

function protecteeOf(play, p) {
  const s = play.slot[play.off];
  if (play.kind === 'punt') return s.K;
  if (play.kind === 'fg' || play.kind === 'pat') return s.QB;
  return s.QB;
}

function screenBlock(play, p) {
  if (play.liveT < 0.95) return passBlock(play, p);
  const side = p.jd.side || -1;
  const f = play.F(p.home);
  const w = play.W(side * 6 + f.dx * 0.6, -1.2);
  seek(p, w.x, w.z, 0.6);
}

function drawBlock(play, p) {
  if (play.liveT < 0.85) return passBlock(play, p);
  p.job = 'runBlock';
  runBlock(play, p);
}

function runBlock(play, p) {
  const t = play.blockTargets.get(p.id);
  const rx = -play.dir * (p.jd.runDir || 0);
  if (play.liveT < 0.18) {
    seek(p, p.x + rx * 1.2, p.z + play.dir * 1.5);
    return;
  }
  if (t) {
    seek(p, t.x, t.z);
    return;
  }
  seek(p, p.x + rx * 2, play.losZ + play.dir * 5, 0.8);
}

function stalk(play, p, dt) {
  if (!play.carrierRunning && p.route && !p.route.done) {
    followRoute(play, p, dt);
    return;
  }
  const t = play.blockTargets.get(p.id);
  if (t) {
    seek(p, t.x, t.z);
    return;
  }
  stop(p);
}

function leadBlock(play, p) {
  const b = play.ball;
  const c = b.carrier;
  if (!c) {
    if (b.state === 'loose') return recover(play, p);
    p.ix *= 0.9;
    p.iz *= 0.9;
    return;
  }
  const t = play.blockTargets.get(p.id);
  if (t) {
    let ux = c.x - t.x;
    let uz = c.z - t.z;
    const ul = len(ux, uz) || 1;
    ux /= ul;
    uz /= ul;
    const d = seek(p, t.x + ux * 0.7, t.z + uz * 0.7, 0.01);
    turbo(p, d > 3 && d < 15);
    return;
  }
  // escort ahead of the runner
  const g = dirOf(c.team);
  const side = p.x >= c.x ? 1 : -1;
  seek(p, c.x + side * 2.5, c.z + g * 4.5, 0.6);
}

function carrier(play, p) {
  const g = dirOf(p.team);
  // a CPU quarterback on the move can still find someone
  if (p.slot === 'QB' && play.canPass(p) && play.liveT >= (p.jd.nextRead || 0)) {
    p.jd.nextRead = play.liveT + 0.25;
    const togo = play.fdZ !== null ? play.dir * (play.fdZ - play.losZ) : 10;
    const best = play.bestTarget(p, togo);
    if (best && best.open > 1.6) return play.throwPass(p, best.rec, best.bullet);
  }
  const toGoal = GOAL - g * p.z;
  const opps = opponents(play, p).filter((q) => q.upright || q.state === 'dive');
  let bestAng = 0;
  let bestScore = -Infinity;
  const last = p.jd.lastAng || 0;
  for (let k = -6; k <= 6; k++) {
    const ang = k * (Math.PI / 14);
    const dx = Math.sin(ang);
    const dz = Math.cos(ang) * g;
    let score = Math.cos(ang) * (toGoal < 8 ? 2.4 : 1.2);
    for (const q of opps) {
      const w = q.state === 'engaged' ? 0.25 : 1;
      for (const probe of [2.0, 4.5]) {
        const px = p.x + dx * probe;
        const pz = p.z + dz * probe;
        const d = len(q.x - px, q.z - pz);
        if (d < 4.5) score -= w * (4.5 - d) * (4.5 - d) * (probe === 2.0 ? 0.12 : 0.07);
      }
    }
    const sx = Math.abs(p.x + dx * 4);
    if (sx > HALF_W - 2.5) score -= (sx - (HALF_W - 2.5)) * 0.9;
    score -= Math.abs(ang - last) * 0.12;
    if (score > bestScore) {
      bestScore = score;
      bestAng = ang;
    }
  }
  p.jd.lastAng = bestAng;
  p.ix = Math.sin(bestAng);
  p.iz = Math.cos(bestAng) * g;
  const near = nearestOpp(play, p);
  const open = !near || near.d > 7;
  turbo(p, (near && near.d < 9) || (open && p.tm > 0.5));
  // jukes
  if (near && near.d < 2.0 && p.actCd <= 0 && p.upright && p.y === 0) {
    const ahead = ((near.p.x - p.x) * p.ix + (near.p.z - p.z) * p.iz) / near.d;
    if (ahead > 0.2 && play.rng() < 0.18) {
      const r = play.rng();
      if (r < 0.4) play.doSpin(p);
      else if (r < 0.8) play.doStiffArm(p);
      else if (near.p.state === 'dive') play.doHurdle(p);
      else p.actCd = 0.6;
    } else p.actCd = 0.25;
  }
}

// ---------------------------------------------------------------- defense
function rush(play, p) {
  if (hawk(play, p)) return;
  const b = play.ball;
  let t;
  if (play.kind === 'fg' || play.kind === 'pat') t = play.slot[play.off].QB;
  else if (play.kind === 'punt') t = play.slot[play.off].K;
  else if (b.state === 'held' && b.carrier && b.carrier.team !== p.team) t = b.carrier;
  else if (b.state === 'air' && b.f && b.f.kind === 'pass') {
    if (play.liveT > (p.jd.giveUp || 0)) p.job = 'pursue';
    t = { x: b.f.tx, z: b.f.tz };
  } else t = play.slot[play.off].QB || b;
  if (!t) return stop(p);
  if (readRun(play, p) && b.carrier && b.carrier.slot !== 'QB') {
    p.job = 'pursue';
    return pursue(play, p);
  }
  // linebackers and safeties time their blitz a beat after the snap
  if ((p.pos === 'LB' || p.pos === 'S' || p.pos === 'CB') && play.kind === 'scrimmage' && play.liveT < (p.jd.delay ??= 0.18 + play.rng() * 0.2)) {
    stop(p);
    return;
  }
  let tx = t.x;
  let tz = t.z;
  if (play.liveT < 0.55) tx += -play.dir * (p.jd.lane || 0) * 1.8;
  const d = seek(p, tx, tz, 0.01);
  turbo(p, d < 7);
  if (t.upright && d < 2.1 && d > 0.8 && p.actCd <= 0 && play.rng() < p.lvl.dive * 1.6 * (1 / 60)) play.doDive(p, t.x, t.z);
}

function man(play, p) {
  if (hawk(play, p)) return;
  if (readRun(play, p)) {
    p.job = 'pursue';
    return pursue(play, p);
  }
  const r = p.jd.target;
  if (!r || r.job === 'passBlock' || r.job === 'runBlock') {
    // our man stayed in to block: robber the middle
    const w = play.W(0, 9);
    seek(p, w.x, w.z, 1.2);
    return;
  }
  if (play.t >= p.nextThink || !p.think) {
    p.nextThink = play.t + p.react * play.rng.range(0.7, 1.3);
    const depth = play.dir * (r.z - play.losZ);
    const cush = clamp(2.0 - depth * 0.06, 0.6, 2.0);
    p.think = {
      x: r.x + r.vx * 0.3 - Math.sign(r.x) * 0.4,
      z: r.z + r.vz * 0.3 + play.dir * cush,
    };
  }
  const d = seek(p, p.think.x, p.think.z, 0.5, p.lvl.cover);
  turbo(p, d > 2.2);
}

function zone(play, p) {
  if (hawk(play, p)) return;
  if (readRun(play, p)) {
    p.job = 'pursue';
    return pursue(play, p);
  }
  const zp = p.jd.at;
  const zDepth = play.dir * (zp.z - play.losZ);
  const deep = zDepth >= 14;
  // a lone deep-middle safety has to help on both sides
  const radius = deep ? (Math.abs(zp.x) < 3 ? 17 : 10) : 8;
  if (play.t >= p.nextThink || !p.think) {
    p.nextThink = play.t + p.react * play.rng.range(0.7, 1.3);
    let threat = null;
    let best = Infinity;
    for (const r of play.eligibleReceivers(play.poss)) {
      const fx = r.x + r.vx * 0.6;
      const fz = r.z + r.vz * 0.6;
      if (deep) {
        // anybody threatening to get over the top in my lane
        const lat = Math.abs(fx - zp.x);
        const rDepth = play.dir * (fz - play.losZ);
        if (lat < radius && rDepth > zDepth - 10) {
          const score = lat - rDepth * 0.35;
          if (score < best) {
            best = score;
            threat = r;
          }
        }
      } else {
        const d = len(fx - zp.x, fz - zp.z);
        if (d < radius && d < best) {
          best = d;
          threat = r;
        }
      }
    }
    let tx = zp.x;
    let tz = zp.z;
    if (threat) {
      if (deep) {
        tx = clamp(lerp(zp.x, threat.x, 0.7), zp.x - radius, zp.x + radius);
        const want = threat.z + threat.vz * 0.3 + play.dir * 3.5;
        tz = play.dir * (want - zp.z) > 0 ? want : lerp(zp.z, want, 0.35);
      } else {
        tx = lerp(zp.x, threat.x, 0.7);
        tz = lerp(zp.z, threat.z - play.dir * 0.5, 0.6);
        const ox = tx - zp.x;
        const oz = tz - zp.z;
        const ol = len(ox, oz);
        const lim = radius * 1.1;
        if (ol > lim) {
          tx = zp.x + (ox / ol) * lim;
          tz = zp.z + (oz / ol) * lim;
        }
      }
    }
    p.think = { x: tx, z: tz, threat };
  }
  const d = seek(p, p.think.x, p.think.z, 1.0, play.liveT < 0.6 ? 0.85 : p.lvl.cover);
  // getting beat deep: burn it
  const t = p.think.threat;
  const beat = deep && t && play.dir * (t.z - p.z) > -2.5;
  turbo(p, (d > 4 && deep) || beat);
}

function spy(play, p) {
  if (hawk(play, p)) return;
  const b = play.ball;
  const qb = play.slot[play.off].QB;
  if (readRun(play, p) || (b.carrier && b.carrier === qb && play.dir * (qb.z - play.losZ) > -0.5)) {
    p.job = 'pursue';
    return pursue(play, p);
  }
  if (!qb) return stop(p);
  seek(p, qb.x, qb.z + play.dir * 5.5, 1.0);
}

function pursue(play, p) {
  const b = play.ball;
  if (b.state === 'loose') return recover(play, p);
  if (hawk(play, p)) return;
  const c = b.carrier;
  if (!c || c.team === p.team) {
    if (b.state === 'air' && b.f) {
      seek(p, b.f.tx, b.f.tz, 1.0, 0.8);
      return;
    }
    p.ix *= 0.9;
    p.iz *= 0.9;
    return;
  }
  const lead = p.jd && p.jd.lead !== undefined ? p.jd.lead : 0.8;
  const spd = p.spd * 1.15;
  let T = dist(p, c) / spd;
  let tx = c.x;
  let tz = c.z;
  for (let k = 0; k < 3; k++) {
    tx = c.x + c.vx * T * lead;
    tz = c.z + c.vz * T * lead;
    T = len(tx - p.x, tz - p.z) / spd;
  }
  tx = clamp(tx, -HALF_W - 0.5, HALF_W + 0.5);
  const d = seek(p, tx, tz, 0.01, p.lvl.pursuit);
  const dc = dist(p, c);
  turbo(p, dc < 13);
  if (dc < 2.4 && dc > 0.9 && p.actCd <= 0 && p.upright && p.y === 0 && c.upright) {
    const closing = ((c.x - p.x) * (p.vx - c.vx) + (c.z - p.z) * (p.vz - c.vz)) / dc;
    const chance = p.lvl.dive * (closing < 2 ? 2.4 : 0.5) / 60;
    if (play.rng() < chance) play.doDive(p, c.x + c.vx * 0.15, c.z + c.vz * 0.15);
  }
  return d;
}

function recover(play, p) {
  const b = play.ball;
  if (b.state !== 'loose') {
    p.job = b.carrier && b.carrier.team === p.team ? 'leadBlock' : 'pursue';
    return;
  }
  const tx = b.x + b.vx * 0.3;
  const tz = b.z + b.vz * 0.3;
  const d = seek(p, tx, tz, 0.01);
  turbo(p, true);
  if (d < 2.2 && d > 0.8 && b.y < 0.6 && p.actCd <= 0 && play.rng() < 0.04) play.doDive(p, tx, tz);
}

// ---------------------------------------------------------------- special teams
function kicker(play, p) {
  const b = play.ball;
  if (!b.kicked) {
    seek(p, b.x, b.z, 0.01, 0.8);
    return;
  }
  safetyCover(play, p);
}

function safetyCover(play, p) {
  const b = play.ball;
  if (b.carrier && b.carrier.team !== p.team && dist(b.carrier, p) < 15) {
    p.job = 'pursue';
    return pursue(play, p);
  }
  const ref = b.carrier || b;
  seek(p, ref.x * 0.6, ref.z - play.dir * 14, 2.0, 0.7);
}

function coverage(play, p) {
  const b = play.ball;
  if (!b.kicked) {
    stop(p);
    return;
  }
  const L = play.kickLand;
  const prog = clamp((play.liveT - play.kickT) / (play.kickInfo.hang + 0.5), 0, 1);
  const tx = lerp(p.jd.lane, L.x, prog * 0.75);
  const d = seek(p, tx, L.z, 0.01);
  turbo(p, d > 6);
}

function gunner(play, p) {
  const L = play.kickLand || play.W(play.kickInfo.landDx, play.kickInfo.landDz);
  const prog = clamp(play.liveT / (play.kickInfo.hang + 1.5), 0, 1);
  const tx = lerp(p.jd.lane, L.x, prog);
  seek(p, tx, L.z, 0.01);
  turbo(p, true);
}

function jam(play, p) {
  const g = p.jd.target;
  if (!g) return stop(p);
  seek(p, g.x + g.vx * 0.3, g.z + g.vz * 0.3 + play.dir * 0.8, 0.4);
  turbo(p, dist(p, g) > 2);
}

function returnBlock(play, p) {
  const ki = play.kickInfo;
  const L = play.kickLand || play.W(ki.landDx, ki.landDz);
  if (play.kind === 'kickoff' && !play.ball.kicked) {
    stop(p);
    return;
  }
  const lane = p.jd.lane || 0;
  seek(p, L.x + lane, L.z - play.dir * 11, 1.0);
}

function returner(play, p) {
  const b = play.ball;
  const ki = play.kickInfo;
  const L = play.kickLand || play.W(ki.landDx, ki.landDz);
  if (b.state === 'air' && b.f && b.f.kind === 'kick') {
    const tLeft = b.f.T - b.f.t;
    const d = len(L.x - p.x, L.z - p.z);
    seek(p, L.x, L.z, 0.3, d / Math.max(tLeft, 0.1) > p.spd * 0.8 ? 1 : 0.7);
    turbo(p, d > p.spd * tLeft * 0.9);
    return;
  }
  if (b.state === 'loose') return recover(play, p);
  seek(p, L.x, L.z, 0.5, 0.6);
}

function punter(play, p) {
  if (play.ball.kicked) {
    p.job = 'safetyCover';
    return;
  }
  stop(p);
}

function puntBlock(play, p) {
  if (play.ball.kicked && play.liveT > (p.jd.release || 1.3)) {
    const L = play.kickLand;
    const d = seek(p, L.x * 0.6, L.z, 0.01);
    turbo(p, d > 8);
    return;
  }
  passBlock(play, p);
}

function fgKicker(play, p) {
  const h = play.slot[play.off].QB;
  const b = play.ball;
  if (b.kicked) {
    p.ix *= 0.85;
    p.iz *= 0.85;
    return;
  }
  if (b.state === 'held' && b.carrier === h && play.liveT > (h.jd.gotAt || 0) + 0.2) {
    seek(p, h.x - play.dir * 0 + 0.0, h.z - play.dir * 0.4, 0.01, 0.75);
    return;
  }
  stop(p);
}

function holder(play, p) {
  stop(p);
}

function fgBlock(play, p) {
  const a = p.jd.anchor || p.home;
  const t = play.blockTargets.get(p.id);
  if (t) {
    let tx = t.x;
    let tz = t.z;
    const ax = tx - a.x;
    const az = tz - a.z;
    const al = len(ax, az);
    if (al > 1.5) {
      tx = a.x + (ax / al) * 1.5;
      tz = a.z + (az / al) * 1.5;
    }
    seek(p, tx, tz, 0.3, 0.6);
  } else seek(p, a.x, a.z, 0.5, 0.5);
}

function idle(play, p) {
  p.ix *= 0.85;
  p.iz *= 0.85;
  if (len(p.ix, p.iz) < 0.05) stop(p);
}

const JOBS = {
  idle, qbPass, qbHand, qbPitch, fake, carrierPath, rbPath, leadPath, route, catchBall,
  passBlock, screenBlock, drawBlock, runBlock, stalk, leadBlock, carrier,
  rush, man, zone, spy, pursue, recover,
  kicker, safetyCover, coverage, gunner, jam, returnBlock, returner, punter, puntBlock,
  fgKicker, holder, fgBlock,
};
