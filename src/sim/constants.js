// Shared constants for the simulation. Units are yards and seconds.
//
// World axes: x runs sideline to sideline, z runs end line to end line, y is up.
// Team 0 always attacks +z, team 1 always attacks -z. The camera sits behind
// whichever team has the ball, so this never matters to the player.

export const HALF_W = 53.333 / 2; // sideline at x = ±26.67
export const GOAL = 50; // goal lines at z = ±50
export const END = 60; // end lines at z = ±60
export const POST_Z = 60; // college goal posts sit on the end line
export const POST_HALF = 6.17 / 2; // uprights 18'6" apart
export const CROSSBAR = 10 / 3; // 10 ft
export const HASH_X = HALF_W - 20; // college hashes, 60 ft from each sideline

export const HZ = 60;
export const DT = 1 / HZ;
export const GRAVITY = 24; // the ball
// Players hang in the air longer than the ball does: arcade leaps and flying tackles.
export const AIR_GRAVITY = 15;
export const JUMP_VY = 5.9; // about 1.15 yd off the ground, 0.8 s in the air
export const JUMP_APEX_T = JUMP_VY / AIR_GRAVITY;
export const HURDLE_VY = 5.5;
export const DIVE_VY = 3.3; // a layout or flying tackle: 0.44 s in the air, then a belly slide
export const DIVE_AIR = (2 * DIVE_VY) / AIR_GRAVITY;
export const DIVE_SLIDE = 0.3;
export const HIT_GRAVITY = 20; // a runner blown up by a big hit
// Getting up off the turf (motion captured). Time spent lying down is shorter by as much as
// this grew, so a downed player is out of the play as long as before.
export const GETUP_TIME = 0.85;
// No flags, as in the arcade original: while a pass is in the air a defender may flatten the
// receiver (a dive, or a turbo hit). CPU defenders wait until this close to the catch to do it.
export const CPU_HIT_TIME = 0.9;

export const TURBO_MULT = 1.25;
export const TURBO_DRAIN = 0.42; // per second while burning
export const TURBO_REGEN = 0.2;

export const OFF_SLOTS = ['QB', 'C', 'LG', 'RG', 'WR1', 'WR2', 'RB', 'K'];
export const DEF_SLOTS = ['DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2', 'S'];
export const ROSTER_SLOTS = [...OFF_SLOTS, ...DEF_SLOTS];
export const IDS_PER_TEAM = 16;

export const dirOf = (team) => (team === 0 ? 1 : -1);
export const playerId = (team, slot) => team * IDS_PER_TEAM + ROSTER_SLOTS.indexOf(slot);
export const slotOfId = (id) => ROSTER_SLOTS[id % IDS_PER_TEAM];
export const teamOfId = (id) => (id >= IDS_PER_TEAM ? 1 : 0);

// "ballOn" is measured from the offense's own goal line (0) to the opponent's (100).
export const zOfBallOn = (team, on) => dirOf(team) * (on - 50);
export const ballOnOfZ = (team, z) => dirOf(team) * z + 50;

export const DIFFICULTY = {
  rookie: { label: 'ROOKIE', react: 0.3, qbRead: 1.35, cover: 0.92, pursuit: 0.86, dive: 0.45, hands: 0.92, shed: 1.35, speed: 0.96 },
  varsity: { label: 'VARSITY', react: 0.2, qbRead: 1.0, cover: 1.0, pursuit: 1.0, dive: 0.75, hands: 1.0, shed: 1.0, speed: 1.0 },
  heisman: { label: 'HEISMAN', react: 0.12, qbRead: 0.8, cover: 1.05, pursuit: 1.08, dive: 1.0, hands: 1.05, shed: 0.8, speed: 1.03 },
};
// AI teammates of a human player always play at this level.
export const TEAMMATE_LEVEL = 'varsity';
