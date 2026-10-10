// Stadium bowl, crowd, walls, light towers, night sky, scoreboards.
import * as THREE from 'three';
import { crowdTexture, lampTexture, glowTexture, wallTexture, Scoreboard } from './textures.js';

// superellipse path |x/a|^n + |z/b|^n = 1, sampled by angle
function ringPoint(a, b, n, t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  const z = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
  return [x, z];
}

function deck(inner, outer, n, segs, mats, pickMat, uScale = 10) {
  // inner/outer: {a, b, y}
  const groups = mats.map(() => ({ pos: [], uv: [], idx: [], v: 0 }));
  let u = 0;
  let prev = null;
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const [ix, iz] = ringPoint(inner.a, inner.b, n, t);
    const [ox, oz] = ringPoint(outer.a, outer.b, n, t);
    if (prev) u += Math.hypot(ix - prev[0], iz - prev[1]) / uScale;
    if (i > 0) {
      const tm = ((i - 0.5) / segs) * Math.PI * 2;
      const gi = pickMat(tm);
      const G = groups[gi];
      const [pix, piz, pox, poz, pu] = prev.slice(2);
      G.pos.push(pix, inner.y, piz, ix, inner.y, iz, ox, outer.y, oz, pox, outer.y, poz);
      G.uv.push(pu, 0, u, 0, u, 1, pu, 1);
      const v = G.v;
      G.idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
      G.v += 4;
    }
    prev = [ix, iz, ix, iz, ox, oz, u];
  }
  const meshes = [];
  groups.forEach((G, k) => {
    if (!G.v) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
    geo.setIndex(G.idx);
    geo.computeVertexNormals();
    meshes.push(new THREE.Mesh(geo, mats[k]));
  });
  return meshes;
}

export class Stadium {
  constructor(teams) {
    this.group = new THREE.Group();
    this.group.name = 'stadium';
    this.teams = teams;
    this.crowdMats = [];
    this.hype = 0;
    this.t = 0;
    this.build();
  }

  build() {
    const g = this.group;
    const [home, away] = this.teams;
    const mixed = [home.colors.crowd[0], away.colors.crowd[0], home.colors.crowd[2], away.colors.crowd[2], '#c9c9c9'];
    const palettes = [home.colors.crowd, away.colors.crowd, mixed];
    const crowdTex = palettes.map((p, i) => [crowdTexture(p, 11 + i * 7, 0), crowdTexture(p, 11 + i * 7, 1)]);
    const mats = crowdTex.map(([a]) => new THREE.MeshStandardMaterial({ map: a, roughness: 1, emissive: '#ffffff', emissiveMap: a, emissiveIntensity: 0.28, side: THREE.DoubleSide }));
    this.crowdTex = crowdTex;
    this.crowdMats = mats;
    // +x side = home crowd, -x side = visitors, ends mixed
    const pick = (t) => {
      const c = Math.cos(t);
      if (c > 0.45) return 0;
      if (c < -0.45) return 1;
      return 2;
    };
    const N = 5;
    const segs = 160;
    const lower = deck({ a: 35, b: 72, y: 2.2 }, { a: 58, b: 92, y: 17 }, N, segs, mats, pick, 11);
    const upper = deck({ a: 61, b: 95, y: 21 }, { a: 84, b: 116, y: 41 }, N, segs, mats, pick, 11);
    for (const m of [...lower, ...upper]) {
      m.receiveShadow = false;
      g.add(m);
    }

    // walls and fascia bands
    const wallTex = wallTexture(home, away);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, emissive: '#ffffff', emissiveMap: wallTex, emissiveIntensity: 0.35, side: THREE.DoubleSide });
    for (const m of deck({ a: 35, b: 72, y: 0 }, { a: 35, b: 72, y: 2.2 }, N, segs, [wallMat], () => 0, 24)) g.add(m);
    const fasciaMat = new THREE.MeshStandardMaterial({ color: home.colors.dark, roughness: 0.7, emissive: home.colors.primary, emissiveIntensity: 0.15, side: THREE.DoubleSide });
    for (const m of deck({ a: 58, b: 92, y: 17 }, { a: 61, b: 95, y: 21 }, N, segs, [fasciaMat], () => 0)) g.add(m);
    const rimMat = new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.9, side: THREE.DoubleSide });
    for (const m of deck({ a: 84, b: 116, y: 41 }, { a: 86, b: 118, y: 47 }, N, segs, [rimMat], () => 0)) g.add(m);
    // concourse floor so you can't see through the gap
    const gapMat = new THREE.MeshStandardMaterial({ color: '#0d0f13', roughness: 1, side: THREE.DoubleSide });
    for (const m of deck({ a: 58, b: 92, y: 17 }, { a: 61, b: 95, y: 17 }, N, segs, [gapMat], () => 0)) g.add(m);

    // ---- light towers
    const lamp = lampTexture();
    const glow = glowTexture();
    this.glows = [];
    const poleMat = new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.6, metalness: 0.5 });
    const bankMat = new THREE.MeshStandardMaterial({ map: lamp, emissive: '#ffffff', emissiveMap: lamp, emissiveIntensity: 2.2, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * 74;
        const z = sz * 104;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 66, 10), poleMat);
        pole.position.set(x, 33, z);
        g.add(pole);
        const bank = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 1.2), bankMat);
        bank.position.set(x, 68, z);
        bank.lookAt(0, 0, 0);
        g.add(bank);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#fff3d6', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
        sp.scale.set(70, 50, 1);
        sp.position.set(x * 0.985, 68, z * 0.985);
        g.add(sp);
        this.glows.push(sp);
      }
    }

    // ---- sky
    const skyGeo = new THREE.SphereGeometry(900, 32, 16);
    const colors = [];
    const top = new THREE.Color('#02040b');
    const mid = new THREE.Color('#0b1430');
    const hor = new THREE.Color('#2b2650');
    const p = skyGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 900;
      const c = y > 0.25 ? mid.clone().lerp(top, Math.min(1, (y - 0.25) / 0.6)) : hor.clone().lerp(mid, Math.max(0, y / 0.25));
      colors.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10;
    g.add(sky);
    // stars
    const starPos = [];
    for (let i = 0; i < 700; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * 0.45 * Math.PI;
      const r = 850;
      starPos.push(Math.cos(th) * Math.cos(ph) * r, Math.sin(ph) * r * 0.9 + 60, Math.sin(th) * Math.cos(ph) * r);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    g.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#cfd8ff', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
    // light haze glowing over the bowl
    const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#3a3f6a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, fog: false }));
    haze.scale.set(700, 260, 1);
    haze.position.set(0, 90, 0);
    g.add(haze);

    // ---- scoreboards over both end zones
    this.scoreboard = new Scoreboard(this.teams);
    this.scoreboard.update([0, 0], '1ST', '2:00');
    const sbMat = new THREE.MeshBasicMaterial({ map: this.scoreboard.texture, toneMapped: false });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.7 });
    for (const s of [-1, 1]) {
      const sb = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(46, 25, 2), frameMat);
      sb.add(box);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(42, 21), sbMat);
      screen.position.z = 1.05;
      sb.add(screen);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(3, 30, 2), frameMat);
      leg.position.y = -26;
      sb.add(leg);
      sb.position.set(0, 58, s * 124);
      sb.rotation.y = s > 0 ? Math.PI : 0;
      g.add(sb);
    }
  }

  setScore(score, q, clock, msg) {
    this.scoreboard.update(score, q, clock, msg);
  }

  cheer(amount) {
    this.hype = Math.max(this.hype, amount);
  }

  update(dt) {
    this.t += dt;
    this.hype = Math.max(0, this.hype - dt * 0.25);
    // crowd bounce: swap frames faster and jitter when hyped
    const rate = 1.2 + this.hype * 10;
    const frame = Math.floor(this.t * rate) % 2;
    this.crowdMats.forEach((m, i) => {
      const tex = this.crowdTex[i][this.hype > 0.15 ? frame : 0];
      if (m.map !== tex) {
        m.map = tex;
        m.emissiveMap = tex;
        m.needsUpdate = true;
      }
    });
    for (const s of this.glows) s.material.opacity = 0.82 + Math.sin(this.t * 3.1 + s.position.x) * 0.04;
  }
}
