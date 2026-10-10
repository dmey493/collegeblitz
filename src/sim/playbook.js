// Playbook data. Coordinates are in the OFFENSE FRAME:
//   dx > 0 = the offense's right (which is also screen-right, the camera sits behind the offense)
//   dz > 0 = downfield, dz = 0 is the line of scrimmage, ball at dx = 0.
//
// Receiver routes come in two flavours:
//   P(...) "inside-relative": [in, up] where `in` > 0 means toward the middle of the field,
//          so the same route works for a receiver lined up left or right.
//   A(...) "absolute": [dx, dz] offsets from the player's start in the offense frame.
// A route point may carry flags: { sit: true } (settle at the end, e.g. curls),
// { wait: s } (pause there, e.g. hook-and-go). Routes without `sit` keep running
// in the direction of their last leg.
//
// Run `path`s are ABSOLUTE offense-frame points (relative to the ball, not the player).

const SIT = { sit: true };
const P = (pts) => ({ pts, abs: false });
const A = (pts) => ({ pts, abs: true });

export const OL_SPOTS = { C: [0, -0.6], LG: [-1.35, -0.75], RG: [1.35, -0.75] };

export const FORMATIONS = {
  gun: { QB: [0, -4.5], RB: [1.6, -4.6], WR1: [-13, -0.8], WR2: [13, -0.8] },
  iform: { QB: [0, -2.6], RB: [0, -6.6], WR1: [-12, -0.8], WR2: [12, -0.8] },
  trips: { QB: [0, -4.5], RB: [7.5, -1.2], WR1: [-13, -0.8], WR2: [14, -0.8] },
  spread: { QB: [0, -5.0], RB: [-7.5, -1.2], WR1: [-15, -0.8], WR2: [14, -0.8] },
  tight: { QB: [0, -4.0], RB: [0, -6.6], WR1: [-6.5, -0.9], WR2: [6.5, -0.9] },
  punt: { K: [0, -12], RB: [0, -6], WR1: [-14, -0.8], WR2: [14, -0.8] },
  fg: { K: [-1.2, -9.4], QB: [0, -7], WR1: [-2.75, -0.9], RB: [2.75, -0.9] },
};

// ---------------------------------------------------------------- offense
export const OFF_PLAYS = [
  // ---------------- page 1
  {
    id: 'sky', name: 'SKY HIGH', type: 'pass', form: 'gun', drop: 2.5,
    routes: { WR1: P([[0, 32]]), WR2: P([[0, 11], [6.5, 24]]), RB: A([[3, 0.8], [6.5, 4], [6.5, 18]]) },
  },
  {
    id: 'slants', name: 'SLANT CITY', type: 'pass', form: 'gun', drop: 1.2,
    routes: { WR1: P([[0, 2.5], [7, 9]]), WR2: P([[0, 2.5], [7, 9]]), RB: A([[-1.6, 1.5], [-1.6, 6, SIT]]) },
  },
  {
    id: 'zigzag', name: 'ZIG ZAG', type: 'pass', form: 'gun', drop: 2.5,
    routes: {
      WR1: P([[0, 6], [5, 10], [0, 15], [5, 21], [5, 34]]),
      WR2: P([[0, 12], [1.5, 10, SIT]]),
      RB: A([[-4, 0.8], [-9.5, 3.5, SIT]]),
    },
  },
  {
    id: 'curls', name: 'CURL CRUSH', type: 'pass', form: 'gun', drop: 2,
    routes: { WR1: P([[0, 13], [1.5, 11, SIT]]), WR2: P([[0, 13], [1.5, 11, SIT]]), RB: A([[-1.6, 2], [-1.6, 8, SIT]]) },
  },
  {
    id: 'blast', name: 'HB BLAST', type: 'run', form: 'iform', mode: 'hand', carrier: 'RB', runDir: 0,
    path: [[0.4, -3.3], [0.9, 0.5], [1.0, 16]],
    qbPath: [[0.5, -3.1], [-3.5, -5]],
  },
  {
    id: 'cross', name: 'CRISS CROSS', type: 'pass', form: 'gun', drop: 2,
    routes: { WR1: P([[0, 4], [24, 7]]), WR2: P([[0, 10], [20, 16]]), RB: A([[3, 0.8], [7, 4], [7, 20]]) },
  },
  {
    id: 'screen', name: 'SCREEN DOOR', type: 'pass', form: 'gun', drop: 3, screen: -1,
    routes: { WR1: P([[0, 30]]), WR2: P([[0, 2.5], [7, 9]]), RB: A([[-3, 0.5], [-9, 1.5, SIT]]) },
  },
  {
    id: 'sweep', name: 'TOSS SWEEP', type: 'run', form: 'gun', mode: 'pitch', carrier: 'RB', runDir: 1,
    path: [[4.5, -5.2], [10, -2.5], [12.5, 2], [12.5, 16]],
  },
  {
    id: 'hail', name: 'HAIL STATE', type: 'pass', form: 'spread', drop: 5,
    routes: { WR1: P([[0, 45]]), WR2: P([[0, 45]]), RB: A([[1.5, 10], [1.5, 45]]) },
  },
  // ---------------- page 2
  {
    id: 'outs', name: 'QUICK OUTS', type: 'pass', form: 'gun', drop: 1.2,
    routes: { WR1: P([[0, 5.5], [-5.5, 6, SIT]]), WR2: P([[0, 5.5], [-5.5, 6, SIT]]), RB: A([[3, 0.6], [8.5, 2, SIT]]) },
  },
  {
    id: 'corner', name: 'CORNER STRIKE', type: 'pass', form: 'gun', drop: 2.5,
    routes: { WR1: P([[0, 12], [-7, 21]]), WR2: P([[0, 12], [7, 21]]), RB: A([[-1.6, 2], [-1.6, 7, SIT]]) },
  },
  {
    id: 'posts', name: 'DOUBLE POST', type: 'pass', form: 'tight', drop: 2.5,
    routes: { WR1: P([[0, 9], [5, 20]]), WR2: P([[0, 12], [5, 24]]), RB: A([[0, 5], [2, 12, SIT]]) },
  },
  {
    id: 'keeper', name: 'QB KEEPER', type: 'run', form: 'gun', mode: 'keep', carrier: 'QB', runDir: -1,
    path: [[-3, -4.5], [-7.5, -1.5], [-8.5, 4], [-8.5, 16]],
    rbPath: [[-4, -3.5], [-7.5, 0]],
  },
  {
    id: 'hookgo', name: 'HOOK & GO', type: 'pass', form: 'gun', drop: 3,
    routes: { WR1: P([[0, 10], [0.5, 8.6, { wait: 0.35 }], [0, 38]]), WR2: P([[0, 12], [1.5, 10, SIT]]), RB: A([[-1.6, 2], [-1.6, 7, SIT]]) },
  },
  {
    id: 'counter', name: 'COUNTER', type: 'run', form: 'iform', mode: 'hand', carrier: 'RB', runDir: -1,
    path: [[1.6, -5.8], [0.2, -3.5], [-2.4, -0.8], [-3.0, 3], [-3.0, 16]],
    qbPath: [[0.4, -3.3], [3, -5]],
  },
  {
    id: 'flood', name: 'FLOOD', type: 'pass', form: 'trips', drop: 2.5,
    routes: { WR2: P([[0, 15], [-6, 17]]), RB: A([[0, 7], [5.5, 8.5, SIT]]), WR1: P([[0, 5], [19, 11]]) },
  },
  {
    id: 'spider', name: 'SPIDER WEB', type: 'pass', form: 'gun', drop: 2,
    routes: { WR1: P([[0, 8], [7, 8.5, SIT]]), WR2: P([[0, 15], [-1.5, 12, SIT]]), RB: A([[3, 0.5], [1.5, 7, SIT]]) },
  },
  {
    id: 'draw', name: 'HB DRAW', type: 'run', form: 'gun', mode: 'hand', carrier: 'RB', runDir: 0, draw: true, handoffAt: 0.9,
    path: [[0.9, -6.2, { wait: 0.55 }], [0.7, -2], [0.7, 1], [0.7, 16]],
    qbPath: [[0.1, -6.3]],
  },
  // ---------------- page 3: special teams + short yardage
  { id: 'punt', name: 'PUNT', type: 'punt', form: 'punt', special: true },
  { id: 'fg', name: 'FIELD GOAL', type: 'fg', form: 'fg', special: true },
  {
    id: 'sneak', name: 'QB SNEAK', type: 'run', form: 'iform', mode: 'keep', carrier: 'QB', runDir: 0,
    path: [[0.2, -1.2], [0.3, 2], [0.3, 12]],
    rbPath: [[0.6, -3], [0.8, 1]],
  },
];

export const OFF_PAGES = [
  OFF_PLAYS.slice(0, 9).map((p) => p.id),
  OFF_PLAYS.slice(9, 18).map((p) => p.id),
  ['punt', 'fg', 'sneak'],
];

// ---------------------------------------------------------------- defense
const rush = (extra = {}) => ({ t: 'rush', ...extra });
const man = (target, extra = {}) => ({ t: 'man', target, ...extra });
const zone = (dx, dz, extra = {}) => ({ t: 'zone', at: [dx, dz], ...extra });
const spy = () => ({ t: 'spy' });

export const DEF_PLAYS = [
  {
    id: 'safe', name: 'SAFE COVER', blurb: 'Rush 2, three deep',
    a: { DL1: rush(), DL2: rush(), LB1: zone(-7, 7), LB2: zone(7, 7), CB1: zone(-15, 17), CB2: zone(15, 17), S: zone(0, 22) },
  },
  {
    id: 'man', name: 'MAN UP', blurb: 'Man coverage, spy the QB',
    a: { DL1: rush(), DL2: rush(), LB1: man('RB'), LB2: spy(), CB1: man('WR1'), CB2: man('WR2'), S: zone(0, 18) },
  },
  {
    id: 'blitz1', name: 'LB BLITZ', blurb: 'Send one backer',
    a: { DL1: rush(), DL2: rush(), LB1: rush(), LB2: man('RB'), CB1: man('WR1'), CB2: man('WR2'), S: zone(0, 16) },
  },
  {
    id: 'blitz2', name: 'DOUBLE BLITZ', blurb: 'Both backers come',
    a: { DL1: rush(), DL2: rush(), LB1: rush(), LB2: rush(), CB1: man('WR1'), CB2: man('WR2'), S: man('RB') },
    align: { LB1: [-3.0, 3.8], LB2: [3.0, 3.8] },
  },
  {
    id: 'allout', name: 'ALL-OUT BLITZ', blurb: 'Everybody eats',
    a: { DL1: rush(), DL2: rush(), LB1: rush(), LB2: rush(), S: rush(), CB1: man('WR1'), CB2: man('WR2') },
    align: { LB1: [-2.6, 3.2], LB2: [2.6, 3.2], S: [0, 6] },
  },
  {
    id: 'zblitz', name: 'ZONE BLITZ', blurb: 'Drop a lineman, send backers',
    a: { DL1: zone(-5, 5), DL2: rush(), LB1: rush(), LB2: rush(), CB1: zone(-14, 15), CB2: zone(14, 15), S: zone(0, 20) },
    align: { LB1: [-3.0, 3.8], LB2: [3.0, 3.8] },
  },
  {
    id: 'short', name: 'SHORT ZONE', blurb: 'Squat on the short stuff',
    a: { DL1: rush(), DL2: rush(), LB1: zone(-4, 8), LB2: zone(4, 8), CB1: zone(-12, 8), CB2: zone(12, 8), S: zone(0, 18) },
  },
  {
    id: 'deep', name: 'DEEP ZONE', blurb: 'Prevent the big one',
    a: { DL1: rush(), DL2: rush(), LB1: zone(-8, 12), LB2: zone(8, 12), CB1: zone(-15, 24), CB2: zone(15, 24), S: zone(0, 30) },
    align: { S: [0, 16] },
    cbDepth: 9,
  },
  {
    id: 'stuff', name: 'RUN STUFF', blurb: 'Load the box',
    a: { DL1: rush(), DL2: rush(), LB1: rush({ run: true }), LB2: rush({ run: true }), CB1: man('WR1'), CB2: man('WR2'), S: zone(0, 8) },
    align: { LB1: [-2.5, 3.5], LB2: [2.5, 3.5], S: [0, 7] },
  },
];

export const DEF_BASE_ALIGN = {
  DL1: [-2.2, 1.0],
  DL2: [2.2, 1.0],
  LB1: [-3.6, 4.6],
  LB2: [3.6, 4.6],
  S: [0, 12],
};

const byId = new Map([...OFF_PLAYS, ...DEF_PLAYS].map((p) => [p.id, p]));
export const getPlay = (id) => byId.get(id);
export const isOffPlay = (id) => OFF_PLAYS.some((p) => p.id === id);
export const isDefPlay = (id) => DEF_PLAYS.some((p) => p.id === id);
