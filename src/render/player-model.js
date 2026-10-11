// Bulky Blitz-style football player: one skinned mesh per player (giant pads,
// barrel chest, slim legs, glossy helmet and cage) posed by a small pose system
// driven by the sim state.
import * as THREE from 'three';
import { blobTexture, uniformTexture, uniformNormalMap, helmetTexture, skinTexture, skinNormalMap } from './textures.js';
import { BODY, buildBones, buildPlayerGeometry, rigSpec } from './player-geo.js';
import { GAITS } from './gait.js';
import { CLIPS } from './clips.js';
import { GETUP_TIME, AIR_GRAVITY, JUMP_VY, HURDLE_VY } from '../sim/constants.js';

const SKINS = ['#f1c7a3', '#d9a476', '#b97c4f', '#8a5636', '#5d3a25', '#ebb995'];

let shared = null;
function sharedAssets() {
  if (shared) return shared;
  const blob = new THREE.PlaneGeometry(1.5, 1.5);
  blob.rotateX(-Math.PI / 2);
  shared = {
    blob,
    blobTex: blobTexture(),
    geos: new Map(),
    skin: null,
    gear: null,
    visor: null,
    hidden: new THREE.MeshBasicMaterial({ visible: false }),
    helmets: new Map(),
    uniforms: new Map(),
  };
  return shared;
}

function geometryFor(body, team) {
  const S = sharedAssets();
  const key = `${body}-${team.id}`;
  if (!S.geos.has(key)) S.geos.set(key, buildPlayerGeometry(BODY[body] || BODY.mid, team));
  return S.geos.get(key);
}

function materialsFor(team, num, skinIdx, visor, envMap, grime) {
  const S = sharedAssets();
  if (!S.skin) {
    // painted muscle and face detail on top of the tone, with a little sweat sheen
    S.skin = SKINS.map((c) => new THREE.MeshStandardMaterial({
      map: skinTexture(c), normalMap: skinNormalMap(), normalScale: new THREE.Vector2(1.6, 1.6),
      vertexColors: true, roughness: 0.5, envMap, envMapIntensity: 0.35,
    }));
  }
  if (!S.gear) {
    S.gear = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12, envMap, envMapIntensity: 0.6 });
    S.visor = new THREE.MeshPhysicalMaterial({
      color: '#0b0e14', roughness: 0.04, metalness: 0.4, clearcoat: 1, envMap, envMapIntensity: 1.4, transparent: true, opacity: 0.9,
    });
  }
  if (!S.helmets.has(team.id)) {
    S.helmets.set(team.id, new THREE.MeshPhysicalMaterial({
      map: helmetTexture(team), vertexColors: true, roughness: 0.3, metalness: 0.08,
      clearcoat: 1, clearcoatRoughness: 0.1, envMap, envMapIntensity: 0.6,
    }));
  }
  const ukey = `${team.id}-${num}`;
  if (!S.uniforms.has(ukey)) {
    S.uniforms.set(ukey, new THREE.MeshStandardMaterial({
      map: uniformTexture(team, num, 512, grime), normalMap: uniformNormalMap(), normalScale: new THREE.Vector2(0.9, 0.9),
      vertexColors: true, roughness: 0.72,
    }));
  }
  return [S.uniforms.get(ukey), S.skin[skinIdx], S.helmets.get(team.id), S.gear, visor ? S.visor : S.hidden];
}

const lerpA = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const tmpA = new THREE.Vector3();

// Motion-captured running: sample a gait table at a stride phase (radians), and blend the
// jog, run and fast-run tables by speed (yards per second).
const SIDES = ['legFwd', 'knee', 'footPitch', 'legAbd', 'armFwd', 'armAbdTotal', 'elbow'];
const MIDS = ['lean', 'bodyY', 'twist', 'hipTwist', 'roll'];
const gaitOut = {
  legFwd: [0, 0], knee: [0, 0], footPitch: [0, 0], legAbd: [0, 0], armFwd: [0, 0], armAbd: [0, 0], elbow: [0, 0],
  lean: 0, bodyY: 0, twist: 0, hipTwist: 0, roll: 0,
};
// Sample a looping captured clip (the shuffle) at a phase in radians; `mirror` flips it to
// the other side (left and right swap, sideways tilts and turns change sign).
const loopOut = {
  legFwd: [0, 0], legAbd: [0, 0], knee: [0, 0], foot: [0, 0], armFwd: [0, 0], armAbd: [0, 0], armTwist: [0, 0], elbow: [0, 0],
  tiltX: 0, tiltZ: 0, hipTwist: 0, lean: 0, twist: 0, bend: 0, bodyY: 0,
};
function loopAt(clip, phase, mirror) {
  const n = clip.n;
  const u = ((((phase / (Math.PI * 2)) % 1) + 1) % 1) * n;
  const i0 = Math.floor(u) % n;
  const i1 = (i0 + 1) % n;
  const f = u - Math.floor(u);
  const c = clip.t;
  const at = (k) => c[k][i0] + (c[k][i1] - c[k][i0]) * f;
  const sg = mirror ? -1 : 1;
  loopOut.tiltX = at('tiltX');
  loopOut.lean = at('lean');
  loopOut.bodyY = at('bodyY');
  loopOut.tiltZ = sg * at('tiltZ');
  loopOut.hipTwist = sg * at('hipTwist');
  loopOut.twist = sg * at('twist');
  loopOut.bend = sg * at('bend');
  for (const [key, src] of [['legFwd', 'legFwd'], ['legAbd', 'legAbd'], ['knee', 'knee'], ['foot', 'foot'], ['armFwd', 'armFwd'], ['armAbd', 'armAbdTotal'], ['armTwist', 'armTwist'], ['elbow', 'elbow']]) {
    const a = at(`${src}0`);
    const b = at(`${src}1`);
    loopOut[key][0] = mirror ? b : a;
    loopOut[key][1] = mirror ? a : b;
  }
  return loopOut;
}

// average shoulder swing angle (relative to the chest) across the captured strides
const ARM_MEAN = (() => {
  let sum = 0;
  let n = 0;
  for (const g of Object.values(GAITS)) {
    for (let i = 0; i < g.n; i++) {
      sum += g.t.armFwd0[i] + g.t.armFwd1[i] + 2 * g.t.lean[i];
      n += 2;
    }
  }
  return sum / n;
})();

function gaitAt(speed, phase) {
  const [ga, gb, f] = speed < 4.5 ? [GAITS.jog, GAITS.jog, 0]
    : speed < 7 ? [GAITS.jog, GAITS.run, (speed - 4.5) / 2.5]
      : [GAITS.run, GAITS.fast, Math.min(1, (speed - 7) / 2)];
  const n = ga.n;
  const u = (((phase / (Math.PI * 2)) % 1) + 1) % 1 * n;
  const i0 = Math.floor(u) % n;
  const i1 = (i0 + 1) % n;
  const fr = u - Math.floor(u);
  const at = (arr) => arr[i0] + (arr[i1] - arr[i0]) * fr;
  const mix = (key) => at(ga.t[key]) * (1 - f) + at(gb.t[key]) * f;
  for (const k of SIDES) {
    const out = k === 'armAbdTotal' ? gaitOut.armAbd : gaitOut[k];
    out[0] = mix(`${k}0`);
    out[1] = mix(`${k}1`);
  }
  for (const k of MIDS) gaitOut[k] = mix(k);
  return gaitOut;
}

const basePose = () => ({
  tiltX: 0, tiltZ: 0, bodyY: 0, bodyX: 0, bodyZ: 0, spin: 0, lean: 0.06, twist: 0, bend: 0, headX: 0, hipTwist: 0,
  armFwd: [0.12, 0.12], armAbd: [0.1, 0.1], armTwist: [0, 0], elbow: [0.32, 0.32],
  legFwd: [0, 0], knee: [0.08, 0.08], ankle: [0, 0], legAbd: [0.06, 0.06],
});

export class PlayerModel {
  constructor({ team, num, body, slot, id, envMap }) {
    const S = sharedAssets();
    const B = BODY[body] || BODY.mid;
    this.B = B;
    this.slot = slot;
    this.id = id;
    this.phase = Math.random() * 6;
    // bulkier players carry their arms further out from the body
    this.abd = 0.13 + (B.w - 1) * 0.5;
    this.hipY = rigSpec(B).pelvis[2];
    // hip to ankle, to scale the captured hip bounce (measured in leg lengths)
    this.legLen = 0.945 * B.h;
    this.root = new THREE.Group();

    const skinIdx = (id * 7 + num) % SKINS.length;
    const visor = ((id * 31 + num * 7) % 10) < (body === 'big' ? 1 : 4);
    // linemen live in the dirt; receivers stay a little cleaner
    const grime = body === 'big' ? 0.9 : body === 'mid' ? 0.65 : 0.45;
    const mesh = new THREE.SkinnedMesh(geometryFor(body, team), materialsFor(team, num, skinIdx, visor, envMap, grime));
    const { bones, list } = buildBones(B);
    mesh.add(bones.root);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(list));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // the posed body can leave its bind-pose bounds (dives, falls): never cull it
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.mesh = mesh;
    this.bones = bones;
    // where a carried ball sits: the palm of the right glove
    this.palm = new THREE.Object3D();
    this.palm.position.set(0, -0.05, 0.03);
    bones.handR.add(this.palm);

    // contact shadow
    this.blob = new THREE.Mesh(S.blob, new THREE.MeshBasicMaterial({ map: S.blobTex, transparent: true, depthWrite: false, opacity: 0.85 }));
    this.blob.position.y = 0.015;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);

    // pose state (current values, smoothed toward targets)
    this.p = basePose();
    this.p.headY = 0;
    this.prevState = '';
    this.lastFace = 0;
    this.lastY = 0;
    this.turnRate = 0;
    this.vy = 0;
    this.catchDive = false;
    this.reachHint = false;
    this.fallFrom = false;
    this.fallFwd = true;
    this.lastFallFwd = true;
    this.fallTilt = 1.52;
    this.flip = false;
    this.snapNext = false;
    this.seed = 0;
    this.ballRel = 0;
    this.oneHand = -1;
    this.leapStyle = 0;
    this.diveStyle = 0;
    this.airT = 0.8;
  }

  // view: { x, z, y, face, vx, vz, state, st, turbo, fallFwd, carrying, reach, ball }
  update(v, dt, ctx) {
    const r = this.root;
    r.position.set(v.x, 0, v.z);
    const s = v.state;
    const st = v.st;
    const speed = Math.hypot(v.vx, v.vz);
    // turn rate (for leaning into cuts) and whether we're going up or coming down
    if (dt > 0) {
      const turn = wrap(v.face - this.lastFace) / dt;
      this.turnRate = lerpA(this.turnRate, clamp(turn, -12, 12), 1 - Math.exp(-10 * dt));
      this.vy = lerpA(this.vy, (v.y - this.lastY) / dt, 1 - Math.exp(-20 * dt));
    }
    this.lastFace = v.face;
    this.lastY = v.y;
    this.reachHint = !!(v.ball || v.carrying);
    this.lastFallFwd = !!v.fallFwd;
    this.seed = ctx.celebrateSeed || 0;
    // time this leap will spend in the air, from how high it is after how long (the sim's
    // leaps vary in height to meet the ball)
    if ((s === 'jump' || s === 'hurdle') && st > 0.03 && st < 0.2 && v.y > 0.02) {
      const vy0 = v.y / st + 0.5 * AIR_GRAVITY * st;
      this.airT = clamp((2 * vy0) / AIR_GRAVITY, 0.3, 1.0);
    }
    // where the ball is relative to the way he faces (+ = his left), for turning to it
    this.ballRel = v.ball ? wrap(Math.atan2(v.ball.x - v.x, v.ball.z - v.z) - v.face) : 0;
    if (s !== this.prevState) this.enter(s, this.prevState);
    this.oneHand = -1;

    const T = basePose();
    let rate = 16;
    const big = this.slot === 'C' || this.slot === 'LG' || this.slot === 'RG' || this.slot === 'DL1' || this.slot === 'DL2';
    const moving = speed > 0.4 && (s === 'stand' || s === 'stumble' || s === 'celebrate' || s === 'catch');

    if (moving) {
      this.locomotion(T, v, speed, dt);
      // follow the captured motion closely
      rate = 40;
    } else {
      // stride phase settles so the next run starts cleanly
      if (s === 'stand' || s === 'celebrate') {
        T.lean = 0.05 + Math.sin(ctx.time * 2 + this.id) * 0.015;
        T.knee = [0.14, 0.14];
        T.legFwd = [0.06, -0.02];
        T.legAbd = [0.09, 0.09];
        T.armAbd = [0.08, 0.08];
        T.elbow = [0.3, 0.3];
      }
    }

    switch (s) {
      case 'stance': {
        if (big) {
          T.bodyY = -0.42;
          T.lean = 1.15;
          T.legFwd = [1.05, 0.6];
          T.knee = [1.6, 1.25];
          T.legAbd = [0.16, 0.16];
          T.armFwd = [1.35, 0.9];
          T.elbow = [0.05, 0.9];
          T.armAbd = [0.05, 0.25];
          T.headX = -0.35;
        } else if (this.slot === 'QB') {
          T.bodyY = -0.08;
          T.lean = 0.25;
          T.knee = [0.45, 0.45];
          T.legFwd = [0.3, 0.15];
          T.legAbd = [0.12, 0.12];
          T.armFwd = [0.9, 0.9];
          T.elbow = [1.2, 1.2];
        } else {
          T.bodyY = -0.17;
          T.lean = 0.5;
          T.knee = [0.8, 0.6];
          T.legFwd = [0.6, 0.15];
          T.legAbd = [0.12, 0.12];
          T.armFwd = [0.75, 0.6];
          T.elbow = [0.55, 0.55];
          T.headX = -0.1;
        }
        break;
      }
      case 'engaged': {
        // locked up: driving with the legs, hands on the other man's chest
        const sh = Math.sin(ctx.time * 9 + this.id) * 0.15;
        T.lean = 0.6;
        T.bodyY = -0.16;
        T.legFwd = [0.6 + sh, -0.35 - sh];
        T.knee = [0.85, 0.5];
        T.ankle = [0.2, 0.45];
        T.legAbd = [0.15, 0.15];
        T.armFwd = [1.5, 1.5];
        T.elbow = [0.7, 0.7];
        T.armAbd = [0.2, 0.2];
        T.headX = -0.1;
        T.twist = Math.sin(ctx.time * 5.3 + this.id * 2) * 0.12;
        if (v.opp) this.aimArms(T, v.opp, 0.65);
        rate = 20;
        break;
      }
      case 'throw': {
        const u = st / 0.32;
        if (u < 0.4) {
          // wind-up: ball cocked by the ear, front shoulder and glove at the target
          T.armFwd[0] = 0;
          T.armAbd[0] = 1.3;
          T.armTwist[0] = 1.5;
          T.elbow[0] = 1.75;
          T.armFwd[1] = 1.45;
          T.armAbd[1] = 0.05;
          T.elbow[1] = 0.35;
          T.twist = -0.7;
          T.lean = 0.05;
          T.legFwd = [-0.2, 0.45];
          T.knee = [0.35, 0.25];
          rate = 30;
        } else if (u < 0.7) {
          // release over the top
          T.armFwd[0] = 2.25;
          T.armAbd[0] = 0.5;
          T.armTwist[0] = 0.3;
          T.elbow[0] = 0.25;
          T.armFwd[1] = 0.6;
          T.armAbd[1] = 0.3;
          T.elbow[1] = 1.4;
          T.twist = 0.45;
          T.lean = 0.3;
          T.legFwd = [-0.35, 0.4];
          T.knee = [0.3, 0.35];
          rate = 45;
        } else {
          // follow-through across the body
          T.armFwd[0] = 1.1;
          T.armAbd[0] = -0.25;
          T.elbow[0] = 0.5;
          T.armFwd[1] = 0.4;
          T.elbow[1] = 1.3;
          T.twist = 0.6;
          T.lean = 0.42;
          T.legFwd = [-0.1, 0.3];
          T.knee = [0.5, 0.4];
        }
        break;
      }
      case 'catch': {
        T.armFwd = [1.5, 1.5];
        T.elbow = [0.9, 0.9];
        break;
      }
      case 'jump': {
        // A leap for the ball. Three ways up: 0 a captured running leap (one knee driving,
        // the trail leg kicking back) reaching with both hands, 1 the same leap with a
        // one-handed stab, the body twisting to the ball, 2 skying with the heels tucked
        const up = ease(Math.min(1, st / 0.12));
        const style = this.leapStyle;
        const side = this.ballRel >= 0 ? 1 : 0; // arm on the ball's side
        const turn = clamp(this.ballRel * 0.7, -1.1, 1.1);
        if (style === 2) {
          const rising = this.vy > -0.5;
          T.legFwd = [-0.3 * up, -0.2 * up];
          T.knee = [1.75 * up, 1.6 * up];
          T.ankle = [0.75, 0.75];
          T.legAbd = [0.12, 0.12];
          T.lean = -0.28 * up;
          T.headX = -0.45;
          if (!rising) {
            T.legFwd = [0.35, 0.3];
            T.knee = [0.5, 0.4];
            T.ankle = [0.25, 0.25];
            T.lean = 0.12;
            T.headX = -0.1;
            if (v.y < 0.25) T.knee = [0.8, 0.7];
          }
        } else {
          this.playLeap(T, st);
          T.headX = -0.3;
        }
        T.armFwd = [2.85, 2.85];
        T.armAbd = [0.12, 0.12];
        T.armTwist = [0, 0];
        T.elbow = [0.25, 0.25];
        // turn the shoulders (and the eyes) to a ball coming over a shoulder
        T.twist = turn + (style === 2 ? 0 : T.twist * 0.4);
        T.headY = turn * 0.5;
        if (style === 1) {
          this.oneHand = side;
          T.armFwd[1 - side] = 0.5;
          T.armAbd[1 - side] = 1.25;
          T.elbow[1 - side] = 0.5;
          T.tiltZ += (side ? -0.32 : 0.32) * up;
          T.twist += side ? 0.35 : -0.35;
        }
        rate = 24;
        break;
      }
      case 'hurdle': {
        // a captured running leap over the man on the ground, arms out for balance
        this.playLeap(T, st);
        T.armAbd = [0.75, 0.75];
        T.armFwd = [0.7, 0.4];
        T.elbow = [0.5, 0.5];
        T.armTwist = [0, 0];
        T.lean += 0.15;
        rate = 26;
        break;
      }
      case 'spin': {
        T.spin = ease(st / 0.42) * Math.PI * 2;
        T.armAbd = [0.8, 0.8];
        T.lean = 0.25;
        T.knee = [0.4, 0.4];
        T.bodyY = -0.06;
        rate = 30;
        break;
      }
      case 'stiff': {
        T.armFwd[1] = 1.55;
        T.elbow[1] = 0.02;
        T.armAbd[1] = 0.12;
        T.twist = -0.3;
        rate = 30;
        break;
      }
      case 'dive': {
        // launch, fly flat out (arms out front for the ball, spread wide to wrap up a
        // runner), belly-flop and slide
        const launch = ease(Math.min(1, st / 0.13));
        const landed = v.y <= 0.002 && st > 0.13;
        T.tiltX = 0.5 + 1.02 * launch;
        T.lean = 0.04;
        T.headX = -0.75 * launch;
        T.legFwd = [-0.12 - 0.25 * (1 - launch), 0.1 * (1 - launch) - 0.22];
        T.knee = [0.2 + 0.5 * (1 - launch), 0.45];
        T.ankle = [0.9, 0.9];
        T.legAbd = [0.08, 0.12];
        if (v.hug) {
          // got him: arms wrapped around his legs
          T.armFwd = [2.3, 2.3];
          T.armAbd = [0.12, 0.12];
          T.elbow = [1.15, 1.15];
        } else if (this.catchDive && this.diveStyle === 1) {
          // a one-handed layout, rolled onto his side, the other arm tucked
          const side = this.ballRel >= 0 ? 1 : 0;
          this.oneHand = side;
          T.armFwd[side] = 3.1;
          T.armAbd[side] = 0.05;
          T.elbow[side] = 0.1;
          T.armFwd[1 - side] = 1.3;
          T.armAbd[1 - side] = 0.2;
          T.elbow[1 - side] = 1.7;
          T.tiltZ = (side ? -0.55 : 0.55) * launch;
          T.legFwd = [-0.05, -0.35];
          T.knee = [0.6, 0.25];
        } else if (this.catchDive) {
          T.armFwd = [3.05, 3.05];
          T.armAbd = [-0.02, -0.02];
          T.elbow = [0.15, 0.15];
        } else if (this.diveStyle === 1) {
          // spear: shoulder first, arms cocked to wrap
          T.armFwd = [2.1, 2.1];
          T.armAbd = [0.28, 0.28];
          T.elbow = [1.2, 1.2];
          T.headX = -0.35 * launch;
          T.tiltZ = (this.id % 2 ? 0.3 : -0.3) * launch;
        } else {
          T.armFwd = [2.75, 2.75];
          T.armAbd = [0.6, 0.6];
          T.elbow = [0.4, 0.4];
        }
        if (landed) T.bodyY = -0.84;
        else if (this.vy > 0.2 || st < 0.13) T.bodyY = -0.32 * launch;
        else T.bodyY = lerpA(-0.84, -0.32, clamp(v.y / 0.32, 0, 1));
        rate = landed ? 14 : 24;
        break;
      }
      case 'down': {
        const k = this.fallFrom ? 1 : ease(st / 0.3);
        const fwd = this.fallFwd;
        T.tiltX = this.fallTilt * k;
        T.bodyY = -0.86 * k;
        T.headX = (fwd ? -0.5 : 0.15) * k;
        T.armAbd = fwd ? [0.45, 0.75] : [1.0, 0.8];
        T.armFwd = fwd ? [2.6, 2.1] : [0.35, 0.6];
        T.elbow = [0.5, 0.9];
        T.legFwd = fwd ? [-0.05, 0.25] : [0.4, 0.1];
        T.knee = fwd ? [0.3, 0.7] : [0.8, 0.3];
        T.ankle = [0.6, 0.6];
        T.legAbd = [0.12, 0.08];
        T.lean = 0;
        if (v.hug && !this.fallFrom) {
          // the tackler: wrapped around the runner, riding him down and landing on top
          T.armFwd = [lerpA(1.35, 2.0, k), lerpA(1.35, 2.0, k)];
          T.armAbd = [0.08, 0.08];
          T.elbow = [1.25, 1.25];
          T.bodyY = -0.62 * k;
          T.headX = -0.35 * k;
          T.legFwd = [lerpA(0.4, -0.05, k), lerpA(-0.3, 0.15, k)];
          T.knee = [lerpA(0.6, 0.35, k), lerpA(0.3, 0.6, k)];
        } else if (k < 1) {
          // on the way down: hands go out to brace (forward) or fling up (backward)
          for (let i = 0; i < 2; i++) {
            T.armFwd[i] = lerpA(fwd ? 1.3 : 0.9, T.armFwd[i], k);
            T.armAbd[i] = lerpA(fwd ? 0.35 : 0.9, T.armAbd[i], k);
            T.legFwd[i] = lerpA(i === 0 ? 0.3 : -0.1, T.legFwd[i], k);
            T.knee[i] = lerpA(0.4, T.knee[i], k);
          }
        }
        rate = 26;
        break;
      }
      case 'getup': {
        // motion captured: push up off the turf face down, or sit up and climb up off the back
        this.playClip(T, this.fallTilt > 0 ? CLIPS.getupFront : CLIPS.getupBack, clamp(st / GETUP_TIME, 0, 1));
        rate = 30;
        break;
      }
      case 'flying': {
        // blown up: a tumbling, limbs-everywhere ride that lands flat
        const dirS = v.fallFwd ? 1 : -1;
        const air = clamp(st / 0.6, 0, 1);
        T.tiltX = dirS * (this.flip ? 1.5 + Math.PI * 2 : 1.5) * ease(air) + dirS * 0.25 * Math.sin(air * Math.PI);
        T.tiltZ = Math.sin(st * 7 + this.id) * 0.45;
        T.bodyY = -0.2 * air;
        T.armAbd = [1.3 + Math.sin(st * 25) * 0.5, 1.3 + Math.cos(st * 23) * 0.5];
        T.armFwd = [Math.sin(st * 20) * 1.2, Math.cos(st * 18) * 1.2];
        T.legFwd = [Math.sin(st * 17) * 0.9, Math.cos(st * 19) * 0.9];
        T.knee = [0.6, 0.9];
        T.legAbd = [0.25, 0.2];
        rate = 60;
        break;
      }
      case 'stumble': {
        T.lean = 0.75;
        T.armAbd = [0.9, 0.9];
        T.armFwd = [0.7, 0.5];
        T.bodyY = Math.min(T.bodyY, -0.08);
        break;
      }
      case 'kneel': {
        T.bodyY = -0.52;
        T.legFwd = [1.45, -0.15];
        T.knee = [1.55, 1.9];
        T.lean = 0.35;
        T.armFwd = [1.2, 1.2];
        T.elbow = [0.4, 0.4];
        break;
      }
      case 'kick': {
        // captured kick from contact through the follow-through
        this.playClip(T, CLIPS.kick, clamp(st / 0.35, 0, 1));
        T.bodyX = 0;
        T.bodyZ = 0;
        T.bodyY = Math.min(0, T.bodyY);
        rate = 40;
        break;
      }
      case 'celebrate': {
        const kind = (this.id + (ctx.celebrateSeed || 0)) % 3;
        const tt = ctx.time * 6;
        if (v.taunt) {
          // over the man he just flattened: a double-biceps flex, or a point down at him
          const pump = Math.sin(tt * 0.8) * 0.15;
          if ((this.id + (ctx.celebrateSeed || 0)) % 2 === 0) {
            T.armFwd = [0.2, 0.2];
            T.armAbd = [1.35 + pump, 1.35 - pump];
            T.elbow = [2.1, 2.1];
            T.armTwist = [1.45, 1.45];
            T.lean = -0.12;
            T.headX = -0.25;
            T.bodyY = -0.05;
            T.legAbd = [0.16, 0.16];
            T.knee = [0.25, 0.25];
          } else {
            T.armFwd = [0.75, 0.2];
            T.armAbd = [0.15, 0.3];
            T.elbow = [0.05, 0.4];
            T.lean = 0.35;
            T.headX = 0.25;
            T.twist = 0.25 + pump;
            T.legFwd = [0.25, -0.1];
          }
          rate = 14;
          break;
        }
        if (kind === 0 && this.id % 2 === 0) {
          // captured: a happy, arms-up celebration
          this.applyLoop(T, loopAt(CLIPS.happy, (ctx.time / 3.4) * Math.PI * 2 + this.id, false));
          rate = 18;
        } else if (kind === 0) {
          T.bodyY = Math.abs(Math.sin(tt)) * 0.35;
          T.armFwd = [2.9, 2.9];
          T.armAbd = [0.5, 0.5];
          T.elbow = [0.1, 0.1];
        } else if (kind === 1) {
          T.armFwd = [2.8, 0.3];
          T.elbow = [0.2, 1.4];
          T.twist = Math.sin(tt * 0.5) * 0.4;
          T.bodyY = Math.abs(Math.sin(tt * 0.5)) * 0.1;
        } else {
          T.twist = Math.sin(tt) * 0.5;
          T.armFwd = [1.2 + Math.sin(tt) * 0.9, 1.2 - Math.sin(tt) * 0.9];
          T.elbow = [1.4, 1.4];
          T.legFwd = [Math.sin(tt) * 0.3, -Math.sin(tt) * 0.3];
          T.knee = [0.4, 0.4];
        }
        break;
      }
      default:
        break;
    }

    // hands go to the ball: in the air toward a receiver, or caught at the top of a leap
    const airborneCatch = s === 'jump' || (s === 'dive' && this.catchDive && !v.carrying);
    if (v.ball && !v.carrying && (v.reach || airborneCatch) && s !== 'throw') this.aimArms(T, v.ball, s === 'dive' ? 0.15 : 0.25, this.oneHand);
    if (T.headY === undefined) T.headY = -T.twist * 0.4;
    // ball carriers tuck it under the right arm (and pull it in after a catch in the air)
    if (v.carrying && s !== 'celebrate' && s !== 'down' && s !== 'flying' && s !== 'getup' && s !== 'throw' && s !== 'kneel') {
      if (s === 'dive') {
        // a layout catch: show it off, ball held out front
        T.armFwd[0] = 2.6;
        T.elbow[0] = 0.5;
      } else {
        T.armFwd[0] = 0.55;
        T.elbow[0] = 1.95;
        T.armAbd[0] = 0.2;
      }
    }
    if (v.reach && s !== 'jump' && s !== 'dive' && !v.ball) {
      T.armFwd = [2.2, 2.2];
      T.elbow = [0.35, 0.35];
      T.armAbd = [0.15, 0.15];
    }

    // smooth toward the target pose
    const P = this.p;
    const k = 1 - Math.exp(-rate * dt);
    const snap = this.snapNext;
    this.snapNext = false;
    const mix = (a, b) => (snap ? b : lerpA(a, b, k));
    for (const key of ['tiltX', 'tiltZ', 'bodyY', 'bodyX', 'bodyZ', 'lean', 'twist', 'bend', 'headX', 'headY', 'hipTwist']) P[key] = mix(P[key], T[key]);
    P.spin = s === 'spin' ? T.spin : 0;
    for (let i = 0; i < 2; i++) {
      for (const key of ['armFwd', 'armAbd', 'armTwist', 'elbow', 'legFwd', 'knee', 'ankle', 'legAbd']) P[key][i] = mix(P[key][i], T[key][i]);
    }
    this.prevState = s;

    // apply to the skeleton
    const b = this.bones;
    r.rotation.y = v.face + P.spin;
    b.pelvis.position.set(P.bodyX, this.hipY + P.bodyY + v.y, P.bodyZ);
    b.pelvis.rotation.set(P.tiltX, P.hipTwist, P.tiltZ);
    // the lean bends through the lower back and the chest; the head stays up
    b.spine.rotation.set(P.lean * 0.42, (P.twist - P.hipTwist) * 0.45, P.bend * 0.5);
    b.chest.rotation.set(P.lean * 0.58, (P.twist - P.hipTwist) * 0.55, P.bend * 0.5);
    b.head.rotation.set(P.headX - P.lean * 0.55, P.headY, 0);
    const arms = [[b.shR, b.elR], [b.shL, b.elL]];
    const legs = [[b.hipR, b.kneeR, b.footR], [b.hipL, b.kneeL, b.footL]];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      // twist about the upper arm's own axis first, then raise it out to the side, then swing
      arms[i][0].rotation.set(-P.armFwd[i], side * P.armTwist[i], side * (P.armAbd[i] + this.abd), 'XZY');
      arms[i][1].rotation.x = -P.elbow[i];
      legs[i][0].rotation.set(-P.legFwd[i], 0, side * P.legAbd[i]);
      legs[i][1].rotation.x = P.knee[i];
      // the foot stays roughly flat to the body unless the pose points it
      legs[i][2].rotation.x = Math.min(0.5, Math.max(-0.7, P.legFwd[i] - P.knee[i])) * 0.85 + P.ankle[i];
    }
    // shadow blob shrinks when airborne
    const air = Math.max(0, v.y);
    this.blob.scale.setScalar(Math.max(0.4, 1 - air * 0.35));
    this.blob.material.opacity = Math.max(0.25, 0.85 - air * 0.3);
  }

  // State changes that need memory: how a fall started, which kind of dive this is.
  enter(s, prev) {
    // a different move each time: picked per player and per play
    const roll = (this.id * 7 + this.seed * 13 + (s === 'dive' ? 5 : 0)) % 6;
    if (s === 'jump') this.leapStyle = roll % 3;
    if (s === 'jump' || s === 'hurdle') this.airT = s === 'jump' ? (2 * JUMP_VY) / AIR_GRAVITY : (2 * HURDLE_VY) / AIR_GRAVITY;
    if (s === 'dive') {
      this.catchDive = this.reachHint;
      this.diveStyle = roll % 2;
    }
    if (s === 'flying') this.flip = this.id % 3 === 0;
    if (s === 'down') {
      // a diver or a blown-up runner is already on his way down: no second fall
      this.fallFrom = prev === 'dive' || prev === 'flying';
      const cur = this.p.tiltX;
      if (this.fallFrom) {
        // land on whichever side the body is facing
        const w = wrap(cur);
        this.fallFwd = w >= 0;
        this.fallTilt = this.fallFwd ? 1.52 : -1.5;
        this.p.tiltX = w;
      } else {
        this.fallFwd = this.lastFallFwd;
        this.fallTilt = this.fallFwd ? 1.52 : -1.5;
      }
    }
  }

  // Running, backpedaling and shuffling sideways, blended by which way the body is moving
  // relative to where it faces; the stride length grows with speed (long, powerful
  // strides at full tilt) and the body leans into cuts.
  locomotion(T, v, speed, dt) {
    const sf = Math.sin(v.face);
    const cf = Math.cos(v.face);
    const fwd = (v.vx * sf + v.vz * cf) / speed;
    const lat = (v.vx * cf - v.vz * sf) / speed;
    const wRun = Math.max(0, fwd) ** 2;
    const wBack = Math.max(0, -fwd) ** 2;
    const wSide = lat * lat;
    // stride length grows with speed, as measured on real runners (and sprinters)
    const cycle = wRun * (1.4 + 0.36 * speed) + wBack * 1.55 + wSide * (0.8 + 0.15 * speed);
    this.phase += ((speed * dt) / cycle) * Math.PI * 2;
    const ph = this.phase;
    const sn = Math.sin(ph);
    const W = (key, i, val, w) => {
      if (i === undefined) T[key] += val * w;
      else T[key][i] += val * w;
    };
    for (const key of ['lean', 'twist', 'bodyY', 'headX', 'hipTwist', 'tiltZ', 'tiltX', 'bend']) T[key] = 0;
    for (const key of ['armFwd', 'armAbd', 'armTwist', 'elbow', 'legFwd', 'knee', 'ankle', 'legAbd']) T[key] = [0, 0];
    if (wRun > 0) {
      // motion-captured running (jog, run, fast run blended by speed), pushed further at the
      // game's sprint and turbo speeds: longer thigh swing, higher heel kick, harder arm drive
      const g = gaitAt(speed, ph);
      const ex = clamp((speed - 7) / 4, 0, 1) + (v.turbo ? 0.25 : 0);
      const w = wRun;
      for (let i = 0; i < 2; i++) {
        const legF = g.legFwd[i] * (1 + 0.3 * ex) + 0.04 * ex;
        const knee = g.knee[i] * (1 + 0.16 * ex);
        W('legFwd', i, legF, w);
        W('knee', i, knee, w);
        // the captured foot pitch, expressed through the rig's own foot compensation
        const footRot = g.footPitch[i] + legF - knee;
        W('ankle', i, footRot - clamp(legF - knee, -0.7, 0.5) * 0.85, w);
        W('legAbd', i, Math.max(0, g.legAbd[i]) + 0.03, w);
        // arm angles were measured against the vertical; the rig's shoulders lean with the chest.
        // The captured runners jogged with a lazy arm swing: football players pump hard
        const arm = g.armFwd[i] + g.lean;
        W('armFwd', i, ARM_MEAN + (arm - ARM_MEAN) * (1.5 + 0.5 * ex) + 0.18 + 0.12 * ex, w);
        W('armAbd', i, Math.max(g.armAbd[i], this.abd) - this.abd + 0.04, w);
        W('elbow', i, g.elbow[i], w);
      }
      W('lean', undefined, g.lean + 0.1 * ex, w);
      W('twist', undefined, g.twist * (1 + 0.25 * ex), w);
      W('hipTwist', undefined, g.hipTwist, w);
      W('tiltZ', undefined, g.roll * 0.5, w);
      W('bodyY', undefined, g.bodyY * this.legLen - 0.02 - 0.04 * clamp(speed / 9, 0, 1), w);
    }
    if (wBack > 0) {
      // backpedal: the captured jog run backwards with short, quick steps, hips low and the
      // chest over the knees, arms pumping in time
      const g = gaitAt(3, -ph);
      const k = clamp(speed / 6, 0.4, 1);
      const w = wBack;
      for (let i = 0; i < 2; i++) {
        const legF = 0.42 + (g.legFwd[i] - 0.2) * 0.55 * k;
        const knee = 0.55 + g.knee[i] * 0.6 * k;
        W('legFwd', i, legF, w);
        W('knee', i, knee, w);
        W('ankle', i, (g.footPitch[i] * 0.5 + legF - knee) - clamp(legF - knee, -0.7, 0.5) * 0.85, w);
        W('legAbd', i, 0.1, w);
        W('armFwd', i, ARM_MEAN + 0.55 + (g.armFwd[i] + g.lean - ARM_MEAN) * 1.1 * k, w);
        W('armAbd', i, 0.12, w);
        W('elbow', i, 1.5, w);
      }
      W('bodyY', undefined, -0.16 - 0.04 * k + g.bodyY * this.legLen * 0.6, w);
      W('lean', undefined, 0.42, w);
      W('twist', undefined, g.twist * 0.5, w);
      W('hipTwist', undefined, g.hipTwist * 0.5, w);
    }
    if (wSide > 0) {
      // a captured defensive shuffle (low, wide, step out and close), mirrored going left
      const c = loopAt(CLIPS.shuffle, ph, lat > 0);
      const w = wSide;
      W('tiltX', undefined, c.tiltX, w);
      W('tiltZ', undefined, c.tiltZ, w);
      W('hipTwist', undefined, c.hipTwist, w);
      W('lean', undefined, c.lean, w);
      W('twist', undefined, c.twist, w);
      W('bend', undefined, c.bend, w);
      W('bodyY', undefined, c.bodyY * this.legLen, w);
      for (let i = 0; i < 2; i++) {
        W('legFwd', i, c.legFwd[i], w);
        W('legAbd', i, c.legAbd[i], w);
        W('knee', i, c.knee[i], w);
        W('ankle', i, c.foot[i] - clamp(c.legFwd[i] - c.knee[i], -0.7, 0.5) * 0.85, w);
        W('armFwd', i, c.armFwd[i], w);
        W('armAbd', i, Math.max(c.armAbd[i], this.abd * 0.6) - this.abd, w);
        W('armTwist', i, c.armTwist[i], w);
        W('elbow', i, c.elbow[i], w);
      }
    }
    // lean into the cut
    T.tiltZ = clamp(-this.turnRate * speed * 0.022, -0.38, 0.38) * (wRun + 0.5 * wSide);
  }

  // Pose from a sampled loop (see loopAt).
  applyLoop(T, c) {
    T.tiltX = c.tiltX;
    T.tiltZ = c.tiltZ;
    T.hipTwist = c.hipTwist;
    T.lean = c.lean;
    T.twist = c.twist;
    T.bend = c.bend;
    T.bodyY = c.bodyY * this.legLen;
    for (let i = 0; i < 2; i++) {
      T.legFwd[i] = c.legFwd[i];
      T.legAbd[i] = c.legAbd[i];
      T.knee[i] = c.knee[i];
      T.ankle[i] = c.foot[i] - clamp(c.legFwd[i] - c.knee[i], -0.7, 0.5) * 0.85;
      T.armFwd[i] = c.armFwd[i];
      T.armAbd[i] = Math.max(c.armAbd[i], this.abd * 0.6) - this.abd;
      T.armTwist[i] = c.armTwist[i];
      T.elbow[i] = c.elbow[i];
    }
  }

  // A captured running leap (the lead leg alternates by player), stretched over this leap's
  // own time in the air. Height comes from the sim, so the clip's hip rise is dropped.
  playLeap(T, st) {
    this.playClip(T, this.id % 2 ? CLIPS.leapB : CLIPS.leapA, clamp(st / this.airT, 0, 1));
    T.bodyY = 0;
    T.bodyX = 0;
    T.bodyZ = 0;
  }

  // Pose from a motion-captured one-shot clip at u (0..1).
  playClip(T, clip, u) {
    const n = clip.n;
    const x = u * (n - 1);
    const i0 = Math.min(n - 2, Math.floor(x));
    const f = x - i0;
    const c = clip.t;
    const at = (k) => c[k][i0] + (c[k][i0 + 1] - c[k][i0]) * f;
    T.tiltX = at('tiltX');
    T.hipTwist = at('hipTwist');
    T.tiltZ = at('tiltZ');
    T.lean = at('lean');
    T.twist = at('twist');
    T.bend = at('bend');
    T.headX = at('headX');
    T.headY = 0;
    const L = this.legLen;
    T.bodyY = at('bodyY') * L;
    // he gets up where he went down: the captured drift across the floor is faded out by the end
    T.bodyZ = (at('bodyZ') - c.bodyZ[0] * (1 - u)) * L;
    T.bodyX = (at('bodyX') - c.bodyX[0] * (1 - u)) * L;
    for (let i = 0; i < 2; i++) {
      const legF = at(`legFwd${i}`);
      const knee = at(`knee${i}`);
      T.legFwd[i] = legF;
      T.legAbd[i] = at(`legAbd${i}`);
      T.knee[i] = knee;
      T.ankle[i] = at(`foot${i}`) - clamp(legF - knee, -0.7, 0.5) * 0.85;
      T.armFwd[i] = at(`armFwd${i}`);
      T.armAbd[i] = Math.max(at(`armAbdTotal${i}`), this.abd * 0.6) - this.abd;
      T.armTwist[i] = at(`armTwist${i}`);
      T.elbow[i] = at(`elbow${i}`);
    }
  }

  // Point both arms (or just arm `only`) at a spot in the world (the ball): the hands come
  // together on it.
  aimArms(T, ball, elbow, only = -1) {
    const chest = this.bones.chest;
    chest.updateWorldMatrix(true, false);
    tmpA.set(ball.x, ball.y, ball.z);
    chest.worldToLocal(tmpA);
    for (let i = 0; i < 2; i++) {
      if (only >= 0 && i !== only) continue;
      const side = i === 0 ? -1 : 1;
      const sh = i === 0 ? this.bones.shR.position : this.bones.shL.position;
      const dx = tmpA.x - sh.x * 0.55;
      const dy = tmpA.y - sh.y;
      const dz = tmpA.z - sh.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      const g = Math.asin(clamp(dx / l, -1, 1));
      T.armAbd[i] = clamp(side * g - this.abd, -0.35, 1.5);
      T.armFwd[i] = clamp(Math.atan2(dz / l, -dy / l), -0.8, 3.25);
      T.elbow[i] = clamp(elbow + Math.max(0, 0.75 - l) * 1.6, elbow, 1.4);
    }
  }

  handWorld(out) {
    return this.palm.getWorldPosition(out);
  }
}
