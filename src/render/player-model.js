// Procedural football player: oversized pads and helmet, glossy shell,
// numbers front and back, and a pose system driven by the sim state.
import * as THREE from 'three';
import { jerseyNumberTexture, blobTexture } from './textures.js';

const SKINS = ['#f1c7a3', '#d9a476', '#b97c4f', '#8a5636', '#5d3a25', '#ebb995'];
const BODY = {
  big: { w: 1.24, d: 1.18, limb: 1.22, h: 1.0 },
  mid: { w: 1.08, d: 1.05, limb: 1.06, h: 1.0 },
  small: { w: 0.98, d: 0.96, limb: 0.95, h: 0.99 },
};

let shared = null;
function sharedAssets() {
  if (shared) return shared;
  const capsule = (r, l) => new THREE.CapsuleGeometry(r, l, 5, 10);
  shared = {
    thigh: capsule(0.115, 0.32),
    shin: capsule(0.078, 0.36),
    upper: capsule(0.074, 0.22),
    fore: capsule(0.066, 0.2),
    hand: new THREE.SphereGeometry(0.068, 10, 8),
    foot: new THREE.BoxGeometry(0.13, 0.085, 0.3),
    pelvis: (() => {
      const g = new THREE.SphereGeometry(0.23, 14, 10);
      g.scale(1.0, 0.72, 0.72);
      return g;
    })(),
    torso: (() => {
      const g = new THREE.CylinderGeometry(0.3, 0.22, 0.56, 12, 1);
      g.scale(1, 1, 0.68);
      return g;
    })(),
    pads: (() => {
      const g = new THREE.SphereGeometry(0.5, 16, 10);
      g.scale(0.86, 0.3, 0.52);
      return g;
    })(),
    neck: new THREE.CylinderGeometry(0.075, 0.085, 0.14, 10),
    helmet: (() => {
      const g = new THREE.SphereGeometry(0.175, 20, 16);
      g.scale(1.0, 1.02, 1.12);
      return g;
    })(),
    stripe: new THREE.TorusGeometry(0.178, 0.022, 6, 24, Math.PI * 1.15),
    maskBar: new THREE.TorusGeometry(0.15, 0.011, 5, 16, Math.PI * 0.95),
    maskV: new THREE.CylinderGeometry(0.011, 0.011, 0.17, 5),
    num: new THREE.PlaneGeometry(0.34, 0.34),
    blob: new THREE.PlaneGeometry(1.4, 1.4),
    blobTex: blobTexture(),
    skin: SKINS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })),
    teamMats: new Map(),
  };
  shared.blob.rotateX(-Math.PI / 2);
  return shared;
}

function teamMaterials(team, envMap) {
  const S = sharedAssets();
  if (S.teamMats.has(team.id)) return S.teamMats.get(team.id);
  const c = team.colors;
  const std = (color, rough = 0.62, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const m = {
    jersey: std(c.jersey, 0.55),
    sleeve: std(c.sleeve, 0.55),
    pants: std(c.pants, 0.5),
    helmet: new THREE.MeshStandardMaterial({ color: c.helmet, roughness: 0.18, metalness: 0.25, envMap, envMapIntensity: 1.2 }),
    stripe: new THREE.MeshStandardMaterial({ color: c.helmetStripe, roughness: 0.25, metalness: 0.1, envMap, envMapIntensity: 0.8 }),
    mask: std(c.mask, 0.35, 0.6),
    socks: std(c.socks, 0.7),
    cleats: std(c.cleats, 0.4),
    gloves: std(c.gloves, 0.5),
  };
  S.teamMats.set(team.id, m);
  return m;
}

const numMatCache = new Map();
function numberMaterial(team, num) {
  const key = `${team.id}-${num}`;
  if (!numMatCache.has(key)) {
    numMatCache.set(key, new THREE.MeshStandardMaterial({
      map: jerseyNumberTexture(team, num), transparent: true, alphaTest: 0.35, roughness: 0.55,
      polygonOffset: true, polygonOffsetFactor: -2,
    }));
  }
  return numMatCache.get(key);
}

const lerpA = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class PlayerModel {
  constructor({ team, num, body, slot, id, envMap }) {
    const S = sharedAssets();
    const M = teamMaterials(team, envMap);
    const B = BODY[body] || BODY.mid;
    this.B = B;
    this.slot = slot;
    this.id = id;
    this.phase = Math.random() * 6;
    this.root = new THREE.Group();
    this.tilt = new THREE.Group(); // whole-body pitch/roll around the hips
    this.tilt.position.y = 1.0 * B.h;
    this.root.add(this.tilt);
    this.hips = new THREE.Group();
    this.tilt.add(this.hips);
    const skin = S.skin[(id * 7 + num) % S.skin.length];

    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // pelvis + legs
    const pel = mesh(S.pelvis, M.pants, this.hips, 0, -0.02, 0);
    pel.scale.set(B.w, 1, B.d);
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.12 * B.w, -0.1, 0);
      this.hips.add(hip);
      const th = mesh(S.thigh, M.pants, hip, 0, -0.22, 0);
      th.scale.set(B.limb, 1, B.limb);
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      hip.add(knee);
      const sh = mesh(S.shin, M.socks, knee, 0, -0.22, 0);
      sh.scale.set(B.limb, 1, B.limb);
      const foot = mesh(S.foot, M.cleats, knee, 0, -0.45, 0.07);
      foot.scale.set(B.limb, 1, 1);
      this.legs.push({ hip, knee });
    }

    // torso
    this.torso = new THREE.Group();
    this.torso.position.y = 0.08;
    this.hips.add(this.torso);
    const tor = mesh(S.torso, M.jersey, this.torso, 0, 0.28, 0);
    tor.scale.set(B.w, 1, B.d);
    const pads = mesh(S.pads, M.jersey, this.torso, 0, 0.56, 0);
    pads.scale.set(B.w, 1, B.d);
    const nm = numberMaterial(team, num);
    const front = mesh(S.num, nm, this.torso, 0, 0.3, 0.215 * B.d);
    front.castShadow = false;
    const back = mesh(S.num, nm, this.torso, 0, 0.36, -0.235 * B.d);
    back.rotation.y = Math.PI;
    back.castShadow = false;
    mesh(S.neck, skin, this.torso, 0, 0.68, 0);

    // helmet
    this.head = new THREE.Group();
    this.head.position.set(0, 0.86, 0.01);
    this.torso.add(this.head);
    mesh(S.helmet, M.helmet, this.head, 0, 0, 0);
    const stripe = mesh(S.stripe, M.stripe, this.head, 0, 0, -0.01);
    stripe.rotation.set(0, Math.PI / 2, 0);
    stripe.rotation.order = 'YXZ';
    stripe.rotation.x = -0.2;
    for (const [y, sc] of [[-0.05, 1], [-0.11, 0.9]]) {
      const bar = mesh(S.maskBar, M.mask, this.head, 0, y, 0.075);
      bar.rotation.x = Math.PI / 2;
      bar.rotation.z = Math.PI * 0.025;
      bar.scale.set(sc, sc, sc);
      bar.castShadow = false;
    }
    const v = mesh(S.maskV, M.mask, this.head, 0, -0.07, 0.225);
    v.castShadow = false;

    // arms
    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(side * 0.34 * B.w, 0.52, 0);
      this.torso.add(sh);
      const up = mesh(S.upper, M.sleeve === M.jersey ? M.jersey : M.jersey, sh, 0, -0.16, 0);
      up.scale.set(B.limb, 1, B.limb);
      const elbow = new THREE.Group();
      elbow.position.y = -0.33;
      sh.add(elbow);
      const fa = mesh(S.fore, skin, elbow, 0, -0.14, 0);
      fa.scale.set(B.limb, 1, B.limb);
      const hand = mesh(S.hand, M.gloves, elbow, 0, -0.31, 0);
      hand.scale.setScalar(B.limb);
      this.arms.push({ sh, elbow, hand });
    }
    // index 0 = right side (-x), 1 = left side (+x) since the model faces +z
    this.rightHand = this.arms[0].hand;

    // contact shadow
    this.blob = new THREE.Mesh(S.blob, new THREE.MeshBasicMaterial({ map: S.blobTex, transparent: true, depthWrite: false, opacity: 0.85 }));
    this.blob.position.y = 0.015;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);

    // pose state (current values, smoothed toward targets)
    this.p = {
      tiltX: 0, tiltZ: 0, bodyY: 0, spin: 0, lean: 0, twist: 0, headX: 0,
      armFwd: [0, 0], armAbd: [0.15, 0.15], elbow: [0.3, 0.3],
      legFwd: [0, 0], knee: [0.1, 0.1],
    };
    this.prevState = '';
  }

  // view: { x, z, y, face, vx, vz, state, st, turbo, fallFwd, carrying, kind, celebrate }
  update(v, dt, ctx) {
    const r = this.root;
    r.position.set(v.x, 0, v.z);
    const speed = Math.hypot(v.vx, v.vz);
    const run = Math.min(1, speed / 9);
    this.phase += (speed * dt) / 2.3 * Math.PI * 2;
    const ph = this.phase;
    const T = {
      tiltX: 0, tiltZ: 0, bodyY: 0, spin: 0, lean: 0.06, twist: 0, headX: 0,
      armFwd: [0.12, 0.12], armAbd: [0.16, 0.16], elbow: [0.35, 0.35],
      legFwd: [0, 0], knee: [0.08, 0.08],
    };
    let rate = 16;
    const s = v.state;
    const st = v.st;
    const big = this.slot === 'C' || this.slot === 'LG' || this.slot === 'RG' || this.slot === 'DL1' || this.slot === 'DL2';

    if (speed > 0.4 && (s === 'stand' || s === 'stumble' || s === 'celebrate' || s === 'catch')) {
      // run cycle
      const A = 0.25 + 0.6 * run + (v.turbo ? 0.08 : 0);
      const sn = Math.sin(ph);
      T.legFwd = [A * sn, -A * sn];
      T.knee = [0.25 + 1.25 * A * Math.max(0, Math.sin(ph + 1.3)), 0.25 + 1.25 * A * Math.max(0, Math.sin(ph + 1.3 + Math.PI))];
      T.armFwd = [-0.85 * A * sn, 0.85 * A * sn];
      T.elbow = [0.9 + 0.7 * run, 0.9 + 0.7 * run];
      T.armAbd = [0.12, 0.12];
      T.lean = 0.1 + 0.28 * run + (v.turbo ? 0.12 : 0);
      T.bodyY = Math.abs(Math.sin(ph)) * 0.07 * run - 0.03 * run;
      rate = 22;
    } else if (s === 'stand' || s === 'celebrate') {
      // idle breathing
      T.lean = 0.05 + Math.sin(ctx.time * 2 + this.id) * 0.015;
      T.knee = [0.12, 0.12];
      T.legFwd = [0.05, -0.02];
      T.armAbd = [0.22, 0.22];
    }

    switch (s) {
      case 'stance': {
        if (big) {
          T.bodyY = -0.32;
          T.lean = 1.15;
          T.legFwd = [1.0, 0.55];
          T.knee = [1.55, 1.2];
          T.armFwd = [1.35, 0.9];
          T.elbow = [0.05, 0.9];
          T.armAbd = [0.05, 0.25];
          T.headX = -0.9;
        } else if (this.slot === 'QB') {
          T.bodyY = -0.06;
          T.lean = 0.25;
          T.knee = [0.45, 0.45];
          T.legFwd = [0.3, 0.15];
          T.armFwd = [0.9, 0.9];
          T.elbow = [1.2, 1.2];
        } else {
          T.bodyY = -0.14;
          T.lean = 0.5;
          T.knee = [0.75, 0.6];
          T.legFwd = [0.55, 0.15];
          T.armFwd = [0.75, 0.6];
          T.elbow = [0.55, 0.55];
          T.headX = -0.35;
        }
        break;
      }
      case 'engaged': {
        const sh = Math.sin(ctx.time * 9 + this.id) * 0.15;
        T.lean = 0.5;
        T.bodyY = -0.1;
        T.legFwd = [0.55 + sh, -0.25 - sh];
        T.knee = [0.75, 0.45];
        T.armFwd = [1.55, 1.55];
        T.elbow = [0.55, 0.55];
        T.armAbd = [0.25, 0.25];
        T.headX = -0.3;
        break;
      }
      case 'throw': {
        const u = st / 0.32;
        if (u < 0.35) {
          T.armFwd[0] = -0.7;
          T.armAbd[0] = 1.3;
          T.elbow[0] = 1.7;
          T.twist = -0.45;
        } else if (u < 0.65) {
          T.armFwd[0] = 2.3;
          T.armAbd[0] = 0.5;
          T.elbow[0] = 0.25;
          T.twist = 0.45;
          rate = 40;
        } else {
          T.armFwd[0] = 1.3;
          T.armAbd[0] = 0.2;
          T.elbow[0] = 0.4;
          T.twist = 0.3;
        }
        T.armFwd[1] = 0.9;
        T.elbow[1] = 1.2;
        T.lean = 0.2;
        break;
      }
      case 'catch': {
        T.armFwd = [1.4, 1.4];
        T.elbow = [0.9, 0.9];
        break;
      }
      case 'jump': {
        T.armFwd = [2.9, 2.9];
        T.armAbd = [0.25, 0.25];
        T.elbow = [0.2, 0.2];
        T.legFwd = [0.5, 0.15];
        T.knee = [1.1, 0.6];
        rate = 24;
        break;
      }
      case 'hurdle': {
        T.legFwd = [1.5, -0.7];
        T.knee = [0.2, 1.6];
        T.armAbd = [0.9, 0.9];
        T.armFwd = [0.6, 0.6];
        T.lean = 0.35;
        rate = 24;
        break;
      }
      case 'spin': {
        T.spin = ease(st / 0.42) * Math.PI * 2;
        T.armAbd = [0.8, 0.8];
        T.lean = 0.25;
        rate = 30;
        break;
      }
      case 'stiff': {
        T.armFwd[1] = 1.55;
        T.elbow[1] = 0.02;
        T.armAbd[1] = 0.12;
        T.twist = -0.25;
        rate = 30;
        break;
      }
      case 'dive': {
        T.tiltX = 1.45;
        T.bodyY = -0.25;
        T.armFwd = [3.0, 3.0];
        T.elbow = [0.1, 0.1];
        T.legFwd = [-0.2, -0.3];
        T.knee = [0.2, 0.3];
        T.lean = 0.05;
        rate = 18;
        break;
      }
      case 'down': {
        const k = ease(st / 0.35);
        T.tiltX = (v.fallFwd ? 1.5 : -1.5) * k;
        T.bodyY = -0.78 * k;
        T.armAbd = [1.1, 0.9];
        T.armFwd = v.fallFwd ? [2.6, 2.4] : [0.4, 0.6];
        T.elbow = [0.4, 0.6];
        T.legFwd = [0.25, -0.15];
        T.knee = [0.5, 0.2];
        T.lean = 0;
        rate = 26;
        break;
      }
      case 'getup': {
        const k = 1 - ease(st / 0.45);
        T.tiltX = (v.fallFwd ? 1.5 : -1.5) * k;
        T.bodyY = -0.78 * k;
        T.knee = [0.9 * k + 0.1, 0.5 * k + 0.1];
        T.legFwd = [0.9 * k, 0.4 * k];
        T.armFwd = [0.6, 0.6];
        rate = 30;
        break;
      }
      case 'flying': {
        const dirS = v.fallFwd ? 1 : -1;
        T.tiltX = dirS * st * 9;
        T.tiltZ = Math.sin(st * 7) * 0.4;
        T.armAbd = [1.4 + Math.sin(st * 25) * 0.5, 1.4 + Math.cos(st * 23) * 0.5];
        T.armFwd = [Math.sin(st * 20) * 1.2, Math.cos(st * 18) * 1.2];
        T.legFwd = [Math.sin(st * 17) * 0.9, Math.cos(st * 19) * 0.9];
        T.knee = [0.6, 0.9];
        rate = 60;
        break;
      }
      case 'stumble': {
        T.lean = 0.7;
        T.armAbd = [0.9, 0.9];
        T.armFwd = [0.6, 0.6];
        break;
      }
      case 'kneel': {
        T.bodyY = -0.5;
        T.legFwd = [1.45, -0.15];
        T.knee = [1.55, 1.85];
        T.lean = 0.35;
        T.armFwd = [1.2, 1.2];
        T.elbow = [0.4, 0.4];
        break;
      }
      case 'kick': {
        const u = Math.min(1, st / 0.35);
        T.legFwd = [u < 0.35 ? -0.7 : 1.7, 0.05];
        T.knee = [u < 0.35 ? 1.3 : 0.1, 0.15];
        T.armAbd = [1.1, 1.1];
        T.lean = -0.1;
        rate = 35;
        break;
      }
      case 'celebrate': {
        const kind = (this.id + (ctx.celebrateSeed || 0)) % 3;
        const tt = ctx.time * 6;
        if (kind === 0) {
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

    // ball carriers tuck it under the right arm
    if (v.carrying && (s === 'stand' || s === 'spin' || s === 'stiff' || s === 'hurdle' || s === 'stumble' || s === 'catch' || s === 'celebrate')) {
      if (!(s === 'celebrate')) {
        T.armFwd[0] = 0.55;
        T.elbow[0] = 1.95;
        T.armAbd[0] = 0.2;
      }
    }
    // receivers reaching for a ball in the air
    if (v.reach && s !== 'jump' && s !== 'dive') {
      T.armFwd = [2.2, 2.2];
      T.elbow = [0.35, 0.35];
      T.armAbd = [0.15, 0.15];
    }

    // smooth toward the target pose
    const P = this.p;
    const k = 1 - Math.exp(-rate * dt);
    const snap = s !== this.prevState && (s === 'flying');
    const mix = (a, b) => (snap ? b : lerpA(a, b, k));
    for (const key of ['tiltX', 'tiltZ', 'bodyY', 'lean', 'twist', 'headX']) P[key] = mix(P[key], T[key]);
    P.spin = s === 'spin' ? T.spin : 0;
    for (let i = 0; i < 2; i++) {
      P.armFwd[i] = mix(P.armFwd[i], T.armFwd[i]);
      P.armAbd[i] = mix(P.armAbd[i], T.armAbd[i]);
      P.elbow[i] = mix(P.elbow[i], T.elbow[i]);
      P.legFwd[i] = mix(P.legFwd[i], T.legFwd[i]);
      P.knee[i] = mix(P.knee[i], T.knee[i]);
    }
    this.prevState = s;

    // apply
    r.rotation.y = v.face + P.spin;
    this.tilt.position.y = this.B.h * 1.0 + P.bodyY + v.y;
    this.tilt.rotation.set(P.tiltX, 0, P.tiltZ);
    this.torso.rotation.set(P.lean, P.twist, 0);
    this.head.rotation.x = P.headX;
    for (let i = 0; i < 2; i++) {
      const a = this.arms[i];
      const side = i === 0 ? -1 : 1;
      a.sh.rotation.set(-P.armFwd[i], 0, side * P.armAbd[i]);
      a.elbow.rotation.x = -P.elbow[i];
      const l = this.legs[i];
      l.hip.rotation.x = -P.legFwd[i];
      l.knee.rotation.x = P.knee[i];
    }
    // shadow blob shrinks when airborne
    const air = Math.max(0, v.y);
    this.blob.scale.setScalar(Math.max(0.4, 1 - air * 0.35));
    this.blob.material.opacity = Math.max(0.25, 0.85 - air * 0.3);
  }

  handWorld(out) {
    return this.rightHand.getWorldPosition(out);
  }
}
