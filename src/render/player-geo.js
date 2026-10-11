// Procedural, skinned College Blitz player, built to the proportions of the early-2000s
// arcade football look: real athletic proportions (long legs, a small helmet sunk between
// the pads) with everything above the belt pumped up: one wide, flat-topped shoulder-pad
// yoke with the sleeves hanging from it, a deep chest, long arms with huge forearms,
// gloves with fingers, tight pants over thigh and knee pads, ribbed socks over taped
// ankles and high-top cleats.
//
// Built once per body type and team and shared; every player gets its own skeleton and
// materials. Units are yards. Bind pose: standing, arms hanging, facing +z, the player's
// right side on -x. Geometry groups (materials): uniform, skin, helmet, gear, visor.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ATLAS, SKIN_ATLAS, HELMET_PHI } from './textures.js';

// w: chest and pads, d: depth, arm/leg: limb thickness, gut: belly, pad: pad width, h: height
export const BODY = {
  big: { w: 1.13, d: 1.12, arm: 1.14, leg: 1.12, gut: 1.18, pad: 1.07, h: 0.985, cage: true },
  mid: { w: 1.03, d: 1.03, arm: 1.04, leg: 1.03, gut: 1.0, pad: 1.02, h: 1.0, cage: false },
  small: { w: 0.97, d: 0.96, arm: 0.95, leg: 0.95, gut: 0.95, pad: 0.98, h: 1.005, cage: false },
};

export const MAT = { uniform: 0, skin: 1, helmet: 2, gear: 3, visor: 4 };
const MAT_ORDER = ['uniform', 'skin', 'helmet', 'gear', 'visor'];

export const BONES = [
  'root', 'pelvis', 'hipR', 'kneeR', 'footR', 'hipL', 'kneeL', 'footL',
  'spine', 'chest', 'head', 'shR', 'elR', 'handR', 'shL', 'elL', 'handL',
];
const BI = Object.fromEntries(BONES.map((n, i) => [n, i]));

// Bone rest positions, relative to the parent.
export function rigSpec(B) {
  const h = B.h;
  const spec = {
    root: [null, 0, 0, 0],
    pelvis: ['root', 0, 1.06 * h, 0],
    spine: ['pelvis', 0, 0.1 * h, 0],
    chest: ['spine', 0, 0.32 * h, 0],
    head: ['chest', 0, 0.38 * h, 0],
  };
  for (const [s, tag] of [[-1, 'R'], [1, 'L']]) {
    spec[`hip${tag}`] = ['pelvis', s * 0.112 * B.leg, -0.02 * h, 0];
    spec[`knee${tag}`] = [`hip${tag}`, 0, -0.47 * h, 0];
    spec[`foot${tag}`] = [`knee${tag}`, 0, -0.475 * h, 0];
    spec[`sh${tag}`] = ['chest', s * 0.31 * B.w, 0.24 * h, -0.01];
    spec[`el${tag}`] = [`sh${tag}`, 0, -0.33 * h, 0];
    spec[`hand${tag}`] = [`el${tag}`, 0, -0.29 * h, 0];
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
// 1 inside [a, b], easing to 0 over `soft` on either side
const window1 = (x, a, b, soft) => smooth(a - soft, a, x) * (1 - smooth(b, b + soft, x));
// bump around an angle: 1 at `at`, 0 beyond `width` (radians), wraps around the circle
const around = (a, at, width) => {
  let d = Math.abs(a - at) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d >= width ? 0 : 0.5 + 0.5 * Math.cos((d / width) * Math.PI);
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

// Tube through a list of cross-section rings: { c: [x,y,z], rx, rz, n?, mod?(a, ring) }.
// rx runs along U, rz along W; n > 2 squares the section off (superellipse). `dir: -1`
// runs the angle the other way round (mirrored limbs share one texture layout). The
// callbacks get { p, a, a01, t } where a01 = 0..1 around the ring and t = 0..1 along it.
function loft(piece, rings, o) {
  const seg = o.seg || 20;
  const U = o.U || [1, 0, 0];
  const W = o.W || [0, 0, 1];
  const a0 = o.a0 || 0;
  const dir = o.dir || 1;
  const R = rings.length;
  const dist = [0];
  for (let i = 1; i < R; i++) dist.push(dist[i - 1] + Math.hypot(...sub(rings[i].c, rings[i - 1].c)));
  const total = dist[R - 1] || 1;
  const angle = (j) => a0 + dir * (j / seg) * Math.PI * 2;
  const P = [];
  for (const r of rings) {
    const row = [];
    const n = r.n || 2;
    for (let j = 0; j <= seg; j++) {
      const a = angle(j);
      const m = r.mod ? r.mod(a, r) : 1;
      const ex = spow(Math.cos(a), 2 / n) * r.rx * m;
      const ez = spow(Math.sin(a), 2 / n) * r.rz * m;
      row.push([r.c[0] + U[0] * ex + W[0] * ez, r.c[1] + U[1] * ex + W[1] * ez, r.c[2] + U[2] * ex + W[2] * ez]);
    }
    P.push(row);
  }
  // arcV: t follows the surface along each meridian instead of the ring centers, so a
  // shape that flares (the pads) doesn't squash its texture
  const arc = [];
  if (o.arcV) {
    for (let j = 0; j <= seg; j++) {
      const col = [0];
      for (let i = 1; i < R; i++) col.push(col[i - 1] + Math.hypot(...sub(P[i][j], P[i - 1][j])));
      arc.push(col);
    }
  }
  const base = piece.P.length / 3;
  for (let i = 0; i < R; i++) {
    for (let j = 0; j <= seg; j++) {
      const t = o.arcV ? arc[j][i] / (arc[j][R - 1] || 1) : dist[i] / total;
      const jp = j === seg ? 1 : j + 1;
      const jm = j === 0 ? seg - 1 : j - 1;
      const ta = sub(P[i][jp], P[i][jm]);
      const tb = sub(P[Math.min(R - 1, i + 1)][j], P[Math.max(0, i - 1)][j]);
      let nrm = norm(cross(ta, tb));
      if (dot(nrm, sub(P[i][j], rings[i].c)) < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
      const ctx = { p: P[i][j], a: angle(j), a01: j / seg, t, i, n: nrm };
      piece.vert(P[i][j], nrm, o.uv ? o.uv(ctx) : [0, 0], o.color ? o.color(ctx) : [1, 1, 1], o.weight(ctx));
    }
  }
  const idx = (i, j) => base + i * (seg + 1) + j;
  const tris = [];
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < seg; j++) tris.push(idx(i, j), idx(i + 1, j), idx(i, j + 1), idx(i, j + 1), idx(i + 1, j), idx(i + 1, j + 1));
  }
  orient(piece, tris);
  // optional end caps, facing away from the tube
  for (const [flag, i, j] of [[o.capStart, 0, 1], [o.capEnd, R - 1, R - 2]]) {
    if (!flag) continue;
    const r = rings[i];
    const nrm = norm(sub(r.c, rings[j].c));
    const t = dist[i] / total;
    const cctx = { p: r.c, a: 0, a01: 0, t, i, cap: true, n: nrm };
    const center = piece.vert(r.c, nrm, o.uv ? o.uv(cctx) : [0, 0], o.color ? o.color(cctx) : [1, 1, 1], o.weight(cctx));
    const ring = [];
    for (let k = 0; k <= seg; k++) {
      const c2 = { p: P[i][k], a: angle(k), a01: k / seg, t, i, cap: true, n: nrm };
      ring.push(piece.vert(P[i][k], nrm, o.uv ? o.uv(c2) : [0, 0], o.color ? o.color(c2) : [1, 1, 1], o.weight(c2)));
    }
    const ct = [];
    for (let k = 0; k < seg; k++) ct.push(center, ring[k], ring[k + 1]);
    orient(piece, ct);
  }
}

// Append triangles, flipping the winding of the whole batch if it faces inward.
function orient(piece, tris) {
  let score = 0;
  for (let k = 0; k < tris.length; k += 3) {
    const [a, b, c] = [tris[k], tris[k + 1], tris[k + 2]];
    const pa = piece.P.slice(a * 3, a * 3 + 3);
    const fn = cross(sub(piece.P.slice(b * 3, b * 3 + 3), pa), sub(piece.P.slice(c * 3, c * 3 + 3), pa));
    score += Math.sign(dot(fn, piece.N.slice(a * 3, a * 3 + 3)));
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
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...c), o.quat || new THREE.Quaternion(), new THREE.Vector3(...r)));
  addGeometry(piece, g, o);
  g.dispose();
}

// Capsule from a to b (radius r), e.g. a finger segment.
function capsule(piece, a, b, r, o, rad = 6) {
  const d = sub(b, a);
  const l = Math.hypot(...d);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.0001, l), 3, rad);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...d).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
  addGeometry(piece, g, o);
  g.dispose();
}

function tube(piece, pts, radius, o) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, o.segs || 14, radius, 6, false);
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
  const { uniform, skin, gear } = pieces;
  const Y = (y) => y * h;

  // ---- torso and shoulder pads in one piece: a deep chest that tapers into the belt and
  //      flares at the top into a wide, flat-topped pad with rounded caps (the jersey
  //      stretched over the pads), closing at the collar
  const torso = [
    [1.12, 0.205, 0.154, 2.6], [1.2, 0.21, 0.16, 2.6], [1.3, 0.232, 0.174, 2.8], [1.41, 0.258, 0.19, 3.0],
    [1.52, 0.278, 0.204, 3.2], [1.6, 0.292, 0.211, 3.4], [1.628, 0.298, 0.222, 3.5], [1.645, 0.302, 0.214, 3.5],
    [1.68, 0.318, 0.216, 3.7], [1.712, 0.352, 0.216, 4.0], [1.724, 0.39, 0.215, 4.4], [1.75, 0.405, 0.215, 4.4], [1.795, 0.422, 0.21, 4.6], [1.835, 0.43, 0.2, 4.4], [1.868, 0.413, 0.183, 3.8],
    [1.893, 0.36, 0.158, 3.2], [1.91, 0.262, 0.128, 2.6], [1.921, 0.15, 0.1, 2.2], [1.927, 0.108, 0.088, 2.0],
  ].map(([y, rx, rz, n]) => {
    const upper = smooth(1.25, 1.55, y);
    const pads = smooth(1.62, 1.72, y);
    const belly = (B.gut - 1) * (1 - smooth(1.2, 1.45, y));
    const pecs = 0.06 * window1(y, 1.5, 1.64, 0.05);
    const lats = 0.05 * window1(y, 1.45, 1.66, 0.08);
    return {
      c: [0, Y(y), 0],
      rx: rx * lerp(1 + (B.w - 1) * 0.4, B.w, upper) * lerp(1, B.pad, pads) * (1 + belly * 0.35),
      rz: rz * lerp(1 + (B.d - 1) * 0.4, B.d, upper),
      n,
      mod: (a) => 1 + (belly + pecs) * Math.max(0, Math.sin(a)) ** 2 + lats * Math.max(0, Math.cos(a)) ** 4 + lats * Math.max(0, -Math.cos(a)) ** 4,
    };
  });
  const TB = Y(1.12);
  loft(uniform, torso, {
    seg: 40,
    arcV: true,
    uv: ({ a01, t }) => inAtlas(ATLAS.torso, 1 - a01, t),
    color: ({ p, a, n }) => {
      const side = Math.abs(Math.cos(a)) ** 6;
      // shade the armpits and the underside of the pad caps
      let ao = 1 - 0.25 * side * window1(p[1], Y(1.35), Y(1.7), Y(0.08));
      ao *= 1 - 0.3 * Math.max(0, -n[1]) * smooth(Y(1.62), Y(1.72), p[1]);
      // the lip of the shoulder cap throws a hard shadow line over the sleeve
      ao *= 1 - 0.35 * Math.max(0, -n[1]) * window1(p[1], Y(1.7), Y(1.725), Y(0.008));
      ao *= lerp(0.75, 1, smooth(TB, Y(1.26), p[1]));
      return gray(ao);
    },
    weight: ({ p }) => {
      const y = p[1];
      if (y < Y(1.3)) return blend('pelvis', 'spine', smooth(Y(1.16), Y(1.3), y));
      return blend('spine', 'chest', smooth(Y(1.34), Y(1.5), y));
    },
  });

  // ---- neck (mostly hidden between the pads and the helmet)
  loft(skin, [
    { c: [0, Y(1.82), -0.008], rx: 0.074, rz: 0.07 },
    { c: [0, Y(1.9), 0.0], rx: 0.072, rz: 0.069 },
    { c: [0, Y(1.98), 0.01], rx: 0.066, rz: 0.064 },
  ], {
    seg: 14,
    uv: ({ a01, t }) => inAtlas(SKIN_ATLAS.plain, a01, t),
    color: () => gray(0.55),
    weight: ({ p }) => blend('chest', 'head', smooth(Y(1.85), Y(1.93), p[1])),
  });

  // ---- head: face, helmet, facemask
  const H = [0, J.head[1] + 0.14 * h, 0];
  const at = (x, y, z) => [H[0] + x, H[1] + y, H[2] + z];
  const head = one('head');
  buildFace(skin, at, head);
  buildHelmet(pieces, at, head);
  buildFacemask(gear, at, head, hex(C.mask), B.cage);
  {
    const g = new THREE.CylinderGeometry(0.182, 0.182, 0.07, 18, 1, true, -0.74, 1.48);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(...at(0, -0.008, 0)));
    addGeometry(pieces.visor, g, { weight: head });
    g.dispose();
  }

  // ---- arms
  for (const [s, tag] of [[-1, 'R'], [1, 'L']]) buildArm(pieces, B, J, s, tag, h, hex(C.gloves));

  // ---- pants: belt line, seat and crotch; thighs over thigh and knee pads
  const legW = 1 + (B.leg - 1) * 0.8;
  // glutes round out behind and fold into the hamstrings
  loft(uniform, [
    [1.235, 0.21, 0.156], [1.18, 0.214, 0.16], [1.11, 0.222, 0.172], [1.05, 0.22, 0.172], [1.0, 0.192, 0.15], [0.97, 0.13, 0.1], [0.955, 0.06, 0.05],
  ].map(([y, rx, rz], k) => ({
    c: [0, Y(y), k > 3 ? -0.01 : 0], rx: rx * legW * (k < 2 ? lerp(1, B.gut, 0.3) : 1), rz: rz * legW, n: 2.4,
    mod: (a) => {
      const back = Math.max(0, -Math.sin(a)) ** 2;
      // two cheeks either side of the seam, not one shelf
      const cheeks = 0.5 + 0.5 * Math.abs(Math.cos(a)) ** 0.6;
      const glute = 0.2 * window1(y, 0.99, 1.13, 0.05) * back * cheeks;
      return 1 + glute + (k < 2 ? (B.gut - 1) * 0.5 * Math.max(0, Math.sin(a)) : 0);
    },
  })), {
    seg: 28,
    uv: ({ a01, t }) => inAtlas(ATLAS.pelvis, 1 - a01, 1 - t),
    color: ({ p }) => gray(lerp(0.6, 1, smooth(Y(0.97), Y(1.08), p[1]))),
    weight: one('pelvis'),
    capEnd: true,
  });
  for (const [s, tag] of [[-1, 'R'], [1, 'L']]) buildLeg(pieces, B, J, s, tag, h);

  const geos = MAT_ORDER.map((k) => pieces[k].geometry());
  const merged = mergeGeometries(geos, true);
  for (const g of geos) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

// Arm: jersey sleeve hanging from the pad, a big biceps/triceps, huge forearm, wristband,
// glove with fingers. Mirrored limbs run their angles opposite ways so both share one
// texture layout: u = 0 outside, 0.25 front, 0.5 inside, 0.75 back.
function buildArm(pieces, B, J, s, tag, h, glove) {
  const { uniform, skin, gear } = pieces;
  const S = J[`sh${tag}`];
  const sh = `sh${tag}`;
  const el = `el${tag}`;
  const hand = `hand${tag}`;
  const a0 = s > 0 ? 0 : Math.PI;
  const dir = s > 0 ? 1 : -1;
  const at = (dy, r, extra = {}) => ({ c: [S[0], S[1] + dy * h, S[2]], rx: r * B.arm, rz: r * B.arm * 0.94, ...extra });
  // local angle 0 = outside, PI/2 = front (for both arms)
  const local = (a) => (dir > 0 ? a : Math.PI - a);
  const bump = (loc, at0, width, amt) => amt * around(loc, at0, width);
  const inside = (a) => around(local(a), Math.PI, 1.4);

  // sleeve
  loft(uniform, [at(0.05, 0.118), at(-0.04, 0.117), at(-0.11, 0.11), at(-0.165, 0.101), at(-0.19, 0.097), at(-0.215, 0.096)], {
    seg: 24, a0, dir,
    uv: ({ a01, t }) => inAtlas(ATLAS.sleeve, a01, 1 - t),
    color: ({ a, p }) => gray((1 - 0.22 * inside(a)) * lerp(0.75, 1, smooth(S[1] + 0.04, S[1] - 0.04, p[1]))),
    weight: one(sh),
  });
  // upper arm and forearm with the muscle groups that sell "pumped up"
  const ringsU = [
    [-0.13, 0.092], [-0.18, 0.09, 0.2, 0.12], [-0.23, 0.087, 0.24, 0.14], [-0.27, 0.08, 0.14, 0.09], [-0.305, 0.073], [-0.33, 0.07],
    [-0.35, 0.072, 0, 0, 0.05], [-0.38, 0.083, 0, 0, 0.17], [-0.42, 0.086, 0, 0, 0.13], [-0.47, 0.078, 0, 0, 0.06], [-0.53, 0.064], [-0.58, 0.052], [-0.615, 0.047],
  ].map(([dy, r, bi = 0, tri = 0, fore = 0]) => at(dy, r, {
    mod: (a) => {
      const l = local(a);
      return 1 + bump(l, Math.PI / 2, 1.1, bi) + bump(l, (Math.PI * 3) / 2, 1.2, tri) + bump(l, 0.55, 1.0, fore) + bump(l, Math.PI * 0.85, 0.8, fore * 0.5);
    },
  }));
  // upper arm and forearm are separate tubes (sharing the elbow ring) so neither crosses
  // between texture regions
  const armOpts = (region, top, bottom) => ({
    seg: 24, a0, dir,
    uv: ({ a01, p }) => inAtlas(region, a01, smooth(bottom, top, (p[1] - S[1]) / h)),
    color: ({ a, p }) => {
      const dy = (p[1] - S[1]) / h;
      const pit = around(local(a), Math.PI / 2, 1.0) * window1(dy, -0.36, -0.3, 0.03);
      return gray((1 - 0.18 * inside(a)) * (1 - 0.4 * pit) * lerp(0.75, 1, smooth(-0.14, -0.2, dy)));
    },
    weight: ({ p }) => blend(sh, el, smooth(S[1] - 0.29 * h, S[1] - 0.37 * h, p[1])),
  });
  loft(skin, ringsU.slice(0, 6), armOpts(SKIN_ATLAS.upper, -0.13, -0.33));
  loft(skin, ringsU.slice(5), armOpts(SKIN_ATLAS.fore, -0.33, -0.615));
  // wristband
  loft(gear, [at(-0.56, 0.052), at(-0.6, 0.05), at(-0.625, 0.048)], { seg: 16, color: () => hex('#f2f2f0'), weight: one(el) });
  // glove: palm, four fingers and a thumb, gently curled
  const Hd = J[hand];
  const g = (x, y, z) => [Hd[0] + x * s, Hd[1] + y * h, Hd[2] + z];
  const gloveW = { weight: one(hand), color: ({ n }) => mul(glove, n[0] * -s > 0.4 ? 0.78 : 1) };
  ellipsoid(gear, g(0.002, -0.045, 0.004), [0.024 * B.arm, 0.05 * B.arm, 0.045 * B.arm], gloveW, 12, 10);
  const fingers = [[0.03, 0.068], [0.011, 0.074], [-0.009, 0.071], [-0.027, 0.06]];
  for (const [z, l] of fingers) {
    const k = l / 0.07;
    const p0 = g(0.0, -0.085, z);
    const p1 = g(-0.008, -0.085 - 0.038 * k, z * 1.05);
    const p2 = g(-0.022, -0.085 - 0.064 * k, z * 1.1);
    capsule(gear, p0, p1, 0.0105 * B.arm, gloveW);
    capsule(gear, p1, p2, 0.0098 * B.arm, gloveW);
  }
  const t0 = g(-0.012, -0.03, 0.036);
  const t1 = g(-0.026, -0.058, 0.052);
  const t2 = g(-0.034, -0.083, 0.056);
  capsule(gear, t0, t1, 0.012 * B.arm, gloveW);
  capsule(gear, t1, t2, 0.0105 * B.arm, gloveW);
}

// Leg: thigh with pads and a knee pad inside the pants, a calf in a ribbed sock, taped
// ankle, high-top cleat with a studded sole.
function buildLeg(pieces, B, J, s, tag, h) {
  const { uniform, gear } = pieces;
  const hip = `hip${tag}`;
  const knee = `knee${tag}`;
  const foot = `foot${tag}`;
  const x0 = J[hip][0];
  const a0 = s > 0 ? 0 : Math.PI;
  const dir = s > 0 ? 1 : -1;
  const local = (a) => (dir > 0 ? a : Math.PI - a);
  const Y = (y) => y * h;
  const legWeight = ({ p }) => {
    const y = p[1];
    if (y > Y(0.85)) return blend(hip, 'pelvis', 0.5 * smooth(Y(0.92), Y(1.08), y));
    if (y > Y(0.3)) return blend(hip, knee, smooth(Y(0.62), Y(0.52), y));
    return blend(knee, foot, smooth(Y(0.17), Y(0.1), y));
  };
  const inside = (a) => around(local(a), Math.PI, 1.3);
  // thigh: quads sweep out, a thigh pad squares off the front, the knee pad bulges
  const thigh = [
    [1.1, 0.13], [1.02, 0.136], [0.94, 0.134], [0.86, 0.127], [0.78, 0.116], [0.7, 0.103], [0.64, 0.093],
    [0.595, 0.088], [0.56, 0.088], [0.525, 0.084], [0.5, 0.082],
  ].map(([y, r]) => ({
    c: [x0 - s * 0.012 * smooth(1.0, 0.55, y), Y(y), 0.0],
    rx: r * B.leg, rz: r * B.leg * 1.02,
    mod: (a) => {
      const l = local(a);
      const pad = 0.12 * window1(y, 0.73, 0.97, 0.03) * around(l, Math.PI / 2, 0.75);
      const sweep = 0.06 * window1(y, 0.74, 1.0, 0.06) * around(l, 0.2, 0.9);
      const tear = 0.08 * window1(y, 0.62, 0.7, 0.04) * around(l, Math.PI * 0.75, 0.6);
      const kneePad = 0.17 * window1(y, 0.54, 0.6, 0.02) * around(l, Math.PI / 2, 0.85);
      const ham = 0.05 * window1(y, 0.7, 0.95, 0.05) * around(l, (Math.PI * 3) / 2, 1.0);
      return 1 + pad + sweep + tear + kneePad + ham;
    },
  }));
  loft(uniform, thigh, {
    seg: 26, a0, dir,
    uv: ({ a01, t }) => inAtlas(ATLAS.thigh, a01, 1 - t),
    color: ({ a, p }) => gray((1 - 0.2 * inside(a)) * lerp(0.72, 1, Math.min(1, smooth(Y(1.08), Y(0.92), p[1]) + (1 - inside(a)) * 0.6))),
    weight: legWeight,
  });
  // sock over the calf, white tape down to the shoe
  const sock = [[0.53, 0.081], [0.47, 0.087, 0.2], [0.41, 0.089, 0.22], [0.34, 0.077, 0.12], [0.27, 0.063], [0.2, 0.053], [0.15, 0.05], [0.115, 0.05]]
    .map(([y, r, calf = 0]) => ({
      c: [x0 - s * 0.012, Y(y), -0.004], rx: r * B.leg, rz: r * B.leg,
      mod: (a) => 1 + calf * around(local(a), (Math.PI * 3) / 2, 1.1) + calf * 0.4 * around(local(a), Math.PI * 1.15, 0.6),
    }));
  loft(uniform, sock, {
    seg: 22, a0, dir,
    uv: ({ a01, t }) => inAtlas(ATLAS.sock, a01, 1 - t),
    color: ({ a }) => gray(1 - 0.15 * inside(a)),
    weight: legWeight,
  });
  // high-top cleat: a shoe lofted heel to toe, collar up around the ankle
  const shoe = [
    [-0.092, 0.032, 0.036, 0.046], [-0.078, 0.047, 0.072, 0.083], [-0.035, 0.055, 0.083, 0.09], [0.015, 0.057, 0.068, 0.07],
    [0.065, 0.056, 0.05, 0.051], [0.115, 0.054, 0.038, 0.039], [0.165, 0.047, 0.03, 0.031], [0.2, 0.032, 0.023, 0.025], [0.214, 0.012, 0.011, 0.025],
  ].map(([z, rx, ry, cy]) => ({ c: [x0 - s * 0.014, cy + 0.012, z], rx: rx * B.leg, rz: ry, n: 2.5 }));
  loft(uniform, shoe, {
    seg: 22, U: [s, 0, 0], W: [0, 1, 0],
    uv: ({ a01, t }) => inAtlas(ATLAS.cleat, a01, t),
    weight: ({ p }) => (p[1] > 0.16 ? blend(foot, knee, 0.3) : [[BI[foot], 1]]),
    capStart: true,
    capEnd: true,
  });
  // sole and studs
  const sole = new THREE.BoxGeometry(0.104 * B.leg, 0.016, 0.3, 4, 1, 8);
  const sp = sole.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const z = sp.getZ(i);
    const taper = z > 0.05 ? 1 - (z - 0.05) * 2.6 : z < -0.08 ? 1 - (-0.08 - z) * 3.2 : 1;
    sp.setX(i, sp.getX(i) * Math.max(0.35, taper));
  }
  sole.computeVertexNormals();
  sole.applyMatrix4(new THREE.Matrix4().makeTranslation(x0 - s * 0.014, 0.008, 0.06));
  addGeometry(gear, sole, { weight: one(foot), color: () => hex('#2b2b2e') });
  sole.dispose();
  for (const [sx, sz] of [[-0.028, 0.15], [0.028, 0.15], [-0.03, 0.08], [0.03, 0.08], [0, 0.02], [-0.022, -0.06], [0.022, -0.06]]) {
    const st = new THREE.CylinderGeometry(0.008, 0.011, 0.014, 6);
    st.applyMatrix4(new THREE.Matrix4().makeTranslation(x0 - s * 0.014 + sx * B.leg, -0.005, sz));
    addGeometry(gear, st, { weight: one(foot), color: () => hex('#c9cdd3') });
    st.dispose();
  }
}

// A face inside the helmet: brow, cheekbones, nose and chin shaped over an egg, painted
// from the skin atlas (front projection).
function buildFace(skin, at, weight) {
  const g = new THREE.SphereGeometry(1, 24, 18);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const front = Math.max(0, z);
    // brow ridge, nose, cheekbones, jaw
    z += 0.08 * front * Math.exp(-((y - 0.28) ** 2) / 0.01) * Math.exp(-(x * x) / 0.25);
    z += 0.32 * front * Math.exp(-((y + 0.05) ** 2) / 0.04) * Math.exp(-(x * x) / 0.012);
    z += 0.06 * front * Math.exp(-((y + 0.05) ** 2) / 0.02) * Math.exp(-((Math.abs(x) - 0.45) ** 2) / 0.02);
    x *= 1 - 0.12 * Math.max(0, -y);
    z += 0.05 * front * Math.exp(-((y + 0.75) ** 2) / 0.02) * Math.exp(-(x * x) / 0.05);
    p.setXYZ(i, x * 0.094, y * 0.116, z * 0.1);
  }
  g.computeVertexNormals();
  const c = at(0, -0.034, 0.03);
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(...c));
  addGeometry(skin, g, {
    weight,
    uv: ({ p: q }) => inAtlas(SKIN_ATLAS.face, 0.5 + (q[0] - c[0]) / 0.21, 0.5 + (q[1] - c[1]) / 0.25),
    // in the shadow of the helmet: darkest under the brim and at the sides
    color: ({ n, p: q }) => gray((0.42 + 0.3 * Math.max(0, n[2])) * lerp(1, 0.6, smooth(c[1] - 0.01, c[1] + 0.07, q[1]))),
  });
  g.dispose();
}

// Helmet shell: an egg-shaped dome that comes down over the ears and jaw, open in front.
function buildHelmet(pieces, at, weight) {
  const A = 0.15;
  const Bv = 0.146;
  const Cz = 0.167;
  const off = [0, 0.012, -0.012];
  const NT = 48;
  const NP = 18;
  const phiMax = (th) => {
    const a = Math.abs(th);
    const FRONT = 1.36;
    const SIDE = 2.24;
    const BACK = 2.05;
    if (a < 0.46) return FRONT;
    if (a < 0.88) return lerp(FRONT, SIDE, smooth(0.46, 0.88, a));
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
        // the back of a helmet flares out a little over the neck
        const flare = 1 + 0.06 * smooth(1.7, 2.1, ph) * smooth(1.6, 2.6, Math.abs(th));
        const x = A * k * Math.sin(ph) * Math.sin(th) * flare;
        const y = Bv * k * Math.cos(ph);
        const z = Cz * k * Math.sin(ph) * Math.cos(th) * flare;
        let n = norm([x / (A * A), y / (Bv * Bv), z / (Cz * Cz)]);
        if (inward) n = [-n[0], -n[1], -n[2]];
        piece.vert(at(x + off[0], y + off[1], z + off[2]), n, uvOn ? [i / NT, 1 - ph / HELMET_PHI] : [0, 0], colorFn(j / NP, th), weight());
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
  const outer = shell(pieces.helmet, 1, false, (v) => gray(lerp(1, 0.8, smooth(0.75, 1, v))), true);
  const pad = hex('#1b1c20');
  const inner = shell(pieces.gear, 0.93, true, () => pad, false);
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
  // ear holes and the chin strap snaps
  for (const s of [-1, 1]) {
    ellipsoid(g, at(s * 0.147, -0.03, -0.004), [0.011, 0.019, 0.019], { weight, color: () => pad }, 8, 6);
    ellipsoid(g, at(s * 0.138, -0.085, 0.07), [0.008, 0.008, 0.008], { weight, color: () => hex('#d8dbe0') }, 6, 5);
  }
}

function buildFacemask(gear, at, weight, color, cage) {
  const r = 0.0078;
  const o = { weight, color: () => color };
  const bar = (y, zc, xs, zs, drop = 0) => [
    [-xs, y + drop, zs], [-xs * 0.88, y, zc - 0.06], [-xs * 0.45, y - 0.004, zc - 0.011], [0, y - 0.005, zc],
    [xs * 0.45, y - 0.004, zc - 0.011], [xs * 0.88, y, zc - 0.06], [xs, y + drop, zs],
  ].map(([x, yy, z]) => at(x, yy, z));
  tube(gear, bar(-0.026, 0.205, 0.146, 0.066, 0.01), r, { ...o, segs: 18 });
  tube(gear, bar(-0.083, 0.198, 0.137, 0.052), r, { ...o, segs: 18 });
  if (cage) {
    tube(gear, bar(-0.133, 0.18, 0.104, 0.062, 0.01), r, { ...o, segs: 16 });
    for (const x of [-0.044, 0.044]) tube(gear, [at(x, -0.021, 0.2), at(x * 1.02, -0.079, 0.196), at(x * 0.95, -0.136, 0.176)], r, { ...o, segs: 6 });
  }
  tube(gear, [at(0, -0.026, 0.205), at(0, -0.057, 0.204), at(0, cage ? -0.138 : -0.087, cage ? 0.18 : 0.198)], r, { ...o, segs: 6 });
  for (const s of [-1, 1]) {
    tube(gear, [at(s * 0.146, -0.016, 0.066), at(s * 0.143, 0.009, 0.088), at(s * 0.13, 0.031, 0.11)], r, { ...o, segs: 5 });
    tube(gear, [at(s * 0.137, -0.083, 0.052), at(s * 0.13, -0.105, 0.04), at(s * 0.122, -0.122, 0.018)], r, { ...o, segs: 5 });
  }
}
