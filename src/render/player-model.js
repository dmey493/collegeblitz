// Bulky Blitz-style football player: one skinned mesh per player (giant pads,
// barrel chest, slim legs, glossy helmet and cage) posed by a small pose system
// driven by the sim state.
import * as THREE from 'three';
import { blobTexture, uniformTexture, helmetTexture } from './textures.js';
import { BODY, buildBones, buildPlayerGeometry } from './player-geo.js';

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
    skin: SKINS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, vertexColors: true })),
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

function materialsFor(team, num, skinIdx, visor, envMap) {
  const S = sharedAssets();
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
    S.uniforms.set(ukey, new THREE.MeshStandardMaterial({ map: uniformTexture(team, num), vertexColors: true, roughness: 0.66 }));
  }
  return [S.uniforms.get(ukey), S.skin[skinIdx], S.helmets.get(team.id), S.gear, visor ? S.visor : S.hidden];
}

const lerpA = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class PlayerModel {
  constructor({ team, num, body, slot, id, envMap }) {
    const S = sharedAssets();
    const B = BODY[body] || BODY.mid;
    this.B = B;
    this.slot = slot;
    this.id = id;
    this.phase = Math.random() * 6;
    // bulkier players carry their arms further out from the body
    this.abd = 0.16 + (B.w - 1) * 0.55;
    this.root = new THREE.Group();

    const skinIdx = (id * 7 + num) % SKINS.length;
    const visor = ((id * 31 + num * 7) % 10) < (body === 'big' ? 1 : 4);
    const mesh = new THREE.SkinnedMesh(geometryFor(body, team), materialsFor(team, num, skinIdx, visor, envMap));
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
          T.headX = -0.35;
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
          T.headX = -0.1;
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
        T.headX = -0.1;
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

    // apply to the skeleton
    const b = this.bones;
    r.rotation.y = v.face + P.spin;
    b.pelvis.position.y = this.B.h + P.bodyY + v.y;
    b.pelvis.rotation.set(P.tiltX, 0, P.tiltZ);
    // the lean bends through the lower back and the chest; the head stays up
    b.spine.rotation.set(P.lean * 0.42, P.twist * 0.45, 0);
    b.chest.rotation.set(P.lean * 0.58, P.twist * 0.55, 0);
    b.head.rotation.set(P.headX - P.lean * 0.55, 0, 0);
    const arms = [[b.shR, b.elR], [b.shL, b.elL]];
    const legs = [[b.hipR, b.kneeR], [b.hipL, b.kneeL]];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      arms[i][0].rotation.set(-P.armFwd[i], 0, side * (P.armAbd[i] + this.abd));
      arms[i][1].rotation.x = -P.elbow[i];
      legs[i][0].rotation.x = -P.legFwd[i];
      legs[i][1].rotation.x = P.knee[i];
    }
    // shadow blob shrinks when airborne
    const air = Math.max(0, v.y);
    this.blob.scale.setScalar(Math.max(0.4, 1 - air * 0.35));
    this.blob.material.opacity = Math.max(0.25, 0.85 - air * 0.3);
  }

  handWorld(out) {
    return this.palm.getWorldPosition(out);
  }
}
