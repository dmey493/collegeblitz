// SVG play diagrams for the play-select grid, drawn straight from the playbook data.
import { FORMATIONS, OL_SPOTS, DEF_BASE_ALIGN } from '../sim/playbook.js';

const X = (dx) => 50 + dx * 2.45;
const Y = (dz) => 50 - dz * 1.22;
const clampY = (y) => Math.max(4, Math.min(63, y));
const clampX = (x) => Math.max(4, Math.min(96, x));

function routePoints(start, route) {
  const side = start[0] < 0 ? 1 : -1;
  const pts = [[start[0], start[1]]];
  for (const [a, b] of route.pts) pts.push(route.abs ? [start[0] + a, start[1] + b] : [start[0] + side * a, start[1] + b]);
  return pts;
}

function poly(pts, color, { dashed = false, arrow = true, width = 1.6 } = {}) {
  const d = pts.map(([dx, dz], i) => `${i ? 'L' : 'M'}${clampX(X(dx)).toFixed(1)},${clampY(Y(dz)).toFixed(1)}`).join(' ');
  let s = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dashed ? ' stroke-dasharray="2.5 2"' : ''}/>`;
  if (arrow && pts.length > 1) {
    const [ax, az] = pts[pts.length - 2];
    const [bx, bz] = pts[pts.length - 1];
    const x2 = clampX(X(bx));
    const y2 = clampY(Y(bz));
    const ang = Math.atan2(y2 - clampY(Y(az)), x2 - clampX(X(ax)));
    const l = 3.4;
    const p1 = [x2 - Math.cos(ang - 0.5) * l, y2 - Math.sin(ang - 0.5) * l];
    const p2 = [x2 - Math.cos(ang + 0.5) * l, y2 - Math.sin(ang + 0.5) * l];
    s += `<path d="M${p1[0].toFixed(1)},${p1[1].toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)} L${p2[0].toFixed(1)},${p2[1].toFixed(1)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
  }
  return s;
}

const circle = (dx, dz, fill, stroke = '#0b0d12') => `<circle cx="${X(dx).toFixed(1)}" cy="${Y(dz).toFixed(1)}" r="2.6" fill="${fill}" stroke="${stroke}" stroke-width="0.9"/>`;
const square = (dx, dz, fill) => `<rect x="${(X(dx) - 2.5).toFixed(1)}" y="${(Y(dz) - 2.5).toFixed(1)}" width="5" height="5" rx="0.8" fill="${fill}" stroke="#0b0d12" stroke-width="0.9"/>`;
const cross = (dx, dz, color) => {
  const x = X(dx);
  const y = clampY(Y(dz));
  return `<path d="M${x - 2.4},${y - 2.4} L${x + 2.4},${y + 2.4} M${x + 2.4},${y - 2.4} L${x - 2.4},${y + 2.4}" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`;
};

function frame(inner) {
  return `<svg viewBox="0 0 100 66" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="100" height="66" rx="3" fill="#1f5c1a"/>
  <g stroke="rgba(255,255,255,0.13)" stroke-width="0.5">${[0, 1, 2, 3, 4].map((i) => `<line x1="0" x2="100" y1="${(50 - i * 10 * 1.22).toFixed(1)}" y2="${(50 - i * 10 * 1.22).toFixed(1)}"/>`).join('')}</g>
  <line x1="0" x2="100" y1="50" y2="50" stroke="#3d8bff" stroke-width="0.9" opacity="0.9"/>
  ${inner}</svg>`;
}

export function offenseDiagram(play, color = '#ffd23f') {
  if (play.special) {
    const label = play.id === 'punt' ? 'PUNT' : 'FIELD GOAL';
    const f = FORMATIONS[play.form];
    let s = '';
    for (const k of ['C', 'LG', 'RG']) s += square(OL_SPOTS[k][0], OL_SPOTS[k][1], '#e9edf3');
    for (const k of Object.keys(f)) s += circle(f[k][0], f[k][1], k === 'K' ? color : '#e9edf3');
    if (play.id === 'punt') s += poly([[0, -12], [0, 26]], color, { dashed: true });
    else s += poly([[-1.2, -9.4], [0, 34]], color, { dashed: true });
    s += `<text x="50" y="11" text-anchor="middle" font-size="9" font-weight="900" font-style="italic" fill="#fff" opacity="0.9">${label}</text>`;
    return frame(s);
  }
  const f = FORMATIONS[play.form];
  let s = '';
  if (play.type === 'pass') {
    for (const k of ['WR1', 'WR2', 'RB']) {
      const r = play.routes[k];
      if (!r) continue;
      s += poly(routePoints(f[k], r), k === 'RB' ? '#9be7ff' : color);
    }
  } else {
    const carrierStart = f[play.carrier];
    s += poly([carrierStart, ...play.path], '#ff8a3d', { width: 2.2 });
    if (play.rbPath) s += poly([f.RB, ...play.rbPath], '#e9edf3', { dashed: true, arrow: false });
  }
  for (const k of ['C', 'LG', 'RG']) s += square(OL_SPOTS[k][0], OL_SPOTS[k][1], '#e9edf3');
  for (const k of ['WR1', 'WR2', 'RB', 'QB']) s += circle(f[k][0], f[k][1], k === 'QB' ? '#ffffff' : '#e9edf3');
  return frame(s);
}

export function defenseDiagram(play) {
  const f = FORMATIONS.gun;
  let s = '';
  for (const k of ['C', 'LG', 'RG']) s += square(OL_SPOTS[k][0], OL_SPOTS[k][1], 'rgba(233,237,243,0.45)');
  for (const k of ['WR1', 'WR2', 'RB', 'QB']) s += circle(f[k][0], f[k][1], 'rgba(233,237,243,0.45)', 'rgba(0,0,0,0.3)');
  const spots = {};
  for (const k of Object.keys(play.a)) {
    let p;
    if (play.align && play.align[k]) p = play.align[k];
    else if (play.a[k].t === 'man' && f[play.a[k].target]) {
      const t = f[play.a[k].target];
      p = k.startsWith('CB') ? [t[0] + (t[0] > 0 ? -1 : 1), play.cbDepth || 5.5] : [t[0] * 0.55, 4.6];
    } else if (k.startsWith('CB')) p = [k === 'CB1' ? -12 : 12, play.cbDepth || 6.5];
    else p = DEF_BASE_ALIGN[k];
    spots[k] = p;
  }
  for (const k of Object.keys(play.a)) {
    const a = play.a[k];
    const p = spots[k];
    if (a.t === 'rush') s += poly([p, [p[0] * 0.3, -3.6]], '#ff4b3a', { width: 1.6 });
    else if (a.t === 'zone') {
      const z = a.at;
      s += `<ellipse cx="${X(z[0]).toFixed(1)}" cy="${clampY(Y(z[1])).toFixed(1)}" rx="${a.at[1] > 13 ? 9 : 7}" ry="4" fill="rgba(80,170,255,0.28)" stroke="rgba(120,200,255,0.8)" stroke-width="0.7"/>`;
      s += poly([p, z], 'rgba(150,215,255,0.9)', { arrow: false, width: 1 });
    } else if (a.t === 'man') {
      const t = f[a.target];
      s += poly([p, [t[0], t[1] + 1.8]], '#ffd23f', { dashed: true, arrow: false, width: 1.1 });
    } else if (a.t === 'spy') {
      s += poly([p, [0, -2.5]], '#c08bff', { dashed: true, arrow: false, width: 1.1 });
    }
  }
  for (const k of Object.keys(spots)) s += cross(spots[k][0], spots[k][1], '#ffffff');
  return frame(s);
}
