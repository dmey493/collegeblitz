// Ball, particles, markers and other juice.
import * as THREE from 'three';
import { HALF_W } from '../sim/constants.js';
import { glowTexture, labelTexture, iconTexture, ICON_COLORS } from './textures.js';

// ------------------------------------------------------------------ ball
export function makeBall() {
  const L = 0.31 * 1.45;
  const R = 0.096 * 1.45;
  const pts = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = (t - 0.5) * L;
    const r = R * Math.pow(Math.max(0, 1 - Math.pow((2 * y) / L, 2)), 0.72);
    pts.push(new THREE.Vector2(Math.max(r, 0.0001), y));
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), new THREE.MeshStandardMaterial({ color: '#7a3b18', roughness: 0.5, metalness: 0.05 }));
  body.castShadow = true;
  g.add(body);
  const white = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.5 });
  for (const s of [-1, 1]) {
    const y = s * L * 0.3;
    const rr = R * Math.pow(1 - Math.pow((2 * y) / L, 2), 0.72);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr * 1.01, 0.012, 6, 20), white);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  const lace = new THREE.Mesh(new THREE.BoxGeometry(0.02, L * 0.38, 0.02), white);
  lace.position.set(0, 0, R * 0.98);
  g.add(lace);
  for (let i = 0; i < 6; i++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.02), white);
    st.position.set(0, (i - 2.5) * L * 0.065, R * 1.0);
    g.add(st);
  }
  // long axis along +z
  const holder = new THREE.Group();
  g.rotation.x = Math.PI / 2;
  holder.add(g);
  holder.userData.spinner = g;
  return holder;
}

// ------------------------------------------------------------------ particles
const VERT = `
attribute float size;
attribute float alpha;
attribute vec3 color;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vColor = color;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}`;

class ParticlePool {
  constructor(max, additive, map) {
    this.max = max;
    this.n = 0;
    this.p = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uScale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({ life: 1, ...o, age: 0, color: new THREE.Color(o.color || '#ffffff') });
  }

  update(dt) {
    const P = this.p;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      q.age += dt;
      if (q.age >= q.life) continue;
      q.vy -= (q.g ?? 9) * dt;
      const drag = q.drag ?? 0.6;
      q.vx *= 1 - drag * dt;
      q.vz *= 1 - drag * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      if (q.y < 0.03 && !q.noFloor) {
        q.y = 0.03;
        q.vy *= -0.3;
        q.vx *= 0.6;
        q.vz *= 0.6;
      }
      if (q.flutter) q.x += Math.sin(q.age * 9 + q.seed) * q.flutter * dt;
      P[w++] = q;
    }
    P.length = w;
    for (let i = 0; i < w; i++) {
      const q = P[i];
      const k = q.age / q.life;
      this.pos[i * 3] = q.x;
      this.pos[i * 3 + 1] = q.y;
      this.pos[i * 3 + 2] = q.z;
      const fade = q.fadeColor ? 1 - k : 1;
      this.col[i * 3] = q.color.r * fade;
      this.col[i * 3 + 1] = q.color.g * fade;
      this.col[i * 3 + 2] = q.color.b * fade;
      this.size[i] = q.size * (q.grow ? 1 + k * q.grow : 1);
      this.alpha[i] = (q.alpha ?? 1) * (1 - k * k);
    }
    this.geo.setDrawRange(0, w);
    for (const n of ['position', 'color', 'size', 'alpha']) this.geo.attributes[n].needsUpdate = true;
  }
}

function squareTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(3, 3, 10, 10);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const glow = glowTexture();
    this.add = new ParticlePool(1800, true, glow);
    this.norm = new ParticlePool(1500, false, squareTexture());
    scene.add(this.add.points, this.norm.points);
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 40);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.glow = glow;
  }

  setScale(h) {
    this.add.mat.uniforms.uScale.value = h * 0.9;
    this.norm.mat.uniforms.uScale.value = h * 0.9;
  }

  burst(x, y, z, { n = 16, color = '#ffffff', speed = 6, size = 0.6, life = 0.6, up = 3, additive = true, g = 9 } = {}) {
    const pool = additive ? this.add : this.norm;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      pool.spawn({
        x, y, z,
        vx: Math.cos(a) * sp, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * sp,
        color: Array.isArray(color) ? color[i % color.length] : color,
        size: size * (0.6 + Math.random() * 0.8), life: life * (0.6 + Math.random() * 0.6), g,
      });
    }
  }

  turf(x, z, n = 14) {
    this.burst(x, 0.15, z, { n, color: ['#3f8f2f', '#2f6e22', '#6b4a2b', '#4fa83a'], speed: 3.5, size: 0.16, life: 0.9, up: 4, additive: false, g: 14 });
  }

  impact(x, y, z, big) {
    this.burst(x, y, z, { n: big ? 34 : 12, color: big ? ['#ffffff', '#ffe36b', '#ff9a1a'] : ['#ffffff', '#fff2b0'], speed: big ? 11 : 5, size: big ? 1.0 : 0.55, life: big ? 0.55 : 0.35, up: big ? 5 : 2, g: 4 });
    this.ring(x, z, big ? '#ffd23f' : '#ffffff', big ? 4.5 : 2.2);
    this.turf(x, z, big ? 22 : 10);
  }

  ring(x, z, color, size = 3) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.position.set(x, 0.05, z);
    m.scale.setScalar(0.2);
    this.scene.add(m);
    this.rings.push({ m, age: 0, life: 0.5, size });
  }

  confetti(x, z, colors) {
    for (let i = 0; i < 220; i++) {
      this.norm.spawn({
        x: x + (Math.random() - 0.5) * 12, y: 7 + Math.random() * 7, z: z + (Math.random() - 0.5) * 12,
        vx: (Math.random() - 0.5) * 4, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 4,
        color: colors[i % colors.length], size: 0.11, life: 3.5, g: 2.2, drag: 1.5, flutter: 3, seed: Math.random() * 10,
      });
    }
  }

  fireworks(x, z, colors) {
    for (let k = 0; k < 5; k++) {
      const cx = x + (Math.random() - 0.5) * 30;
      const cz = z + (Math.random() - 0.5) * 10;
      const cy = 28 + Math.random() * 12;
      const col = colors[k % colors.length];
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        const b = Math.acos(2 * Math.random() - 1);
        const sp = 8 + Math.random() * 4;
        this.add.spawn({
          x: cx, y: cy, z: cz,
          vx: Math.sin(b) * Math.cos(a) * sp, vy: Math.cos(b) * sp, vz: Math.sin(b) * Math.sin(a) * sp,
          color: col, size: 2.2, life: 1.4 + Math.random() * 0.5, g: 4, drag: 0.9, noFloor: true,
        });
      }
    }
  }

  flame(x, y, z, scale = 1) {
    this.add.spawn({
      x: x + (Math.random() - 0.5) * 0.5 * scale, y: y + Math.random() * 0.3, z: z + (Math.random() - 0.5) * 0.5 * scale,
      vx: (Math.random() - 0.5) * 0.6, vy: 2.5 + Math.random() * 2, vz: (Math.random() - 0.5) * 0.6,
      color: Math.random() < 0.5 ? '#ff7a10' : '#ffc23a', size: (0.9 + Math.random() * 0.7) * scale, life: 0.45 + Math.random() * 0.25,
      g: -1, drag: 1, fadeColor: true, noFloor: true,
    });
  }

  trail(x, y, z, fire) {
    this.add.spawn({
      x, y, z, vx: 0, vy: 0, vz: 0,
      color: fire ? (Math.random() < 0.5 ? '#ff6a00' : '#ffd23f') : '#dfe9ff', size: fire ? 1.1 : 0.45, life: fire ? 0.4 : 0.22, g: 0, noFloor: true, alpha: fire ? 1 : 0.55,
    });
  }

  update(dt) {
    this.add.update(dt);
    this.norm.update(dt);
    this.rings = this.rings.filter((r) => {
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) {
        this.scene.remove(r.m);
        r.m.material.dispose();
        return false;
      }
      r.m.scale.setScalar(0.2 + k * r.size);
      r.m.material.opacity = 0.9 * (1 - k);
      return true;
    });
  }
}

// ------------------------------------------------------------------ markers
export class Markers {
  constructor(scene, teams) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    // line of scrimmage + first down line
    const lineGeo = new THREE.PlaneGeometry(HALF_W * 2, 0.32);
    lineGeo.rotateX(-Math.PI / 2);
    const lineMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.los = new THREE.Mesh(lineGeo, lineMat('#3d8bff'));
    this.fd = new THREE.Mesh(lineGeo, lineMat('#ffd400'));
    this.los.position.y = this.fd.position.y = 0.02;
    this.group.add(this.los, this.fd);
    // control rings per team
    const ringGeo = new THREE.RingGeometry(0.62, 0.82, 36);
    ringGeo.rotateX(-Math.PI / 2);
    this.ctrl = teams.map((t, i) => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: i === 0 ? '#ffe04a' : '#4ae0ff', transparent: true, opacity: 0.95, depthWrite: false }));
      ring.position.y = 0.04;
      g.add(ring);
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(i === 0 ? '1P' : '2P', i === 0 ? '#ffe04a' : '#4ae0ff'), depthTest: false, transparent: true }));
      tag.scale.set(1.0, 0.5, 1);
      tag.position.y = 2.55;
      tag.renderOrder = 20;
      g.add(tag);
      g.visible = false;
      g.userData = { ring, tag };
      this.group.add(g);
      return g;
    });
    // pass target marker
    const tg = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 3), new THREE.MeshBasicMaterial({ color: '#ff3b3b', depthTest: false, transparent: true }));
    cone.rotation.x = Math.PI;
    cone.position.y = 3.0;
    cone.renderOrder = 21;
    tg.add(cone);
    const tring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 3, 1), new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    tring.rotation.x = -Math.PI / 2;
    tring.position.y = 0.05;
    tg.add(tring);
    tg.visible = false;
    tg.userData = { cone, tring };
    this.target = tg;
    this.group.add(tg);
    // receiver pass icons (left / middle / right key)
    this.iconTex = new Map();
    this.icons = [0, 1, 2].map(() => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
      sp.scale.set(1.25, 1.25, 1);
      sp.renderOrder = 22;
      sp.visible = false;
      sp.userData = { key: '' };
      this.group.add(sp);
      return sp;
    });
    // ball shadow
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 0.02;
    this.group.add(this.ballShadow);
    this.t = 0;
  }

  setIcon(n, label, round) {
    const sp = this.icons[n];
    const key = `${label}|${round ? 1 : 0}|${n}`;
    if (sp.userData.key === key) return;
    sp.userData.key = key;
    if (!this.iconTex.has(key)) this.iconTex.set(key, iconTexture(label, ICON_COLORS[n], round));
    sp.material.map = this.iconTex.get(key);
    sp.material.needsUpdate = true;
  }

  setTeamColors(teamIdx, color) {
    this.ctrl[teamIdx].userData.ring.material.color.set(color);
  }

  update(dt) {
    this.t += dt;
    const pulse = 1 + Math.sin(this.t * 7) * 0.08;
    for (const c of this.ctrl) c.userData.ring.scale.setScalar(pulse);
    this.target.userData.cone.rotation.y += dt * 4;
    this.target.userData.cone.position.y = 2.95 + Math.sin(this.t * 6) * 0.12;
    for (let n = 0; n < 3; n++) this.icons[n].userData.bob = Math.sin(this.t * 5 + n * 1.3) * 0.1;
  }
}
