// Procedural canvas textures: everything visual is generated at startup,
// so the game ships with zero image files.
import * as THREE from 'three';

export const FONT = 'Kanit, "Arial Black", Impact, sans-serif';
// Block "varsity" numerals for jerseys
export const NUMBER_FONT = 'Graduate, "Arial Black", Impact, sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, { repeat = false, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// Small deterministic RNG so textures look the same every load.
function srand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// --------------------------------------------------------------- turf
export function grassTexture() {
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const r = srand(7);
  g.fillStyle = '#e4e4e4';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) {
    const x = r() * S;
    const y = r() * S;
    const v = 160 + Math.floor(r() * 95);
    // most blades take the stripe color; a few are straw-colored or dead
    const straw = r() < 0.06;
    g.fillStyle = straw ? `rgb(${v},${Math.round(v * 0.86)},${Math.round(v * 0.55)})` : `rgb(${v},${v},${v})`;
    g.fillRect(x, y, 1 + r() * 1.5, 2 + r() * 4);
  }
  // soft mottling
  for (let i = 0; i < 60; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 20 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const a = r() * 0.08;
    grd.addColorStop(0, `rgba(0,0,0,${a})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return tex(c, { repeat: true, srgb: false });
}

// Wear on the field of play: dirt along the hashes and down the middle where the ball
// gets spotted, scuffed goal mouths, divots everywhere. Covers the field between the goal
// lines (x across, z along the length) and is laid over the striped grass.
export function turfWearTexture(halfW, goal) {
  const W = 256;
  const H = 1024;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const r = srand(31337);
  g.clearRect(0, 0, W, H);
  const X = (x) => ((x + halfW) / (2 * halfW)) * W;
  const Z = (z) => ((goal - z) / (2 * goal)) * H;
  const dirt = ['#5a4430', '#6b5238', '#4b3a2a', '#7a6646'];
  const blot = (x, z, rx, rz, a) => softBlob(g, X(x), Z(z), rx, rz, r() * Math.PI, dirt[Math.floor(r() * dirt.length)], a * 1.4);
  g.save();
  // the middle of the field takes the most abuse
  for (const lane of [0, -6.67, 6.67]) {
    for (let i = 0; i < 520; i++) {
      const z = (r() - 0.5) * 2 * goal * 0.96;
      const mid = 1 - Math.min(1, Math.abs(z) / goal);
      if (r() > 0.25 + mid * 0.75) continue;
      blot(lane + (r() - 0.5) * (lane === 0 ? 9 : 4), z, 2 + r() * 6, 3 + r() * 10, (0.05 + r() * 0.12) * (lane === 0 ? 1 : 0.8));
    }
  }
  // goal mouths
  for (const s of [-1, 1]) for (let i = 0; i < 70; i++) blot((r() - 0.5) * 16, s * (goal - r() * 7), 3 + r() * 8, 3 + r() * 8, 0.06 + r() * 0.1);
  g.restore();
  // divots: dark gouges with a lighter lip
  for (let i = 0; i < 420; i++) {
    const x = (r() - 0.5) * 2 * halfW * 0.9;
    const z = (r() - 0.5) * 2 * goal;
    g.globalAlpha = 0.25 + r() * 0.3;
    g.fillStyle = '#3a2c1e';
    g.fillRect(X(x), Z(z), 1 + r() * 2, 1 + r() * 3);
    g.globalAlpha = 0.15;
    g.fillStyle = '#9a8a60';
    g.fillRect(X(x) + 1, Z(z) - 1, 1, 1);
  }
  g.globalAlpha = 1;
  const t = tex(c, { aniso: 8 });
  return t;
}

// --------------------------------------------------------------- yard numbers
export function numberTexture(text) {
  const c = canvas(256, 160);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 160);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 150px ${FONT}`;
  const [a, b] = text.split('');
  g.fillText(a, 64, 86);
  g.fillText(b, 192, 86);
  return tex(c);
}

// --------------------------------------------------------------- end zones
export function endZoneTexture(team) {
  const c = canvas(2048, 400);
  const g = c.getContext('2d');
  g.fillStyle = team.colors.endzone;
  g.fillRect(0, 0, 2048, 400);
  // diagonal pinstripes
  g.save();
  g.globalAlpha = 0.09;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 14;
  for (let x = -400; x < 2448; x += 70) {
    g.beginPath();
    g.moveTo(x, 400);
    g.lineTo(x + 400, 0);
    g.stroke();
  }
  g.restore();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `italic 900 270px ${FONT}`;
  const name = team.name;
  // fit the name to the width
  let size = 270;
  while (g.measureText(name).width > 1760 && size > 120) {
    size -= 10;
    g.font = `italic 900 ${size}px ${FONT}`;
  }
  g.lineJoin = 'round';
  g.lineWidth = 34;
  g.strokeStyle = team.colors.endzoneTextOutline;
  g.strokeText(name, 1024, 214);
  g.lineWidth = 12;
  g.strokeStyle = '#ffffff';
  g.strokeText(name, 1024, 214);
  g.fillStyle = team.colors.endzoneText;
  g.fillText(name, 1024, 214);
  return tex(c);
}

// --------------------------------------------------------------- state silhouettes
function projectOutline(polys, size, pad) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const lat0 = (polys[0][0][1] * Math.PI) / 180;
  const k = Math.cos(lat0);
  const pts = polys.map((poly) => poly.map(([lon, lat]) => [lon * k, -lat]));
  for (const poly of pts) {
    for (const [x, y] of poly) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const s = (size - pad * 2) / Math.max(maxX - minX, maxY - minY);
  const ox = (size - (maxX - minX) * s) / 2;
  const oy = (size - (maxY - minY) * s) / 2;
  return {
    polys: pts.map((poly) => poly.map(([x, y]) => [ox + (x - minX) * s, oy + (y - minY) * s])),
    map: (lon, lat) => [ox + (lon * k - minX) * s, oy + (-lat - minY) * s],
  };
}

export function drawStateLogo(g, team, size, { outline = true, star = true, shadow = true } = {}) {
  const pad = size * 0.08;
  const { polys, map } = projectOutline(team.outline, size, pad);
  const path = new Path2D();
  for (const poly of polys) {
    poly.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    path.closePath();
  }
  g.save();
  g.lineJoin = 'round';
  if (shadow) {
    g.save();
    g.translate(size * 0.02, size * 0.025);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fill(path);
    g.restore();
  }
  if (outline) {
    g.lineWidth = size * 0.05;
    g.strokeStyle = team.colors.dark;
    g.stroke(path);
    g.lineWidth = size * 0.026;
    g.strokeStyle = team.colors.light === '#FFFFFF' ? '#ffffff' : team.colors.light;
    g.stroke(path);
  }
  g.fillStyle = team.colors.primary;
  g.fill(path);
  if (star) {
    const capital = team.id === 'IND' ? [-86.16, 39.77] : [-84.55, 42.73];
    const [sx, sy] = map(capital[0], capital[1]);
    drawStar(g, sx, sy, size * 0.065, team.colors.light === '#FFFFFF' ? '#ffffff' : team.colors.light, team.colors.dark);
  }
  g.restore();
}

function drawStar(g, x, y, r, fill, stroke) {
  g.save();
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.lineWidth = r * 0.25;
  g.strokeStyle = stroke;
  g.stroke();
  g.fillStyle = fill;
  g.fill();
  g.restore();
}

export function midfieldTexture(team) {
  const S = 1024;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  drawStateLogo(g, team, S);
  return tex(c);
}

export function logoDataURL(team, size = 256) {
  const c = canvas(size, size);
  drawStateLogo(c.getContext('2d'), team, size);
  return c.toDataURL();
}

// --------------------------------------------------------------- jerseys
const numCache = new Map();
export function jerseyNumberTexture(team, num) {
  const key = `${team.id}-${num}`;
  if (numCache.has(key)) return numCache.get(key);
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const s = String(num);
  g.font = `800 ${s.length > 1 ? 96 : 104}px ${FONT}`;
  g.lineJoin = 'round';
  g.lineWidth = 12;
  g.strokeStyle = team.colors.numberOutline;
  g.strokeText(s, 64, 70);
  g.fillStyle = team.colors.number;
  g.fillText(s, 64, 70);
  const t = tex(c, { aniso: 4 });
  numCache.set(key, t);
  return t;
}

// --------------------------------------------------------------- crowd
export function crowdTexture(palette, seed, frame = 0) {
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const r = srand(seed);
  g.fillStyle = '#121418';
  g.fillRect(0, 0, W, H);
  const rows = 22;
  const rowH = H / rows;
  const skins = ['#f1c9a5', '#e0ac7e', '#c68857', '#8d5a3b', '#5c3a24', '#f6d7bf'];
  for (let row = 0; row < rows; row++) {
    const y0 = row * rowH;
    // seat row
    g.fillStyle = row % 2 ? '#1c1f26' : '#191b21';
    g.fillRect(0, y0 + rowH * 0.72, W, rowH * 0.28);
    const per = 26;
    const w = W / per;
    for (let i = 0; i < per; i++) {
      if (r() < 0.06) continue;
      const x = i * w + w * 0.5 + (r() - 0.5) * w * 0.3;
      const col = r() < 0.82 ? palette[Math.floor(r() * palette.length)] : ['#3b3f4a', '#6b6f78', '#c9c9c9', '#232323'][Math.floor(r() * 4)];
      const up = frame && r() < 0.5 ? rowH * 0.18 : 0;
      const bodyW = w * (0.55 + r() * 0.2);
      g.fillStyle = col;
      g.beginPath();
      g.roundRect(x - bodyW / 2, y0 + rowH * 0.42 - up, bodyW, rowH * 0.5, 4);
      g.fill();
      g.fillStyle = skins[Math.floor(r() * skins.length)];
      g.beginPath();
      g.arc(x, y0 + rowH * 0.3 - up, rowH * 0.17, 0, Math.PI * 2);
      g.fill();
      // raised arms on the "hype" frame
      if (frame && up) {
        g.fillStyle = col;
        g.fillRect(x - bodyW / 2 - 3, y0 + rowH * 0.05 - up, 4, rowH * 0.45);
        g.fillRect(x + bodyW / 2 - 1, y0 + rowH * 0.05 - up, 4, rowH * 0.45);
      }
    }
  }
  // flashbulbs
  for (let i = 0; i < 20; i++) {
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(r() * W, r() * H, 2, 2);
  }
  return tex(c, { repeat: true });
}

// --------------------------------------------------------------- misc
export function glowTexture() {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return tex(c, { srgb: false });
}

export function blobTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return tex(c, { srgb: false });
}

export function lampTexture() {
  const c = canvas(256, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#20232a';
  g.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const cx = 16 + x * 32;
      const cy = 16 + y * 32;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, 14);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.5, '#fff6dc');
      grd.addColorStop(1, '#6b6250');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy, 13, 0, Math.PI * 2);
      g.fill();
    }
  }
  return tex(c);
}

export function wallTexture(home, away) {
  const c = canvas(2048, 128);
  const g = c.getContext('2d');
  const segs = [
    { bg: home.colors.primary, fg: '#ffffff', text: home.name },
    { bg: '#111318', fg: '#ffd23f', text: '1ST & 30' },
    { bg: away.colors.primary, fg: away.colors.light, text: away.name },
    { bg: '#111318', fg: '#ff6a00', text: 'COLLEGE BLITZ' },
  ];
  const w = 2048 / segs.length;
  segs.forEach((s, i) => {
    g.fillStyle = s.bg;
    g.fillRect(i * w, 0, w, 128);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(i * w, 0, w, 20);
    g.fillStyle = s.fg;
    g.font = `italic 900 70px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s.text, i * w + w / 2, 70);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(i * w + w - 4, 0, 4, 128);
  });
  return tex(c, { repeat: true });
}

export function labelTexture(text, color, bg = 'rgba(0,0,0,0)') {
  const c = canvas(128, 64);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 128, 64);
  g.font = `italic 900 46px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 64, 34);
  g.fillStyle = color;
  g.fillText(text, 64, 34);
  return tex(c, { aniso: 1 });
}

// --------------------------------------------------------------- uniforms
// One texture per player covers everything made of cloth. The player geometry
// maps each body part into its own rectangle of this atlas (uv, v = 0 at the bottom).
export const ATLAS = {
  torso: { u0: 0, v0: 0.5, u1: 1, v1: 1 },
  sleeve: { u0: 0, v0: 0.25, u1: 0.5, v1: 0.5 },
  cap: { u0: 0.5, v0: 0.25, u1: 0.75, v1: 0.5 },
  pelvis: { u0: 0.75, v0: 0.25, u1: 1, v1: 0.5 },
  thigh: { u0: 0, v0: 0, u1: 0.5, v1: 0.25 },
  sock: { u0: 0.5, v0: 0, u1: 1, v1: 0.25 },
};
// Where the jersey numbers sit on the torso, in the torso region's own 0..1 space.
// The torso wraps with the front at u = 0.75 and the back at u = 0.25.
export const TORSO_MARKS = { front: { u: 0.75, v: 0.52, h: 0.3 }, back: { u: 0.25, v: 0.56, h: 0.36 } };

function fabricNoise(g, x, y, w, h, seed, amt = 0.05) {
  const r = srand(seed);
  const n = Math.round((w * h) / 22);
  for (let i = 0; i < n; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${amt * r()})` : `rgba(255,255,255,${amt * 0.7 * r()})`;
    g.fillRect(x + r() * w, y + r() * h, 1.5, 1.5);
  }
}

function drawNumber(g, text, cx, cy, height, fill, outline, squeeze = 0.62) {
  g.save();
  g.translate(cx, cy);
  g.scale(squeeze, 1);
  g.font = `400 ${Math.round(height * 1.3)}px ${NUMBER_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = height * 0.2;
  g.strokeStyle = outline;
  g.strokeText(text, 0, height * 0.06);
  // block numerals: fatten the face with a stroke in its own color
  g.lineWidth = height * 0.085;
  g.strokeStyle = fill;
  g.strokeText(text, 0, height * 0.06);
  g.fillStyle = fill;
  g.fillText(text, 0, height * 0.06);
  g.restore();
}

// Soft-edged ellipse (a radial gradient squashed into shape; canvas blur filters are far too
// slow to use hundreds of times at startup).
function softBlob(g, x, y, rx, ry, angle, color, alpha) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(1, ry / rx);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  grd.addColorStop(0, color);
  grd.addColorStop(0.55, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = alpha;
  g.fillStyle = grd;
  g.fillRect(-rx, -rx, rx * 2, rx * 2);
  g.restore();
}

// Smear of dirt or grass: a few overlapping soft blobs.
function smear(g, x, y, w, h, color, alpha, r, angle = 0) {
  for (let k = 0; k < 4; k++) {
    softBlob(g, x + (r() - 0.5) * w * 0.6, y + (r() - 0.5) * h * 0.8, w * (0.3 + r() * 0.4), h * (0.3 + r() * 0.5), angle + (r() - 0.5) * 0.5, color, alpha);
  }
}

// Specks and scrapes inside a box.
function grit(g, b, r, n, colors, alpha) {
  g.save();
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * (0.4 + r() * 0.6);
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    const len = 1 + r() * 5;
    g.fillRect(b.x + r() * b.w, b.y + r() * b.h, len, 1 + r());
  }
  g.restore();
}

// Shared fabric relief (normal map) for every uniform, laid out on the same atlas: mesh knit
// on the jersey, stitched seams, wrinkles at the waist, the elbows and behind the knees,
// ribbed socks. Drawn as a height map, then turned into normals.
let fabricNormals = null;
export function uniformNormalMap(S = 512) {
  if (fabricNormals) return fabricNormals;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const r = srand(4242);
  const box = (R) => ({ x: R.u0 * S, y: (1 - R.v1) * S, w: (R.u1 - R.u0) * S, h: (R.v1 - R.v0) * S });
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, S, S);
  const line = (x0, y0, x1, y1, v, w = 1.4) => {
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  // a wrinkle: the same curve stroked wide-and-faint to narrow-and-strong, a cheap soft ridge
  const fold = (x, y, len, ang, depth, width) => {
    const mx = x + Math.cos(ang) * len * 0.5 + (r() - 0.5) * 10;
    const my = y + Math.sin(ang) * len * 0.5 + (r() - 0.5) * 10;
    const ex = x + Math.cos(ang) * len;
    const ey = y + Math.sin(ang) * len;
    g.save();
    g.lineCap = 'round';
    for (const [wk, a] of [[3.2, 0.12], [2.0, 0.16], [1.0, 0.22]]) {
      g.strokeStyle = depth > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      g.lineWidth = width * wk;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(mx, my, ex, ey);
      g.stroke();
    }
    g.restore();
  };
  // jersey mesh knit
  const knit = canvas(5, 5);
  const kg = knit.getContext('2d');
  kg.fillStyle = 'rgb(140,140,140)';
  kg.fillRect(0, 0, 5, 5);
  kg.fillStyle = 'rgb(96,96,96)';
  kg.fillRect(1.5, 1.5, 2, 2);
  const T = box(ATLAS.torso);
  g.fillStyle = g.createPattern(knit, 'repeat');
  g.fillRect(T.x, T.y, T.w, T.h);
  const SL = box(ATLAS.sleeve);
  g.fillRect(SL.x, SL.y, SL.w, SL.h);
  // torso: folds where the jersey bunches at the tuck and under the arms, seams down the sides
  for (let i = 0; i < 26; i++) fold(T.x + r() * T.w, T.y + T.h * (0.78 + r() * 0.2), 30 + r() * 50, (r() - 0.5) * 0.5, r() < 0.5 ? 1 : -1, 2 + r() * 2);
  for (const u of [0, 0.5, 1]) {
    for (let i = 0; i < 6; i++) fold(T.x + u * T.w + (r() - 0.5) * 40, T.y + T.h * (0.15 + r() * 0.35), 25 + r() * 30, Math.PI / 2 + (r() - 0.5) * 1.4, r() < 0.5 ? 1 : -1, 2);
    line(T.x + u * T.w, T.y, T.x + u * T.w, T.y + T.h, 165);
  }
  line(T.x, T.y + T.h * 0.02, T.x + T.w, T.y + T.h * 0.02, 165, 2);
  line(T.x, T.y + T.h * 0.035, T.x + T.w, T.y + T.h * 0.035, 90, 1.5);
  // sleeves: hem stitching and stripe edges
  for (const v of [0.1, 0.2, 0.32, 0.42, 0.54]) line(SL.x, SL.y + SL.h * (1 - v), SL.x + SL.w, SL.y + SL.h * (1 - v), v === 0.1 ? 170 : 110, 1.2);
  // pants: side seams, belt edges, wrinkles behind the knee and at the hips
  const PV = box(ATLAS.pelvis);
  for (const u of [0.035, 0.465, 0.535, 0.965]) line(PV.x + u * PV.w, PV.y, PV.x + u * PV.w, PV.y + PV.h, 160, 1.2);
  line(PV.x, PV.y + PV.h * 0.26, PV.x + PV.w, PV.y + PV.h * 0.26, 175, 2);
  for (let i = 0; i < 10; i++) fold(PV.x + r() * PV.w, PV.y + PV.h * (0.4 + r() * 0.5), 15 + r() * 25, (r() - 0.5) * 0.6, r() < 0.5 ? 1 : -1, 1.5);
  const TH = box(ATLAS.thigh);
  for (const u of [0.03, 0.97]) line(TH.x + u * TH.w, TH.y, TH.x + u * TH.w, TH.y + TH.h, 160, 1.2);
  for (let i = 0; i < 28; i++) fold(TH.x + r() * TH.w, TH.y + TH.h * (0.62 + r() * 0.3), 20 + r() * 40, (r() - 0.5) * 0.4, r() < 0.5 ? 1 : -1, 1.5 + r());
  for (let i = 0; i < 14; i++) fold(TH.x + r() * TH.w, TH.y + TH.h * (0.05 + r() * 0.5), 20 + r() * 40, Math.PI / 2 + (r() - 0.5) * 0.8, r() < 0.5 ? 1 : -1, 2);
  // socks: knit ribs
  const SK = box(ATLAS.sock);
  for (let x = SK.x; x < SK.x + SK.w; x += 3) line(x, SK.y, x, SK.y + SK.h * 0.78, 150, 1);
  // height -> normals
  const src = g.getImageData(0, 0, S, S).data;
  const out = g.createImageData(S, S);
  const H = (x, y) => src[((Math.min(S - 1, Math.max(0, y)) * S) + Math.min(S - 1, Math.max(0, x))) * 4] / 255;
  const k = 2.2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const du = (H(x + 1, y) - H(x - 1, y)) * k;
      const dv = -(H(x, y + 1) - H(x, y - 1)) * k;
      const l = Math.hypot(du, dv, 1);
      const o = (y * S + x) * 4;
      out.data[o] = (-du / l * 0.5 + 0.5) * 255;
      out.data[o + 1] = (-dv / l * 0.5 + 0.5) * 255;
      out.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      out.data[o + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  fabricNormals = tex(c, { srgb: false, aniso: 4 });
  return fabricNormals;
}

const uniformCache = new Map();
// grime: 0 = fresh out of the locker room, 1 = a lineman in the fourth quarter
export function uniformTexture(team, num, size = 512, grime = 0.6) {
  const key = `${team.id}-${num}-${size}-${grime}`;
  if (uniformCache.has(key)) return uniformCache.get(key);
  const S = size;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const C = team.colors;
  const box = (R) => ({ x: R.u0 * S, y: (1 - R.v1) * S, w: (R.u1 - R.u0) * S, h: (R.v1 - R.v0) * S });
  const at = (b, u, v) => [b.x + u * b.w, b.y + (1 - v) * b.h];
  const band = (b, v0, v1, color) => {
    g.fillStyle = color;
    g.fillRect(b.x, b.y + (1 - v1) * b.h, b.w, (v1 - v0) * b.h);
  };
  const col = (b, u0, u1, color) => {
    g.fillStyle = color;
    g.fillRect(b.x + u0 * b.w, b.y, (u1 - u0) * b.w, b.h);
  };
  const trim = C.light === '#FFFFFF' ? '#ffffff' : C.light;
  const s = String(num);

  // torso
  const T = box(ATLAS.torso);
  g.fillStyle = C.jersey;
  g.fillRect(T.x, T.y, T.w, T.h);
  // a little shading baked in: darker toward the tuck, lighter across the chest
  const sh = g.createLinearGradient(0, T.y, 0, T.y + T.h);
  sh.addColorStop(0, 'rgba(255,255,255,0.0)');
  sh.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  sh.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = sh;
  g.fillRect(T.x, T.y, T.w, T.h);
  band(T, 0.986, 1, trim); // collar
  band(T, 0.978, 0.986, C.dark);
  for (const [k, sq] of [['front', 0.6], ['back', 0.66]]) {
    const m = TORSO_MARKS[k];
    const [x, y] = at(T, m.u, m.v);
    drawNumber(g, s, x, y, m.h * T.h, C.number, C.numberOutline, sq * (s.length > 1 ? 1 : 1.15));
  }
  fabricNoise(g, T.x, T.y, T.w, T.h, num * 13 + 1);

  // sleeves: jersey color with two stripes near the hem
  const SL = box(ATLAS.sleeve);
  g.fillStyle = C.jersey;
  g.fillRect(SL.x, SL.y, SL.w, SL.h);
  band(SL, 0, 0.1, C.dark);
  band(SL, 0.2, 0.32, C.sleeve);
  band(SL, 0.42, 0.54, C.sleeve);
  fabricNoise(g, SL.x, SL.y, SL.w, SL.h, num * 13 + 2);

  // shoulder caps: TV number on the outside
  const CP = box(ATLAS.cap);
  g.fillStyle = C.jersey;
  g.fillRect(CP.x, CP.y, CP.w, CP.h);
  {
    const [x, y] = at(CP, 0.5, 0.36);
    drawNumber(g, s, x, y, CP.h * 0.2, C.number, C.numberOutline, 0.7);
  }

  // pants: belt + side stripes
  const PV = box(ATLAS.pelvis);
  g.fillStyle = C.pants;
  g.fillRect(PV.x, PV.y, PV.w, PV.h);
  col(PV, 0, 0.035, C.pantsStripe);
  col(PV, 0.965, 1, C.pantsStripe);
  col(PV, 0.465, 0.535, C.pantsStripe);
  band(PV, 0.74, 1, '#17181c');
  band(PV, 0.74, 0.76, 'rgba(255,255,255,0.18)');
  fabricNoise(g, PV.x, PV.y, PV.w, PV.h, num * 13 + 3, 0.04);
  const TH = box(ATLAS.thigh);
  g.fillStyle = C.pants;
  g.fillRect(TH.x, TH.y, TH.w, TH.h);
  // the stripe runs down the outside of each leg (u = 0 / 1 is the outside)
  col(TH, 0, 0.03, C.pantsStripe);
  col(TH, 0.97, 1, C.pantsStripe);
  const kn = g.createLinearGradient(0, TH.y + TH.h, 0, TH.y);
  kn.addColorStop(0, 'rgba(0,0,0,0.18)');
  kn.addColorStop(0.12, 'rgba(0,0,0,0.0)');
  kn.addColorStop(1, 'rgba(0,0,0,0.0)');
  g.fillStyle = kn;
  g.fillRect(TH.x, TH.y, TH.w, TH.h);
  fabricNoise(g, TH.x, TH.y, TH.w, TH.h, num * 13 + 4, 0.04);

  // socks: two stripes up top, white tape around the ankle
  const SK = box(ATLAS.sock);
  g.fillStyle = C.socks;
  g.fillRect(SK.x, SK.y, SK.w, SK.h);
  band(SK, 0.7, 0.78, trim);
  band(SK, 0.84, 0.92, trim);
  band(SK, 0, 0.22, '#f3f3f1');
  band(SK, 0.2, 0.23, 'rgba(0,0,0,0.12)');

  // ---- wear and tear: grass and dirt where players hit the ground, cracked numbers
  const r = srand(num * 977 + team.id.length * 31);
  const GRASS = '#6f7f3c';
  const DIRT = '#8b6f4b';
  const dark = '#2a2219';
  const at2 = (b, u, v) => [b.x + u * b.w, b.y + (1 - v) * b.h];
  // knees and thigh fronts (u = 0.25 / 0.75 are the fronts of the two legs)
  for (const u of [0.25, 0.75]) {
    for (let i = 0; i < 2 + Math.round(grime * 3); i++) {
      const [x, y] = at2(TH, u + (r() - 0.5) * 0.18, 0.12 + r() * 0.55);
      // scrapes run across the leg, like sliding on turf
      smear(g, x, y, TH.w * (0.07 + r() * 0.1), TH.h * (0.03 + r() * 0.05), r() < 0.55 ? GRASS : DIRT, (0.1 + r() * 0.16) * (0.5 + grime), r, (r() - 0.5) * 0.4);
    }
  }
  // seat of the pants and the hips
  for (let i = 0; i < 1 + Math.round(grime * 3); i++) {
    const [x, y] = at2(PV, r(), 0.2 + r() * 0.45);
    smear(g, x, y, PV.w * 0.18, PV.h * 0.12, r() < 0.5 ? GRASS : DIRT, (0.12 + r() * 0.2) * (0.5 + grime), r);
  }
  // jersey: belly and sides from hitting the turf, a few on the back
  for (let i = 0; i < 2 + Math.round(grime * 5); i++) {
    const front = r() < 0.7;
    const [x, y] = at2(T, (front ? 0.75 : 0.25) + (r() - 0.5) * 0.3, 0.05 + r() * 0.4);
    smear(g, x, y, T.w * (0.04 + r() * 0.06), T.h * (0.03 + r() * 0.05), r() < 0.5 ? GRASS : DIRT, (0.14 + r() * 0.2) * (0.4 + grime), r, (r() - 0.5) * 0.8);
  }
  grit(g, T, r, Math.round(400 * grime), [dark, DIRT, GRASS], 0.3);
  grit(g, TH, r, Math.round(260 * grime), [dark, DIRT, GRASS], 0.3);
  grit(g, PV, r, Math.round(120 * grime), [dark, DIRT], 0.35);
  grit(g, SK, r, Math.round(160 * grime), [dark, DIRT], 0.4);
  // ankle tape takes a beating
  smear(g, SK.x + SK.w / 2, SK.y + SK.h * 0.9, SK.w * 0.5, SK.h * 0.1, DIRT, 0.25 + grime * 0.25, r);
  // cracked screen-printed numbers
  g.save();
  g.strokeStyle = C.jersey;
  g.globalAlpha = 0.55;
  g.lineWidth = 0.8;
  for (const k of ['front', 'back']) {
    const m = TORSO_MARKS[k];
    const [cx, cy] = at2(T, m.u, m.v);
    for (let i = 0; i < 26; i++) {
      const x = cx + (r() - 0.5) * T.w * 0.13;
      const y = cy + (r() - 0.5) * T.h * m.h * 0.9;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 9, y + (r() - 0.5) * 9);
      g.stroke();
    }
  }
  g.restore();

  const t = tex(c, { aniso: 4 });
  uniformCache.set(key, t);
  return t;
}

// Helmet shell texture. The shell maps u = azimuth (front at 0.5, back at 0 / 1)
// and v = 1 - polar / HELMET_PHI (top of the helmet at v = 1).
export const HELMET_PHI = 2.3;
const helmetCache = new Map();
export function helmetTexture(team, R = 0.172) {
  if (helmetCache.has(team.id)) return helmetCache.get(team.id);
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const C = team.colors;
  g.fillStyle = C.helmet;
  g.fillRect(0, 0, W, H);
  // center stripe over the top: constant physical width, so it widens in u toward the pole
  const stripe = (width, color, uC) => {
    g.fillStyle = color;
    for (let y = 0; y < H; y++) {
      const phi = ((y + 0.5) / H) * HELMET_PHI;
      const hw = Math.min(0.26, width / (2 * Math.PI * R * Math.max(0.02, Math.sin(phi))) / 2);
      for (const u of [uC, uC - 1, uC + 1]) g.fillRect((u - hw) * W, y, hw * 2 * W, 1);
    }
  };
  stripe(0.085, C.dark, 0.5);
  stripe(0.085, C.dark, 0);
  stripe(0.06, C.helmetStripe, 0.5);
  stripe(0.06, C.helmetStripe, 0);
  // state decal on both sides, never mirrored
  const decalPhi = 1.42;
  const physical = 0.15;
  const du = physical / (2 * Math.PI * R * Math.sin(decalPhi));
  const dv = physical / R / HELMET_PHI;
  const dw = du * W;
  const dh = dv * H;
  const tmp = canvas(256, 256);
  drawStateLogo(tmp.getContext('2d'), team, 256, { shadow: false });
  for (const u of [0.25, 0.75]) {
    g.drawImage(tmp, u * W - dw / 2, (decalPhi / HELMET_PHI) * H - dh / 2, dw, dh);
  }
  // game wear: scratches, chips and paint swapped from other helmets
  const r = srand(team.id.length * 101 + 7);
  g.save();
  for (let i = 0; i < 140; i++) {
    const x = r() * W;
    const y = (0.15 + r() * 0.75) * H;
    g.globalAlpha = 0.18 + r() * 0.3;
    g.strokeStyle = r() < 0.6 ? '#ffffff' : '#111111';
    g.lineWidth = 0.6 + r() * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 26, y + (r() - 0.5) * 8);
    g.stroke();
  }
  const others = ['#ffffff', '#0c2d6b', '#ffcb05', '#ce1126', '#1a1a1a'].filter((k) => k.toLowerCase() !== C.helmet.toLowerCase());
  for (let i = 0; i < 9; i++) {
    softBlob(g, r() * W, (0.3 + r() * 0.55) * H, 5 + r() * 12, 2 + r() * 3, (r() - 0.5) * 0.6, others[Math.floor(r() * others.length)], 0.4 + r() * 0.3);
  }
  g.restore();
  const t = tex(c, { aniso: 8 });
  helmetCache.set(team.id, t);
  return t;
}

// Brushed-metal streaks for the HUD and menus: transparent, so CSS can lay it over any
// base color (polished steel or dark gunmetal).
export function brushedMetalDataURL(w = 300, h = 60) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const r = srand(5150);
  for (let i = 0; i < 1400; i++) {
    const y = Math.floor(r() * h);
    const x = r() * w;
    const len = 12 + r() * 160;
    g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.03 + r() * 0.07})` : `rgba(0,0,0,${0.04 + r() * 0.09})`;
    g.fillRect(x, y, len, 1);
    if (x + len > w) g.fillRect(x - w, y, len, 1); // wrap so the tile repeats seamlessly
  }
  // a few deeper scratches
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.08 + r() * 0.1})`;
    g.lineWidth = 0.7;
    g.beginPath();
    const x = r() * w;
    const y = r() * h;
    g.moveTo(x, y);
    g.lineTo(x + 10 + r() * 30, y + (r() - 0.5) * 6);
    g.stroke();
  }
  return c.toDataURL();
}

// Receiver pass icon: a keycap for keyboard players, a round face button for gamepads.
export const ICON_COLORS = ['#2f86ff', '#27c24c', '#ff3b3b'];
export function iconTexture(text, color, round = false) {
  const S = 128;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const path = () => {
    g.beginPath();
    if (round) g.arc(64, 64, 50, 0, Math.PI * 2);
    else g.roundRect(14, 14, 100, 100, 22);
  };
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 10;
  path();
  g.fillStyle = color;
  g.fill();
  g.shadowBlur = 0;
  // glossy top + dark rim
  const sheen = g.createLinearGradient(0, 14, 0, 114);
  sheen.addColorStop(0, 'rgba(255,255,255,0.45)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.25)');
  path();
  g.fillStyle = sheen;
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  path();
  g.stroke();
  const t = String(text);
  g.font = `italic 900 ${t.length > 2 ? 38 : t.length > 1 ? 50 : 66}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.strokeText(t, 64, 69);
  g.fillStyle = '#ffffff';
  g.fillText(t, 64, 69);
  return tex(c, { aniso: 1 });
}

export class Scoreboard {
  constructor(teams) {
    this.teams = teams;
    this.c = canvas(1024, 512);
    this.g = this.c.getContext('2d');
    this.texture = tex(this.c, { aniso: 4 });
    this.key = '';
  }

  update(score, q, clock, msg = '') {
    const key = `${score}|${q}|${clock}|${msg}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    g.fillStyle = '#05070b';
    g.fillRect(0, 0, 1024, 512);
    // led grid
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let x = 0; x < 1024; x += 8) g.fillRect(x, 0, 1, 512);
    for (let y = 0; y < 512; y += 8) g.fillRect(0, y, 1024, 1);
    this.teams.forEach((t, i) => {
      const x = i === 0 ? 40 : 552;
      g.fillStyle = t.colors.primary;
      g.fillRect(x, 40, 432, 120);
      g.fillStyle = i === 0 ? '#ffffff' : t.colors.light;
      g.font = `italic 900 84px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(t.name, x + 216, 104);
      g.fillStyle = '#ffd23f';
      g.font = `900 190px ${FONT}`;
      g.fillText(String(score[i]), x + 216, 300);
    });
    g.fillStyle = '#ff6a00';
    g.font = `italic 900 60px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(msg || `${q}  ${clock}`, 512, 450);
    this.texture.needsUpdate = true;
  }
}
