// Bulky Blitz-style football player: one skinned mesh per player (giant pads,
// barrel chest, slim legs, glossy helmet and cage) posed by a small pose system
// driven by the sim state.
import * as THREE from 'three';
import { blobTexture, uniformTexture, uniformNormalMap, helmetTexture, skinTexture, skinNormalMap } from './textures.js';
import { BODY, buildBones, buildPlayerGeometry, rigSpec } from './player-geo.js';

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

const basePose = () => ({
  tiltX: 0, tiltZ: 0, bodyY: 0, spin: 0, lean: 0.06, twist: 0, headX: 0, hipTwist: 0,
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
    if (s !== this.prevState) this.enter(s, this.prevState);

    const T = basePose();
    let rate = 16;
    const big = this.slot === 'C' || this.slot === 'LG' || this.slot === 'RG' || this.slot === 'DL1' || this.slot === 'DL2';
    const moving = speed > 0.4 && (s === 'stand' || s === 'stumble' || s === 'celebrate' || s === 'catch');

    if (moving) {
      this.locomotion(T, v, speed, dt);
      rate = 22;
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
        const sh = Math.sin(ctx.time * 9 + this.id) * 0.15;
        T.lean = 0.55;
        T.bodyY = -0.14;
        T.legFwd = [0.6 + sh, -0.3 - sh];
        T.knee = [0.8, 0.5];
        T.legAbd = [0.14, 0.14];
        T.armFwd = [1.55, 1.55];
        T.elbow = [0.55, 0.55];
        T.armAbd = [0.25, 0.25];
        T.headX = -0.1;
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
        // explode up driving one knee, hands reaching; legs come down to land
        const lead = this.id % 2;
        const up = ease(Math.min(1, st / 0.12));
        const rising = this.vy > -0.5;
        T.legFwd = [0, 0];
        T.knee = [0, 0];
        T.legFwd[lead] = 1.05 * up;
        T.knee[lead] = 1.55 * up;
        T.legFwd[1 - lead] = -0.2;
        T.knee[1 - lead] = 0.3;
        T.ankle = [0.6, 0.6];
        T.legAbd = [0.05, 0.05];
        T.armFwd = [2.85, 2.85];
        T.armAbd = [0.12, 0.12];
        T.elbow = [0.25, 0.25];
        T.lean = -0.06;
        T.headX = -0.3;
        if (!rising) {
          T.legFwd = [0.35, 0.3];
          T.knee = [0.5, 0.4];
          T.ankle = [0.25, 0.25];
          T.lean = 0.12;
          T.headX = -0.1;
          if (v.y < 0.25) {
            T.knee = [0.8, 0.7];
            T.bodyY = -0.06;
          }
        }
        rate = 20;
        break;
      }
      case 'hurdle': {
        const up = ease(Math.min(1, st / 0.12));
        T.legFwd = [1.5 * up, -0.7 * up];
        T.knee = [0.15, 1.7 * up];
        T.ankle = [0.1, 0.7];
        T.armAbd = [0.9, 0.9];
        T.armFwd = [0.6, 0.6];
        T.lean = 0.45;
        rate = 24;
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
        if (this.catchDive) {
          T.armFwd = [3.05, 3.05];
          T.armAbd = [-0.02, -0.02];
          T.elbow = [0.15, 0.15];
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
        if (k < 1) {
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
        const k = 1 - ease(st / 0.45);
        T.tiltX = this.fallTilt * k;
        T.bodyY = -0.86 * k;
        T.knee = [1.2 * k + 0.15, 0.6 * k + 0.15];
        T.legFwd = [1.0 * k, 0.4 * k];
        T.armFwd = [0.9 * k + 0.3, 0.6];
        T.armAbd = [0.3, 0.3];
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
        const u = Math.min(1, st / 0.35);
        T.legFwd = [u < 0.35 ? -0.7 : 1.7, 0.05];
        T.knee = [u < 0.35 ? 1.3 : 0.1, 0.15];
        T.ankle = [u < 0.35 ? 0 : 0.6, 0];
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

    // hands go to the ball: in the air toward a receiver, or caught at the top of a leap
    const airborneCatch = s === 'jump' || (s === 'dive' && this.catchDive && !v.carrying);
    if (v.ball && !v.carrying && (v.reach || airborneCatch) && s !== 'throw') this.aimArms(T, v.ball, s === 'dive' ? 0.15 : 0.25);
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
    for (const key of ['tiltX', 'tiltZ', 'bodyY', 'lean', 'twist', 'headX', 'hipTwist']) P[key] = mix(P[key], T[key]);
    P.spin = s === 'spin' ? T.spin : 0;
    for (let i = 0; i < 2; i++) {
      for (const key of ['armFwd', 'armAbd', 'armTwist', 'elbow', 'legFwd', 'knee', 'ankle', 'legAbd']) P[key][i] = mix(P[key][i], T[key][i]);
    }
    this.prevState = s;

    // apply to the skeleton
    const b = this.bones;
    r.rotation.y = v.face + P.spin;
    b.pelvis.position.y = this.hipY + P.bodyY + v.y;
    b.pelvis.rotation.set(P.tiltX, P.hipTwist, P.tiltZ);
    // the lean bends through the lower back and the chest; the head stays up
    b.spine.rotation.set(P.lean * 0.42, (P.twist - P.hipTwist) * 0.45, 0);
    b.chest.rotation.set(P.lean * 0.58, (P.twist - P.hipTwist) * 0.55, 0);
    b.head.rotation.set(P.headX - P.lean * 0.55, -P.twist * 0.4, 0);
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
    if (s === 'dive') this.catchDive = this.reachHint;
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
    const cycle = wRun * (2.2 + 0.26 * speed) + wBack * 1.55 + wSide * 1.8;
    this.phase += ((speed * dt) / cycle) * Math.PI * 2;
    const ph = this.phase;
    const sn = Math.sin(ph);
    const W = (key, i, val, w) => {
      if (i === undefined) T[key] += val * w;
      else T[key][i] += val * w;
    };
    for (const key of ['lean', 'twist', 'bodyY', 'headX', 'hipTwist', 'tiltZ']) T[key] = 0;
    for (const key of ['armFwd', 'armAbd', 'armTwist', 'elbow', 'legFwd', 'knee', 'ankle', 'legAbd']) T[key] = [0, 0];
    if (wRun > 0) {
      const run = clamp(speed / 9, 0, 1);
      const A = 0.3 + 0.55 * run + (v.turbo ? 0.1 : 0);
      const fold = 0.3 + 1.45 * A;
      const w = wRun;
      W('legFwd', 0, 0.1 * run + A * sn, w);
      W('legFwd', 1, 0.1 * run - A * sn, w);
      W('knee', 0, 0.18 + fold * Math.max(0, Math.sin(ph + 1.25)) ** 1.4, w);
      W('knee', 1, 0.18 + fold * Math.max(0, Math.sin(ph + 1.25 + Math.PI)) ** 1.4, w);
      W('ankle', 0, 0.55 * run * Math.max(0, -sn), w);
      W('ankle', 1, 0.55 * run * Math.max(0, sn), w);
      W('legAbd', 0, 0.03, w);
      W('legAbd', 1, 0.03, w);
      // pumping arms: the lean tips the shoulders forward, so the swing is biased forward
      const fwdBias = 0.25 + 0.35 * run;
      W('armFwd', 0, fwdBias - 1.0 * A * sn, w);
      W('armFwd', 1, fwdBias + 1.0 * A * sn, w);
      W('elbow', 0, 1.5 - 0.3 * sn, w);
      W('elbow', 1, 1.5 + 0.3 * sn, w);
      W('armAbd', 0, 0.05, w);
      W('armAbd', 1, 0.05, w);
      W('lean', undefined, 0.1 + 0.3 * run + (v.turbo ? 0.12 : 0), w);
      W('twist', undefined, -0.16 * run * sn, w);
      W('hipTwist', undefined, 0.1 * run * sn, w);
      W('bodyY', undefined, run * (0.075 * Math.abs(sn) - 0.06), w);
    }
    if (wBack > 0) {
      const k = clamp(speed / 6, 0, 1);
      const w = wBack;
      W('bodyY', undefined, -0.12 - 0.04 * k, w);
      W('lean', undefined, 0.3, w);
      W('legFwd', 0, 0.35 + 0.38 * k * sn, w);
      W('legFwd', 1, 0.35 - 0.38 * k * sn, w);
      W('knee', 0, 0.6 + 0.6 * k * Math.max(0, -Math.sin(ph + 0.6)), w);
      W('knee', 1, 0.6 + 0.6 * k * Math.max(0, Math.sin(ph + 0.6)), w);
      W('ankle', 0, 0.15, w);
      W('ankle', 1, 0.15, w);
      W('legAbd', 0, 0.1, w);
      W('legAbd', 1, 0.1, w);
      W('armFwd', 0, 0.45 + 0.3 * k * sn, w);
      W('armFwd', 1, 0.45 - 0.3 * k * sn, w);
      W('elbow', 0, 1.2, w);
      W('elbow', 1, 1.2, w);
      W('armAbd', 0, 0.12, w);
      W('armAbd', 1, 0.12, w);
    }
    if (wSide > 0) {
      const k = clamp(speed / 5, 0, 1);
      const w = wSide;
      const spread = 0.1 + 0.22 * k * Math.abs(sn);
      W('bodyY', undefined, -0.14, w);
      W('lean', undefined, 0.32, w);
      W('legFwd', 0, 0.42, w);
      W('legFwd', 1, 0.42, w);
      W('knee', 0, 0.75, w);
      W('knee', 1, 0.75, w);
      W('legAbd', 0, spread, w);
      W('legAbd', 1, spread, w);
      W('armFwd', 0, 0.75, w);
      W('armFwd', 1, 0.75, w);
      W('elbow', 0, 1.3, w);
      W('elbow', 1, 1.3, w);
      W('armAbd', 0, 0.2, w);
      W('armAbd', 1, 0.2, w);
    }
    // lean into the cut
    T.tiltZ = clamp(-this.turnRate * speed * 0.022, -0.38, 0.38) * (wRun + 0.5 * wSide);
  }

  // Point both arms at a spot in the world (the ball): the hands come together on it.
  aimArms(T, ball, elbow) {
    const chest = this.bones.chest;
    chest.updateWorldMatrix(true, false);
    tmpA.set(ball.x, ball.y, ball.z);
    chest.worldToLocal(tmpA);
    for (let i = 0; i < 2; i++) {
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
