import { playerId } from './constants.js';

// Base ratings per position. spd/acc in yards/s and yards/s^2; the rest 0..1.
const BASE = {
  QB: { spd: 7.5, acc: 21, str: 0.45, hands: 0.55, tkl: 0.25, arm: 0.85, body: 'mid', r: 0.42, mass: 1.1 },
  RB: { spd: 8.6, acc: 24, str: 0.62, hands: 0.68, tkl: 0.3, arm: 0.3, body: 'mid', r: 0.42, mass: 1.12 },
  WR: { spd: 9.0, acc: 24, str: 0.4, hands: 0.85, tkl: 0.25, arm: 0.3, body: 'small', r: 0.4, mass: 1.0 },
  OL: { spd: 6.3, acc: 15, str: 0.84, hands: 0.2, tkl: 0.45, arm: 0.2, body: 'big', r: 0.53, mass: 1.6 },
  K: { spd: 7.0, acc: 18, str: 0.3, hands: 0.45, tkl: 0.3, arm: 0.4, body: 'small', r: 0.4, mass: 1.0 },
  DL: { spd: 7.1, acc: 17, str: 0.82, hands: 0.25, tkl: 0.76, arm: 0.2, body: 'big', r: 0.53, mass: 1.55 },
  LB: { spd: 8.0, acc: 21, str: 0.66, hands: 0.45, tkl: 0.82, arm: 0.2, body: 'mid', r: 0.45, mass: 1.25 },
  CB: { spd: 8.85, acc: 24, str: 0.42, hands: 0.58, tkl: 0.55, arm: 0.2, body: 'small', r: 0.4, mass: 1.0 },
  S: { spd: 8.6, acc: 23, str: 0.55, hands: 0.6, tkl: 0.72, arm: 0.2, body: 'mid', r: 0.42, mass: 1.1 },
};

export const POS_OF_SLOT = {
  QB: 'QB', C: 'OL', LG: 'OL', RG: 'OL', WR1: 'WR', WR2: 'WR', RB: 'RB', K: 'K',
  DL1: 'DL', DL2: 'DL', LB1: 'LB', LB2: 'LB', CB1: 'CB', CB2: 'CB', S: 'S',
};

export function ratingsFor(team, slot) {
  const pos = POS_OF_SLOT[slot];
  const b = { ...BASE[pos] };
  const R = team.ratings;
  b.spd *= 1 + (R.speed - 7) * 0.012;
  if (pos === 'QB') b.arm += (R.pass - 7) * 0.03;
  if (pos === 'WR') b.hands += (R.pass - 7) * 0.015;
  if (pos === 'RB') {
    b.str += (R.rush - 7) * 0.03;
    b.spd *= 1 + (R.rush - 7) * 0.008;
  }
  if (pos === 'OL') b.str += (R.rush - 7) * 0.02;
  if (pos === 'DL') b.str += (R.defense - 7) * 0.02;
  if (['DL', 'LB', 'CB', 'S'].includes(pos)) b.tkl += (R.defense - 7) * 0.02;
  b.pos = pos;
  return b;
}

export class Player {
  constructor(teamIndex, teamDef, slot) {
    const r = ratingsFor(teamDef, slot);
    this.id = playerId(teamIndex, slot);
    this.team = teamIndex;
    this.slot = slot;
    this.pos = r.pos;
    this.num = teamDef.numbers[slot];
    this.body = r.body;
    this.spd = r.spd;
    this.acc = r.acc;
    this.str = r.str;
    this.hands = r.hands;
    this.tkl = r.tkl;
    this.arm = r.arm;
    this.r = r.r;
    this.mass = r.mass;

    this.x = 0;
    this.z = 0;
    this.y = 0;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.face = 0;
    this.ix = 0; // desired direction * magnitude (0..1)
    this.iz = 0;
    this.wantTurbo = false;
    this.turboOn = false;
    this.tm = 1; // AI turbo meter

    this.state = 'stand';
    this.st = 0; // time in state
    this.stDur = 0;
    this.fallFwd = false;
    this.hug = false; // a tackler wrapped up on the man he took down
    this.taunt = false; // celebrating a big hit or a sack

    this.job = 'idle';
    this.jd = {}; // job data
    this.route = null;
    this.home = null; // formation spot {x, z}

    this.eng = null; // blocker -> defender being blocked
    this.engBy = []; // defender -> blockers engaging him
    this.shedT = 0;
    this.immune = {}; // otherId -> time until which re-engagement is blocked
    this.tackleCd = 0;
    this.actCd = 0; // move cooldown (spin / stiff arm / dive)
    this.lockUntil = 0; // human control locked (scripted) until play time
    this.nextThink = 0;
    this.think = null; // cached AI target
    this.burst = 0;
    this.spinUsed = false;
    this.celebrate = 0;
  }

  get upright() {
    return this.state !== 'down' && this.state !== 'flying' && this.state !== 'getup' && this.state !== 'dive';
  }

  get speed() {
    return Math.sqrt(this.vx * this.vx + this.vz * this.vz);
  }

  setState(s, dur = 0) {
    this.state = s;
    this.st = 0;
    this.stDur = dur;
    this.hug = false;
    this.taunt = false;
  }
}

export function bodyOfSlot(slot) {
  return BASE[POS_OF_SLOT[slot]].body;
}
