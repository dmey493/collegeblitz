// Procedural, skinned College Blitz player. Built once per body type and team, then
// shared by every player wearing it; each player gets its own skeleton and materials.
//
// The look is arcade Blitz, not a real athlete: giant shoulder pads, a barrel chest
// that V-tapers to a narrow waist, thick arms, and comparatively slim legs.
//
// Units are yards. Bind pose: standing straight, arms hanging, facing +z, the player's
// right side on -x. Geometry groups (materials): uniform, skin, helmet, gear, visor.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ATLAS, HELMET_PHI } from './textures.js';

export const BODY = {
  big: { w: 1.2, d: 1.15, arm: 1.14, leg: 1.12, gut: 1.2, pad: 1.1, h: 0.99, cage: true },
  mid: { w: 1.06, d: 1.03, arm: 1.04, leg: 1.0, gut: 1.0, pad: 1.03, h: 1.0, cage: false },
  small: { w: 0.97, d: 0.96, arm: 0.95, leg: 0.93, gut: 0.95, pad: 0.98, h: 1.0, cage: false },
};

export const MAT = { uniform: 0, skin: 1, helmet: 2, gear: 3, visor: 4 };
const MAT_ORDER = ['uniform', 'skin', 'helmet', 'gear', 'visor'];

export const BONES = ['root', 'pelvis', 'hipR', 'kneeR', 'hipL', 'kneeL', 'spine', 'chest', 'head', 'shR', 'elR', 'handR', 'shL', 'elL', 'handL'];
const BI = Object.fromEntries(BONES.map((n, i) => [n, i]));

// Bone rest positions, relative to the parent.
export function rigSpec(B) {
  const h = B.h;
  const spec = {
    root: [null, 0, 0, 0],
    pelvis: ['root', 0, 1.0 * h, 0],
    spine: ['pelvis', 0, 0.05 * h, 0],
    chest: ['spine', 0, 0.25 * h, 0],
    head: ['chest', 0, 0.4 * h, 0],
  };
  for (const [s, tag] of [[-1, 'R'], [1, 'L']]) {
    spec[`hip${tag}`] = ['pelvis', s * 0.112 * B.leg, -0.07 * h, 0];
    spec[`knee${tag}`] = [`hip${tag}`, 0, -0.44 * h, 0];
    spec[`sh${tag}`] = ['chest', s * 0.275 * B.w, 0.3 * h, -0.01];
    spec[`el${tag}`] = [`sh${tag}`, 0, -0.3 * h, 0];
    spec[`hand${tag}`] = [`el${tag}`, 0, -0.27 * h, 0];
  }
  return spec;
}

export function buildBones(B) {
  const spec = rigSpec(B);
  const bones = {};
  for (const name of BONES) {
    const [parent, x, y, z] = spec[name];
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    bones[name] = b;
    if (parent) bones[parent].add(b);
  }
  return { bones, list: BONES.map((n) => bones[n]) };
}

function restWorld(B) {
  const spec = rigSpec(B);
  const out = {};
  for (const name of BONES) {
    const [parent, x, y, z] = spec[name];
    const p = parent ? out[parent] : [0, 0, 0];
    out[name] = [p[0] + x, p[1] + y, p[2] + z];
  }
  return out;
}

// ------------------------------------------------------------------ helpers
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
const hex = (c) => {
  const k = new THREE.Color(c);
  return [k.r, k.g, k.b];
};
const gray = (v) => [v, v, v];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

class Piece {
  constructor(mat) {
    this.mat = mat;
    this.P = [];
    this.N = [];
    this.U = [];
    this.C = [];
    this.SI = [];
    this.SW = [];
    this.I = [];
  }

  vert(p, n, uv, col, w) {
    this.P.push(p[0], p[1], p[2]);
    this.N.push(n[0], n[1], n[2]);
    this.U.push(uv[0], uv[1]);
    this.C.push(col[0], col[1], col[2]);
    const a = w[0];
    const b = w[1] || [0, 0];
    const sum = a[1] + b[1] || 1;
    this.SI.push(a[0], b[0], 0, 0);
    this.SW.push(a[1] / sum, b[1] / sum, 0, 0);
    return this.P.length / 3 - 1;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    g.setIndex(this.I);
    return g;
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// Tube through a list of cross-section rings. Each ring: { c: [x,y,z], rx, rz, n?, mod?(angle) }.
// rx runs along U, rz along W; n > 2 squares the section off (superellipse). The callbacks get
// the vertex position, the angle around (a, radians from U toward W), a01 = a / 2π and t,
// the 0..1 distance along the tube measured through the ring centres.
function loft(piece, rings, o) {
  const seg = o.seg || 20;
  const U = o.U || [1, 0, 0];
  const W = o.W || [0, 0, 1];
  const a0 = o.a0 || 0;
  const R = rings.length;
  const dist = [0];
  for (let i = 1; i < R; i++) dist.push(dist[i - 1] + Math.hypot(...sub(rings[i].c, rings[i - 1].c)));
  const total = dist[R - 1] || 1;
  const P = [];
  for (const r of rings) {
    const row = [];
    const n = r.n || 2;
    for (let j = 0; j <= seg; j++) {
      const a = a0 + (j / seg) * Math.PI * 2;
      const m = r.mod ? r.mod(a) : 1;
      const ex = spow(Math.cos(a), 2 / n) * r.rx * m;
      const ez = spow(Math.sin(a), 2 / n) * r.rz * m;
      row.push([r.c[0] + U[0] * ex + W[0] * ez, r.c[1] + U[1] * ex + W[1] * ez, r.c[2] + U[2] * ex + W[2] * ez]);
    }
    P.push(row);
  }
  const base = piece.P.length / 3;
  for (let i = 0; i < R; i++) {
    const t = dist[i] / total;
    for (let j = 0; j <= seg; j++) {
      const jp = j === seg ? 1 : j + 1;
      const jm = j === 0 ? seg - 1 : j - 1;
      const ta = sub(P[i][jp], P[i][jm]);
      const tb = sub(P[Math.min(R - 1, i + 1)][j], P[Math.max(0, i - 1)][j]);
      let nrm = norm(cross(ta, tb));
      if (dot(nrm, sub(P[i][j], rings[i].c)) < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
      const a = a0 + (j / seg) * Math.PI * 2;
      const ctx = { p: P[i][j], a, a01: j / seg, t, i };
      piece.vert(P[i][j], nrm, o.uv ? o.uv(ctx) : [0, 0], o.color ? o.color(ctx) : [1, 1, 1], o.weight(ctx));
    }
  }
  const idx = (i, j) => base + i * (seg + 1) + j;
  const tris = [];
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < seg; j++) {
      tris.push(idx(i, j), idx(i + 1, j), idx(i, j + 1), idx(i, j + 1), idx(i + 1, j), idx(i + 1, j + 1));
    }
  }
  orient(piece, tris);
  // optional end caps, facing away from the tube
  for (const [flag, i, j] of [[o.capStart, 0, 1], [o.capEnd, R - 1, R - 2]]) {
    if (!flag) continue;
    const r = rings[i];
    const nrm = norm(sub(r.c, rings[j].c));
    const t = dist[i] / total;
    const ctx = { p: r.c, a: 0, a01: 0, t, i, cap: true };
    const center = piece.vert(r.c, nrm, o.uv ? o.uv(ctx) : [0, 0], o.color ? o.color(ctx) : [1, 1, 1], o.weight(ctx));
    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const c2 = { p: P[i][j], a: a0 + (j / seg) * Math.PI * 2, a01: j / seg, t, i, cap: true };
      ring.push(piece.vert(P[i][j], nrm, o.uv ? o.uv(c2) : [0, 0], o.color ? o.color(c2) : [1, 1, 1], o.weight(c2)));
    }
    const ct = [];
    for (let j = 0; j < seg; j++) ct.push(center, ring[j], ring[j + 1]);
    orient(piece, ct);
  }
}

// Append triangles, flipping the winding of the whole batch if it faces inward.
function orient(piece, tris) {
  let score = 0;
  for (let k = 0; k < tris.length; k += 3) {
    const [a, b, c] = [tris[k], tris[k + 1], tris[k + 2]];
    const pa = piece.P.slice(a * 3, a * 3 + 3);
    const pb = piece.P.slice(b * 3, b * 3 + 3);
    const pc = piece.P.slice(c * 3, c * 3 + 3);
    const fn = cross(sub(pb, pa), sub(pc, pa));
    const vn = piece.N.slice(a * 3, a * 3 + 3);
    score += Math.sign(dot(fn, vn));
  }
  const flip = score < 0;
  for (let k = 0; k < tris.length; k += 3) {
    if (flip) piece.I.push(tris[k], tris[k + 2], tris[k + 1]);
    else piece.I.push(tris[k], tris[k + 1], tris[k + 2]);
  }
}

// Copy a (transformed) three.js geometry into a piece.
function addGeometry(piece, geo, { weight, color, uv }) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const tuv = geo.attributes.uv;
  const base = piece.P.length / 3;
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const n = [nor.getX(i), nor.getY(i), nor.getZ(i)];
    const ctx = { p, n, uv: tuv ? [tuv.getX(i), tuv.getY(i)] : [0, 0], i };
    piece.vert(p, n, uv ? uv(ctx) : ctx.uv, color ? color(ctx) : [1, 1, 1], weight(ctx));
  }
  const index = geo.index ? Array.from(geo.index.array) : [...Array(pos.count).keys()];
  for (let k = 0; k < index.length; k += 3) piece.I.push(base + index[k], base + index[k + 1], base + index[k + 2]);
}

function ellipsoid(piece, c, r, o, segW = 14, segH = 10) {
  const g = new THREE.SphereGeometry(1, segW, segH);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...c), o.quat || new THREE.Quaternion(), new THREE.Vector3(...r));
  g.applyMatrix4(m);
  addGeometry(piece, g, o);
  g.dispose();
}

function tube(piece, pts, radius, o) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, o.segs || 14, radius, 5, false);
  addGeometry(piece, g, o);
  g.dispose();
}

const one = (bone) => () => [[BI[bone], 1]];
const blend = (b0, b1, w) => [[BI[b0], 1 - w], [BI[b1], w]];
const inAtlas = (R, u, v) => [R.u0 + u * (R.u1 - R.u0), R.v0 + v * (R.v1 - R.v0)];

// ------------------------------------------------------------------ the body
export function buildPlayerGeometry(B, team) {
  const C = team.colors;
  const h = B.h;
  const J = restWorld(B);
  const pieces = Object.fromEntries(MAT_ORDER.map((k) => [k, new Piece(k)]));
  const { uniform, skin, helmet, gear, visor } = pieces;
  const SEG = 22;

  // ---- torso (jersey): barrel chest, V-taper to the waist
  const TOP = 1.758 * h;
  const BOT = 0.985 * h;
  const torso = [
    [0.985, 0.205, 0.15, 2.3], [1.06, 0.212, 0.154, 2.3], [1.15, 0.232, 0.166, 2.4], [1.25, 0.27, 0.188, 2.6],
    [1.36, 0.308, 0.206, 2.8], [1.46, 0.334, 0.218, 3.0], [1.55, 0.346, 0.22, 3.2], [1.625, 0.336, 0.212, 3.4],
    [1.69, 0.292, 0.19, 3.2], [1.735, 0.2, 0.142, 2.6], [1.758, 0.112, 0.092, 2.2],
  ].map(([y, rx, rz, n]) => {
    const upper = smooth(1.1, 1.45, y);
    const wx = lerp(1 + (B.w - 1) * 0.35, B.w, upper);
    const wz = lerp(1 + (B.d - 1) * 0.35, B.d, upper);
    const belly = (B.gut - 1) * (1 - smooth(1.05, 1.32, y));
    const pecs = 0.07 * smooth(1.26, 1.36, y) * (1 - smooth(1.48, 1.58, y));
    const back = 0.045 * smooth(1.36, 1.46, y) * (1 - smooth(1.58, 1.66, y));
    return {
      c: [0, y * h, 0], rx: rx * wx * (1 + belly * 0.4), rz: rz * wz, n,
      mod: (a) => 1 + (belly + pecs * Math.max(0, Math.sin(a)) ** 2) * Math.max(0, Math.sin(a)) + back * Math.max(0, -Math.sin(a)) ** 2,
    };
  });
  loft(uniform, torso, {
    seg: 28,
    uv: ({ a01, t }) => inAtlas(ATLAS.torso, 1 - a01, t),
    color: ({ p, a }) => {
      const side = Math.abs(Math.cos(a)) ** 4;
      let ao = 1 - 0.26 * side * smooth(1.2, 1.4, p[1]) * (1 - smooth(1.6, 1.7, p[1]));
      ao *= lerp(0.78, 1, smooth(BOT, 1.12 * h, p[1]));
      ao *= lerp(1, 0.8, smooth(1.69 * h, TOP, p[1]));
      return gray(ao);
    },
    weight: ({ p }) => {
      const y = p[1];
      if (y < 1.12 * h) return blend('pelvis', 'spine', smooth(1.03 * h, 1.12 * h, y));
      return blend('spine', 'chest', smooth(1.22 * h, 1.36 * h, y));
    },
  });

  // ---- shoulder pads: huge domed caps over each shoulder, under the jersey
  for (const s of [-1, 1]) {
    const c = [s * 0.285 * B.w, 1.64 * h, -0.006];
    const r = [0.205 * B.pad, 0.122 * B.pad, 0.232 * B.pad * B.d];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -s * 0.34));
    const g = new THREE.SphereGeometry(1, 22, 14);
    // squash the underside so the cap reads as a pad with an edge, not a ball
    const gp = g.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const y = gp.getY(i);
      if (y < 0) gp.setY(i, y * 0.62);
      else gp.setY(i, Math.pow(y, 0.85));
    }
    g.computeVertexNormals();
    const unit = g.attributes.position.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...c), q, new THREE.Vector3(...r)));
    addGeometry(uniform, g, {
      weight: one('chest'),
      // flat projection from the outside so the shoulder number reads from the sideline
      uv: ({ i }) => inAtlas(ATLAS.cap, 0.5 - 0.5 * s * unit.getZ(i), 0.5 + 0.5 * unit.getY(i)),
      color: ({ i }) => gray(lerp(0.62, 1, smooth(-0.7, 0.1, unit.getY(i)))),
    });
    g.dispose();
  }

  // ---- neck
  loft(skin, [
    { c: [0, 1.66 * h, -0.005], rx: 0.09, rz: 0.084 },
    { c: [0, 1.75 * h, 0.0], rx: 0.086, rz: 0.082 },
    { c: [0, 1.84 * h, 0.01], rx: 0.078, rz: 0.076 },
  ], {
    seg: 14,
    color: ({ p }) => gray(lerp(0.72, 0.55, smooth(1.7 * h, 1.84 * h, p[1]))),
    weight: ({ p }) => blend('chest', 'head', smooth(1.7 * h, 1.8 * h, p[1])),
  });

  // ---- head: face, helmet, facemask
  const H = [0, J.head[1] + 0.205 * h, 0];
  const at = (x, y, z) => [H[0] + x, H[1] + y, H[2] + z];
  const head = one('head');
  // the head fills the helmet; the brow and cage keep it mostly in shadow
  ellipsoid(skin, at(0, -0.04, 0.028), [0.112, 0.128, 0.122], { weight: head, color: ({ n }) => gray(0.74 + 0.2 * Math.max(0, n[2])) }, 16, 12);
  ellipsoid(skin, at(0, -0.045, 0.146), [0.017, 0.026, 0.022], { weight: head, color: () => gray(0.92) }, 8, 6);
  for (const s of [-1, 1]) {
    ellipsoid(gear, at(s * 0.041, -0.012, 0.139), [0.024, 0.012, 0.01], { weight: head, color: () => hex('#1b130f') }, 8, 6);
  }
  buildHelmet(pieces, at, head);
  buildFacemask(gear, at, head, hex(C.mask), B.cage);
  // tinted visor (hidden unless the player wears one)
  {
    const g = new THREE.CylinderGeometry(0.206, 0.206, 0.085, 18, 1, true, -0.78, 1.56);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(...at(0, -0.02, 0)));
    addGeometry(visor, g, { weight: head });
    g.dispose();
  }

  // ---- arms: jersey sleeve over a big bicep, forearm, wristband, glove
  for (const [s, tag] of [[-1, 'R'], [1, 'L']]) {
    const S = J[`sh${tag}`];
    const sh = `sh${tag}`;
    const el = `el${tag}`;
    const hand = `hand${tag}`;
    const inner = (a) => Math.max(0, -s * Math.cos(a)) ** 2;
    const ring = (dy, r, extra = {}) => ({ c: [S[0], S[1] + dy * h, S[2]], rx: r * B.arm * 1.16, rz: r * B.arm * 1.1, ...extra });
    loft(uniform, [ring(0.05, 0.112), ring(-0.02, 0.119), ring(-0.1, 0.115), ring(-0.165, 0.109)], {
      seg: SEG,
      uv: ({ a01, t }) => inAtlas(ATLAS.sleeve, a01, 1 - t),
      color: ({ a }) => gray(1 - 0.22 * inner(a)),
      weight: one(sh),
    });
    const bicep = (a) => 1 + 0.08 * Math.max(0, Math.sin(a)) ** 2;
    const forearm = (a) => 1 + 0.06 * Math.max(0, Math.cos(a) * s) ** 2;
    loft(skin, [
      ring(-0.12, 0.1), ring(-0.175, 0.098, { mod: bicep }), ring(-0.235, 0.087, { mod: bicep }), ring(-0.285, 0.072),
      ring(-0.32, 0.075), ring(-0.36, 0.078, { mod: forearm }), ring(-0.43, 0.064), ring(-0.5, 0.05), ring(-0.535, 0.047),
    ], {
      seg: SEG,
      color: ({ a, p }) => {
        const pit = Math.max(0, Math.sin(a)) * smooth(0.06, 0, Math.abs(p[1] - (S[1] - 0.29 * h)));
        return gray((1 - 0.2 * inner(a)) * (1 - 0.35 * pit));
      },
      weight: ({ p }) => blend(sh, el, smooth(S[1] - 0.255 * h, S[1] - 0.335 * h, p[1])),
    });
    loft(gear, [ring(-0.47, 0.055), ring(-0.54, 0.052)], { seg: 14, color: () => hex('#f4f4f2'), weight: one(el) });
    const glove = hex(C.gloves);
    const handC = [S[0] + s * 0.004, S[1] - 0.605 * h, S[2] + 0.008];
    ellipsoid(gear, handC, [0.043 * B.arm, 0.064 * B.arm, 0.054 * B.arm], {
      weight: one(hand),
      color: ({ n }) => mul(glove, n[0] * -s > 0.3 ? 0.82 : 1),
    }, 12, 10);
    ellipsoid(gear, [handC[0] - s * 0.024, handC[1] + 0.022, handC[2] + 0.045], [0.02, 0.036, 0.02], { weight: one(hand), color: () => glove }, 8, 6);
  }

  // ---- pants: hips and belt, thighs with knee pads
  const legW = 1 + (B.leg - 1) * 0.8;
  loft(uniform, [
    [1.07, 0.218, 0.16], [1.02, 0.222, 0.165], [0.95, 0.226, 0.176], [0.88, 0.214, 0.166], [0.835, 0.165, 0.122], [0.81, 0.085, 0.062],
  ].map(([y, rx, rz], k) => ({
    c: [0, y * h, k > 3 ? -0.01 : 0], rx: rx * legW * (k < 2 ? lerp(1, B.gut, 0.35) : 1), rz: rz * legW, n: 2.3,
    mod: (a) => 1 + (y < 1.0 ? 0.1 * Math.max(0, -Math.sin(a)) ** 2 : 0) + (k < 2 ? (B.gut - 1) * 0.5 * Math.max(0, Math.sin(a)) : 0),
  })), {
    seg: 26,
    uv: ({ a01, t }) => inAtlas(ATLAS.pelvis, 1 - a01, 1 - t),
    color: ({ p }) => gray(lerp(0.62, 1, smooth(0.8 * h, 0.93 * h, p[1])) * (p[1] > 1.04 * h ? 0.92 : 1)),
    weight: one('pelvis'),
    capEnd: true,
  });
  for (const [s, tag] of [[-1, 'R'], [1, 'L']]) {
    const hip = `hip${tag}`;
    const knee = `knee${tag}`;
    const x0 = J[hip][0];
    const inner = (a) => Math.max(0, -s * Math.cos(a)) ** 2;
    const quad = (a) => 1 + 0.08 * Math.max(0, Math.sin(a)) ** 2;
    const pad = (a) => 1 + 0.18 * Math.max(0, Math.sin(a)) ** 3;
    const ring = (y, r, mod) => ({ c: [x0 - s * 0.01 * smooth(0.9, 0.5, y), y * h, 0], rx: r * B.leg, rz: r * B.leg * 0.98, mod });
    const legWeight = ({ p }) => {
      const y = p[1];
      if (y > 0.8 * h) return blend(hip, 'pelvis', 0.5 * smooth(0.86 * h, 0.98 * h, y));
      return blend(hip, knee, smooth(0.54 * h, 0.44 * h, y));
    };
    loft(uniform, [
      ring(0.99, 0.116), ring(0.91, 0.12), ring(0.8, 0.118, quad), ring(0.68, 0.104, quad), ring(0.575, 0.088),
      ring(0.52, 0.084), ring(0.48, 0.088, pad), ring(0.43, 0.083),
    ], {
      seg: SEG,
      a0: s < 0 ? Math.PI : 0, // seam (and the stripe) on the outside of each leg
      uv: ({ a01, t }) => inAtlas(ATLAS.thigh, a01, 1 - t),
      color: ({ a, p }) => gray((1 - 0.2 * inner(a)) * lerp(0.75, 1, Math.min(1, smooth(0.98 * h, 0.86 * h, p[1]) + (1 - inner(a)) * 0.6))),
      weight: legWeight,
    });
    const calf = (a) => 1 + 0.17 * Math.max(0, -Math.sin(a)) ** 2;
    const sock = (y, r, mod) => ({ c: [x0 - s * 0.01, y * h, 0], rx: r * B.leg * 0.96, rz: r * B.leg * 0.96, mod });
    loft(uniform, [sock(0.5, 0.078), sock(0.4, 0.074, calf), sock(0.31, 0.068, calf), sock(0.21, 0.054), sock(0.13, 0.045), sock(0.085, 0.047)], {
      seg: 18,
      uv: ({ a01, t }) => inAtlas(ATLAS.sock, a01, 1 - t),
      color: ({ a }) => gray(1 - 0.15 * inner(a)),
      weight: legWeight,
    });
    // cleats with taped ankles
    const cleat = hex(C.cleats);
    const shoe = [
      [-0.085, 0.03, 0.035, 0.05], [-0.065, 0.046, 0.052, 0.055], [-0.02, 0.052, 0.062, 0.065], [0.04, 0.054, 0.05, 0.05],
      [0.11, 0.052, 0.036, 0.036], [0.17, 0.042, 0.026, 0.027], [0.2, 0.025, 0.018, 0.022],
    ].map(([z, rx, ry, cy]) => ({ c: [x0 - s * 0.012, cy, z], rx: rx * B.leg, rz: ry, n: 2.6 }));
    loft(gear, shoe, {
      seg: 16,
      U: [1, 0, 0],
      W: [0, 1, 0],
      color: ({ p }) => {
        if (p[1] < 0.013) return hex('#232326');
        if (p[1] > 0.05 && p[2] < 0.03) return hex('#f3f3f1');
        return cleat;
      },
      weight: one(knee),
      capStart: true,
      capEnd: true,
    });
  }

  const geos = MAT_ORDER.map((k) => pieces[k].geometry());
  const merged = mergeGeometries(geos, true);
  for (const g of geos) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

// Helmet shell: an egg-shaped dome that comes down over the ears and jaw, open in front.
function buildHelmet(pieces, at, weight) {
  const A = 0.172;
  const Bv = 0.168;
  const Cz = 0.19;
  const off = [0, 0.012, -0.012];
  const NT = 44;
  const NP = 16;
  const phiMax = (th) => {
    const a = Math.abs(th);
    const FRONT = 1.36;
    const SIDE = 2.2;
    const BACK = 2.02;
    if (a < 0.44) return FRONT;
    if (a < 0.86) return lerp(FRONT, SIDE, smooth(0.44, 0.86, a));
    if (a < 1.8) return SIDE;
    return lerp(SIDE, BACK, smooth(1.8, Math.PI, a));
  };
  const shell = (piece, k, inward, colorFn, uvOn) => {
    const base = piece.P.length / 3;
    for (let i = 0; i <= NT; i++) {
      const th = -Math.PI + (i / NT) * Math.PI * 2;
      const pm = phiMax(th);
      for (let j = 0; j <= NP; j++) {
        const ph = (j / NP) * pm;
        const x = A * k * Math.sin(ph) * Math.sin(th);
        const y = Bv * k * Math.cos(ph);
        const z = Cz * k * Math.sin(ph) * Math.cos(th);
        let n = norm([x / (A * A), y / (Bv * Bv), z / (Cz * Cz)]);
        if (inward) n = [-n[0], -n[1], -n[2]];
        const p = at(x + off[0], y + off[1], z + off[2]);
        piece.vert(p, n, uvOn ? [i / NT, 1 - ph / HELMET_PHI] : [0, 0], colorFn(j / NP, th), weight());
      }
    }
    const idx = (i, j) => base + i * (NP + 1) + j;
    const tris = [];
    for (let i = 0; i < NT; i++) {
      for (let j = 0; j < NP; j++) tris.push(idx(i, j), idx(i + 1, j), idx(i, j + 1), idx(i, j + 1), idx(i + 1, j), idx(i + 1, j + 1));
    }
    orient(piece, tris);
    return idx;
  };
  // the shell darkens a touch toward its lower edge (ambient occlusion)
  const outer = shell(pieces.helmet, 1, false, (v) => gray(lerp(1, 0.82, smooth(0.75, 1, v))), true);
  const pad = hex('#1b1c20');
  const inner = shell(pieces.gear, 0.93, true, () => pad, false);
  // rim joining the two shells
  const g = pieces.gear;
  const rim = [];
  for (let i = 0; i <= NT; i++) {
    const po = g.P.length / 3;
    const op = pieces.helmet.P.slice(outer(i, NP) * 3, outer(i, NP) * 3 + 3);
    const ip = g.P.slice(inner(i, NP) * 3, inner(i, NP) * 3 + 3);
    const n = norm(sub(op, at(0, 0.3, 0)));
    g.vert(op, n, [0, 0], mul(pad, 1.4), weight());
    g.vert(ip, n, [0, 0], pad, weight());
    rim.push(po);
  }
  const tris = [];
  for (let i = 0; i < NT; i++) tris.push(rim[i], rim[i + 1], rim[i] + 1, rim[i] + 1, rim[i + 1], rim[i + 1] + 1);
  orient(g, tris);
  // ear holes
  for (const s of [-1, 1]) ellipsoid(g, at(s * 0.168, -0.035, -0.005), [0.012, 0.022, 0.022], { weight, color: () => pad }, 8, 6);
}

function buildFacemask(gear, at, weight, color, cage) {
  const r = 0.0088;
  const o = { weight, color: () => color };
  const bar = (y, zc, xs, zs, drop = 0) => [
    [-xs, y + drop, zs], [-xs * 0.88, y, zc - 0.07], [-xs * 0.45, y - 0.004, zc - 0.012], [0, y - 0.005, zc],
    [xs * 0.45, y - 0.004, zc - 0.012], [xs * 0.88, y, zc - 0.07], [xs, y + drop, zs],
  ].map(([x, yy, z]) => at(x, yy, z));
  tube(gear, bar(-0.03, 0.234, 0.168, 0.075, 0.01), r, { ...o, segs: 18 });
  tube(gear, bar(-0.095, 0.226, 0.158, 0.06), r, { ...o, segs: 18 });
  if (cage) {
    tube(gear, bar(-0.152, 0.205, 0.12, 0.07, 0.01), r, { ...o, segs: 16 });
    for (const x of [-0.05, 0.05]) tube(gear, [at(x, -0.025, 0.229), at(x * 1.02, -0.09, 0.224), at(x * 0.95, -0.155, 0.2)], r, { ...o, segs: 6 });
  }
  tube(gear, [at(0, -0.03, 0.234), at(0, -0.065, 0.233), at(0, cage ? -0.157 : -0.1, cage ? 0.205 : 0.226)], r, { ...o, segs: 6 });
  for (const s of [-1, 1]) {
    // side struts up to the brow and down to the jaw
    tube(gear, [at(s * 0.168, -0.02, 0.075), at(s * 0.165, 0.01, 0.1), at(s * 0.15, 0.035, 0.125)], r, { ...o, segs: 5 });
    tube(gear, [at(s * 0.158, -0.095, 0.06), at(s * 0.15, -0.12, 0.045), at(s * 0.14, -0.14, 0.02)], r, { ...o, segs: 5 });
  }
}
