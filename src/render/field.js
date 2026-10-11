// The playing surface: mowed stripes, college markings, end zones, pylons, goal posts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF_W, GOAL, END, POST_HALF, CROSSBAR as GAME_CROSSBAR } from '../sim/constants.js';
import { PLAYER_SCALE } from './player-model.js';

// heights are drawn at the players' scale (see PLAYER_SCALE), so kicks clear the bar as they do
// in the game
const CROSSBAR = GAME_CROSSBAR * PLAYER_SCALE;
import { grassTexture, numberTexture, endZoneTexture, midfieldTexture, turfWearTexture } from './textures.js';

const LINE_Y = 0.012;

function flat(w, h, cx, cz, rotY = 0, y = LINE_Y) {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateX(-Math.PI / 2);
  if (rotY) g.rotateY(rotY);
  g.translate(cx, y, cz);
  return g;
}

function decalMaterial(map, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    alphaTest: 0.25,
    roughness: 0.85,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    ...extra,
  });
}

export function buildField(teams) {
  const group = new THREE.Group();
  group.name = 'field';
  const grass = grassTexture();

  // ---- surrounding turf (sideline areas)
  const outerMat = new THREE.MeshStandardMaterial({ color: '#2a6420', map: grass, roughness: 1 });
  const outerTex = grass.clone();
  outerTex.repeat.set(30, 40);
  outerTex.needsUpdate = true;
  outerMat.map = outerTex;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(200, 260), outerMat);
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  outer.receiveShadow = true;
  group.add(outer);

  // ---- striped field of play (5-yard bands)
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const light = new THREE.Color('#3f8f33');
  const dark = new THREE.Color('#337a29');
  const W = HALF_W + 0.7;
  let v = 0;
  for (let i = 0; i < 20; i++) {
    const z0 = -GOAL + i * 5;
    const z1 = z0 + 5;
    const c = i % 2 ? dark : light;
    const quad = [[-W, z0], [W, z0], [W, z1], [-W, z1]];
    for (const [x, z] of quad) {
      pos.push(x, 0, z);
      col.push(c.r, c.g, c.b);
      uv.push(x / 7, z / 7);
    }
    idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    v += 4;
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fg.setIndex(idx);
  fg.computeVertexNormals();
  const fieldMat = new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 0.92, metalness: 0 });
  const fieldMesh = new THREE.Mesh(fg, fieldMat);
  fieldMesh.receiveShadow = true;
  group.add(fieldMesh);

  // ---- wear: dirt and divots laid over the grass, under the paint
  const wear = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_W * 2, GOAL * 2),
    new THREE.MeshStandardMaterial({ map: turfWearTexture(HALF_W, GOAL), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 }),
  );
  wear.rotation.x = -Math.PI / 2;
  wear.position.y = 0.0015;
  wear.receiveShadow = true;
  group.add(wear);

  // ---- end zones (team 0 defends -z, team 1 defends +z)
  const ezGeoW = HALF_W * 2;
  for (const t of [0, 1]) {
    const zc = t === 0 ? -(GOAL + 5) : GOAL + 5;
    const rot = t === 0 ? 0 : Math.PI;
    const m = new THREE.Mesh(
      flat(ezGeoW, 10, 0, zc, rot, 0.004),
      new THREE.MeshStandardMaterial({ map: endZoneTexture(teams[t]), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    m.receiveShadow = true;
    group.add(m);
  }

  // ---- paint
  const lines = [];
  for (let z = -GOAL; z <= GOAL; z += 5) {
    const w = Math.abs(z) === GOAL ? 0.22 : 0.11;
    lines.push(flat(HALF_W * 2 - 0.3, w, 0, z));
  }
  for (let z = -GOAL + 1; z < GOAL; z++) {
    if (z % 5 === 0) continue;
    for (const s of [-1, 1]) {
      lines.push(flat(0.67, 0.1, s * 7.0, z));
      lines.push(flat(0.67, 0.1, s * (HALF_W - 0.6), z));
    }
  }
  // 3-yard conversion marks
  for (const s of [-1, 1]) lines.push(flat(1, 0.11, 0, s * (GOAL - 3)));
  // sidelines / end lines (2 ft border)
  for (const s of [-1, 1]) {
    lines.push(flat(0.67, END * 2 + 1.34, s * (HALF_W + 0.335), 0));
    lines.push(flat(HALF_W * 2 + 1.34, 0.67, 0, s * (END + 0.335)));
  }
  const paint = new THREE.Mesh(
    mergeGeometries(lines),
    new THREE.MeshStandardMaterial({
      color: '#f5f5f2', roughness: 0.85, emissive: '#ffffff', emissiveIntensity: 0.06,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }),
  );
  paint.receiveShadow = true;
  group.add(paint);

  // ---- yard numbers + direction arrows
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, 0.42);
  arrowShape.lineTo(0.36, -0.3);
  arrowShape.lineTo(-0.36, -0.3);
  arrowShape.closePath();
  const arrows = [];
  for (let z = -40; z <= 40; z += 10) {
    const label = String(50 - Math.abs(z));
    const mat = decalMaterial(numberTexture(label));
    for (const s of [-1, 1]) {
      const x = s * (HALF_W - 10);
      const rot = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(new THREE.Mesh(flat(3.6, 2.25, x, z, rot), mat));
      if (z !== 0) {
        const g = new THREE.ShapeGeometry(arrowShape);
        g.rotateX(-Math.PI / 2);
        // point toward the nearer goal
        g.rotateY(z < 0 ? 0 : Math.PI);
        g.translate(x + s * 0.55, LINE_Y, z + Math.sign(z) * 2.35);
        arrows.push(g);
      }
    }
  }
  group.add(new THREE.Mesh(mergeGeometries(arrows), new THREE.MeshStandardMaterial({ color: '#f5f5f2', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 })));

  // ---- midfield state logo (home team)
  group.add(new THREE.Mesh(flat(12.5, 12.5, 0, 0, Math.PI, 0.008), decalMaterial(midfieldTexture(teams[0]), { alphaTest: 0.05, opacity: 0.9 })));

  // ---- pylons
  const pylonMat = new THREE.MeshStandardMaterial({ color: '#ff6a00', roughness: 0.6, emissive: '#ff4400', emissiveIntensity: 0.25 });
  const pylonGeo = new THREE.BoxGeometry(0.16, 0.55, 0.16);
  for (const sx of [-1, 1]) {
    for (const z of [-END, -GOAL, GOAL, END]) {
      const p = new THREE.Mesh(pylonGeo, pylonMat);
      p.position.set(sx * (HALF_W + 0.1), 0.275, z);
      p.castShadow = true;
      group.add(p);
    }
  }

  // ---- goal posts
  for (const s of [-1, 1]) group.add(goalPost(s, teams[s > 0 ? 1 : 0]));
  return group;
}

function goalPost(s, team) {
  const g = new THREE.Group();
  // transparent so the renderer can fade the posts when the camera sits behind them
  const yellow = new THREE.MeshStandardMaterial({ color: '#ffd400', roughness: 0.35, metalness: 0.3, emissive: '#ffb000', emissiveIntensity: 0.12, transparent: true });
  const r = 0.09;
  const baseZ = s * (END + 2.2);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.6, r * 1.6, CROSSBAR + 0.4, 12), yellow);
  post.position.set(0, (CROSSBAR + 0.4) / 2, baseZ);
  g.add(post);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.4, r * 1.4, 2.2, 10), yellow);
  neck.rotation.x = Math.PI / 2;
  neck.position.set(0, CROSSBAR + 0.3, s * (END + 1.1));
  g.add(neck);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, POST_HALF * 2, 10), yellow);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, CROSSBAR, s * END);
  g.add(bar);
  const up = 10 * PLAYER_SCALE;
  const flagMat = new THREE.MeshBasicMaterial({ color: '#ff3b1f', side: THREE.DoubleSide, transparent: true });
  for (const x of [-POST_HALF, POST_HALF]) {
    const u = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, up, 10), yellow);
    u.position.set(x, CROSSBAR + up / 2, s * END);
    g.add(u);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.9), flagMat);
    flag.position.set(x, CROSSBAR + up - 0.45, s * END - 0.14);
    flag.rotation.y = Math.PI / 2;
    flag.name = 'streamer';
    g.add(flag);
  }
  const padMat = new THREE.MeshStandardMaterial({ color: team.colors.primary, roughness: 0.7, transparent: true });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 2.2, 16), padMat);
  pad.position.set(0, 1.1, baseZ);
  g.add(pad);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  g.name = 'goalpost';
  g.userData = { side: s, mats: [yellow, flagMat, padMat], fade: 1 };
  return g;
}
