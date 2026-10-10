// Procedural canvas textures: everything visual is generated at startup,
// so the game ships with zero image files.
import * as THREE from 'three';

export const FONT = 'Kanit, "Arial Black", Impact, sans-serif';

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
    const v = 170 + Math.floor(r() * 85);
    g.fillStyle = `rgb(${v},${v},${v})`;
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
