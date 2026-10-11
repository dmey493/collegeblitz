// Scene setup and per-frame sync from a (possibly interpolated) game snapshot.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildField } from './field.js';
import { Stadium } from './stadium.js';
import { PlayerModel } from './player-model.js';
import { Effects, Markers, makeBall } from './effects.js';
import { CameraDirector } from './camera.js';
import { bodyOfSlot } from '../sim/player.js';
import { ROSTER_SLOTS, playerId } from '../sim/constants.js';

const tmpV = new THREE.Vector3();

export class GameRenderer {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = quality !== 'low';
    r.shadowMap.type = THREE.PCFShadowMap;
    this.r = r;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070d');
    this.scene.fog = new THREE.Fog('#151a33', 170, 560);
    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.3, 2000);
    this.director = new CameraDirector(this.camera);

    // lights: a night game under four towers
    this.hemi = new THREE.HemisphereLight('#a9bcff', '#26431c', 0.95);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight('#fff3df', 2.6);
    this.key.castShadow = quality !== 'low';
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 140;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.03;
    this.scene.add(this.key, this.key.target);
    const fill1 = new THREE.DirectionalLight('#cbd7ff', 0.85);
    fill1.position.set(-60, 50, 80);
    const fill2 = new THREE.DirectionalLight('#ffe7c6', 0.7);
    fill2.position.set(60, 45, -90);
    this.scene.add(fill1, fill2);

    const pmrem = new THREE.PMREMGenerator(r);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.effects = new Effects(this.scene);
    this.ball = makeBall();
    this.scene.add(this.ball);
    this.models = new Map();
    this.world = null;
    this.teams = null;
    this.time = 0;
    this.lastBall = new THREE.Vector3();
    this.ballSpin = 0;
    this.deadT = 0;
    this.lastPlayNo = -1;
    this.flashT = 0;
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    this.r.shadowMap.enabled = q !== 'low';
    this.key.castShadow = q !== 'low';
    this.resize();
  }

  setMatch(teams) {
    const key = teams.map((t) => t.id).join('-');
    if (this.teamKey === key) return;
    this.teamKey = key;
    this.teams = teams;
    if (this.world) {
      this.scene.remove(this.world);
      this.world.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    for (const m of this.models.values()) this.scene.remove(m.root);
    this.models.clear();
    if (this.markers) this.scene.remove(this.markers.group);
    this.world = new THREE.Group();
    this.field = buildField(teams);
    this.stadium = new Stadium(teams);
    this.world.add(this.field, this.stadium.group);
    this.scene.add(this.world);
    this.markers = new Markers(this.scene, teams);
    this.streamers = [];
    this.field.traverse((o) => {
      if (o.name === 'streamer') this.streamers.push(o);
    });
  }

  model(id) {
    let m = this.models.get(id);
    if (!m) {
      const team = id >= 16 ? 1 : 0;
      const slot = ROSTER_SLOTS[id % 16];
      const T = this.teams[team];
      m = new PlayerModel({ team: T, num: T.numbers[slot], body: bodyOfSlot(slot), slot, id, envMap: this.envMap });
      this.models.set(id, m);
      this.scene.add(m.root);
    }
    return m;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality === 'low' ? 1 : 2);
    this.r.setPixelRatio(pr);
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = THREE.MathUtils.clamp(49 * Math.max(1, 1.5 / this.camera.aspect), 49, 74);
    this.camera.updateProjectionMatrix();
    this.effects.setScale(h * pr);
  }

  // ---------------------------------------------------------------- events
  onEvents(events, view) {
    for (const e of events) {
      switch (e.k) {
        case 'tackle': {
          const big = !!e.big;
          this.effects.impact(e.x, 1.1, e.z, big);
          this.director.kick(big ? 0.9 : 0.18);
          if (big) {
            this.stadium.cheer(0.6);
            this.flashT = 0.12;
          }
          break;
        }
        case 'lateHit':
          this.effects.impact(e.x, 1, e.z, true);
          this.director.kick(0.5);
          break;
        case 'broken':
        case 'juke':
        case 'stiffArmed':
        case 'hurdled': {
          const p = view.byId.get(e.id);
          if (p) this.effects.burst(p.x, 1.2, p.z, { n: 12, color: ['#ffffff', '#9fd0ff'], speed: 4, size: 0.5, life: 0.35 });
          break;
        }
        case 'dive': {
          const p = view.byId.get(e.id);
          if (p) this.effects.turf(p.x, p.z, 8);
          break;
        }
        case 'td': {
          const p = view.byId.get(e.id);
          const T = this.teams[e.team];
          if (p) {
            this.effects.confetti(p.x, p.z, [T.colors.primary, T.colors.light, '#ffffff', '#ffd23f']);
            this.effects.fireworks(p.x * 0.3, p.z + Math.sign(p.z) * 12, [T.colors.primary, T.colors.light, '#ffd23f']);
          }
          this.stadium.cheer(1);
          this.director.kick(0.35);
          break;
        }
        case 'fgGood': {
          const T = this.teams[view.snap.pl ? view.snap.pl.off : 0];
          const z = view.snap.pl ? view.snap.pl.dir * 60 : 60;
          this.effects.fireworks(0, z, [T.colors.primary, T.colors.light, '#ffd23f']);
          this.stadium.cheer(0.8);
          break;
        }
        case 'int':
        case 'fumble':
        case 'recover': {
          const p = view.byId.get(e.id);
          if (p) this.effects.ring(p.x, p.z, '#ff3b3b', 4);
          this.stadium.cheer(0.7);
          break;
        }
        case 'catch': {
          const p = view.byId.get(e.id);
          if (p) this.effects.burst(p.x, 1.6, p.z, { n: 8, color: '#ffffff', speed: 2, size: 0.4, life: 0.3 });
          break;
        }
        case 'kick': {
          const p = view.byId.get(e.id);
          if (p) this.effects.burst(p.x, 0.4, p.z, { n: 10, color: '#ffffff', speed: 3, size: 0.4, life: 0.3 });
          break;
        }
        case 'firstDown':
          this.stadium.cheer(0.4);
          break;
        default:
          break;
      }
    }
  }

  // ---------------------------------------------------------------- frame
  render(view, dt, ctx = {}) {
    this.time += dt;
    const live = view && view.snap && view.snap.pl;
    const seen = new Set();
    const ctxAnim = { time: this.time, celebrateSeed: view && view.snap ? view.snap.n : 0 };

    if (ctx.mode === 'title') this.renderShowcase(dt, seen, ctxAnim);
    else if (live) {
      const pl = view.snap.pl;
      if (view.snap.n !== this.lastPlayNo) {
        this.lastPlayNo = view.snap.n;
        this.deadT = 0;
      }
      if (pl.ph === 'dead') this.deadT += dt;
      const flight = view.flight;
      for (const p of view.players) {
        const m = this.model(p.id);
        m.root.visible = true;
        seen.add(p.id);
        const carrying = view.ball.carrier === p.id && view.ball.state === 'held';
        const reach = view.ball.state === 'air' && flight && flight.intended === p.id && Math.hypot(view.ball.x - p.x, view.ball.z - p.z) < 3.5;
        m.update({ ...p, carrying, reach }, dt, ctxAnim);
      }
    }
    for (const [id, m] of this.models) if (!seen.has(id)) m.root.visible = false;

    this.updateBall(view, dt, ctx);
    this.updateMarkers(view, dt, ctx);
    this.updateFire(view, dt);

    // the key light (and its shadow frustum) follows the action
    const look = this.director.look;
    this.key.position.set(look.x + 18, 48, look.z - 12);
    this.key.target.position.set(look.x, 0, look.z);
    for (const s of this.streamers || []) s.rotation.y = Math.PI / 2 + Math.sin(this.time * 4 + s.position.x) * 0.35;

    if (this.stadium) {
      this.stadium.update(dt);
      if (view && view.snap) {
        const s = view.snap;
        const q = s.ot ? 'OT' : ['', '1ST', '2ND', '3RD', '4TH'][s.q] || '';
        const clk = `${Math.floor(s.clk / 60)}:${String(s.clk % 60).padStart(2, '0')}`;
        this.stadium.setScore(s.sc, q, clk, s.ph === 'final' ? 'FINAL' : '');
      }
    }
    this.director.update(view, dt, { ...ctx, deadT: this.deadT });
    this.effects.update(dt);
    this.markers && this.markers.update(dt);
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.r.toneMappingExposure = 1.05 + Math.max(0, this.flashT) * 4;
    } else this.r.toneMappingExposure = 1.05;
    if (!ctx.skipDraw) this.r.render(this.scene, this.camera);
  }

  renderShowcase(dt, seen, ctxAnim) {
    // both teams lined up at midfield for the title screen
    const order = ['WR1', 'LB1', 'QB', 'C', 'RB', 'DL1', 'WR2'];
    for (const team of [0, 1]) {
      order.forEach((slot, i) => {
        const id = playerId(team, slot);
        const m = this.model(id);
        m.root.visible = true;
        seen.add(id);
        const x = (i - 3) * 2.1 * (team === 0 ? 1 : -1);
        const z = team === 0 ? -2.2 - Math.abs(i - 3) * 0.35 : 2.2 + Math.abs(i - 3) * 0.35;
        const base = { x, z, y: 0, face: team === 0 ? 0.25 * Math.sign(-x) : Math.PI + 0.25 * Math.sign(x), vx: 0, vz: 0, state: 'stand', st: 1, turbo: false, fallFwd: false, carrying: false };
        // test hook: lets a screenshot script pose the lineup ({ state, st, vx, ... } per player)
        const extra = this.showcasePose ? this.showcasePose(team, slot, i, this.time) : null;
        if (extra && extra.hidden) m.root.visible = false;
        else m.update(extra ? { ...base, ...extra } : base, dt, ctxAnim);
      });
    }
  }

  updateBall(view, dt, ctx) {
    const B = this.ball;
    const sp = B.userData.spinner;
    if (ctx.mode === 'title' || !view || !view.snap || !view.snap.pl) {
      if (ctx.mode === 'title') {
        B.visible = true;
        B.position.set(0, 0.16, 0);
        B.rotation.set(0, this.time * 0.4, 0);
        sp.rotation.set(Math.PI / 2, 0, 0);
      } else B.visible = false;
      this.markers && (this.markers.ballShadow.visible = false);
      return;
    }
    B.visible = true;
    const b = view.ball;
    const prev = this.lastBall.clone();
    if (b.state === 'held' && this.models.has(b.carrier)) {
      const m = this.models.get(b.carrier);
      m.root.updateMatrixWorld(true);
      m.handWorld(tmpV);
      B.position.copy(tmpV);
      B.position.y += 0.05;
      B.rotation.set(0, m.root.rotation.y, 0);
      sp.rotation.set(Math.PI / 2 - 0.5, 0, 0);
    } else {
      B.position.set(b.x, Math.max(0.13, b.y), b.z);
      const vel = tmpV.copy(B.position).sub(prev);
      if (b.state === 'air' && vel.lengthSq() > 1e-6) {
        const yaw = Math.atan2(vel.x, vel.z);
        const pitch = -Math.atan2(vel.y, Math.hypot(vel.x, vel.z));
        if (b.kind === 'kick' || b.kind === 'fg') {
          this.ballSpin += dt * 14;
          B.rotation.set(0, yaw, 0);
          sp.rotation.set(Math.PI / 2 + this.ballSpin, 0, 0);
        } else {
          this.ballSpin += dt * 22;
          B.rotation.set(pitch, yaw, 0, 'YXZ');
          sp.rotation.set(Math.PI / 2, this.ballSpin, 0);
        }
      } else if (b.state === 'loose' || b.state === 'bounce') {
        this.ballSpin += dt * 10;
        sp.rotation.set(Math.PI / 2 + this.ballSpin, this.ballSpin * 0.7, 0);
      } else {
        B.rotation.set(0, 0, 0);
        sp.rotation.set(Math.PI / 2, 0, Math.PI / 2);
        B.position.y = 0.13;
      }
    }
    this.lastBall.copy(B.position);
    const sh = this.markers.ballShadow;
    sh.visible = b.state !== 'held';
    sh.position.set(B.position.x, 0.02, B.position.z);
    const hgt = Math.max(0, B.position.y);
    sh.scale.setScalar(1 + hgt * 0.06);
    sh.material.opacity = Math.max(0.1, 0.4 - hgt * 0.015);
    if (b.state === 'air' && b.kind !== 'snap') {
      const pl = view.snap.pl;
      const fire = pl && view.snap.fire[pl.ps] & 1;
      this.effects.trail(B.position.x, B.position.y, B.position.z, !!fire);
    }
  }

  updateMarkers(view, dt, ctx) {
    const M = this.markers;
    if (!M) return;
    const s = view && view.snap;
    const pl = s && s.pl;
    const show = !!(pl && ctx.mode !== 'title' && (pl.k === 'scrimmage' || pl.k === 'two'));
    M.los.visible = show && pl.ph !== 'dead';
    M.fd.visible = show && pl.fd !== null && pl.ph !== 'dead';
    if (show) {
      M.los.position.z = pl.los;
      if (pl.fd !== null) M.fd.position.z = pl.fd;
    } else if (s && s.ph === 'playSelect') {
      const dir = s.pos === 0 ? 1 : -1;
      M.los.visible = true;
      M.los.position.z = dir * (s.on - 50);
      M.fd.visible = s.fd < 100 && !s.conv;
      M.fd.position.z = dir * (s.fd - 50);
    }
    for (const t of [0, 1]) {
      const g = M.ctrl[t];
      const id = pl ? pl.ctl[t] : -1;
      const human = !!(pl && view && view.snap && (view.snap.hu ? view.snap.hu[t] : view.local && view.local[t]));
      const showRing = pl && id >= 0 && ctx.mode !== 'title' && human && pl.ph !== 'dead';
      g.visible = !!showRing;
      if (showRing) {
        const p = view.byId.get(id);
        if (p) {
          g.position.set(p.x, 0, p.z);
          g.userData.tag.position.y = 2.55 + p.y;
        } else g.visible = false;
      }
    }
    // pass icons over my receivers while my quarterback can still throw
    const icons = ctx.icons;
    const mine = pl && view.local && view.local[pl.off];
    const showIcons = !!(icons && mine && pl.ic && pl.cp && ctx.mode !== 'title' && s.ph === 'play');
    const single = showIcons && pl.ic.filter((x) => x >= 0).length === 1;
    for (let n = 0; n < 3; n++) {
      const sp = M.icons[n];
      const p = showIcons && pl.ic[n] >= 0 ? view.byId.get(pl.ic[n]) : null;
      sp.visible = !!p;
      if (!p) continue;
      // a lone receiver answers to every key; label him with the middle one
      M.setIcon(n, single ? icons.labels[1] : icons.labels[n], icons.round);
      sp.position.set(p.x, 3.05 + p.y + (sp.userData.bob || 0), p.z);
    }
    const tg = pl ? pl.tg.find((x, t) => x >= 0 && view.local && view.local[t]) : undefined;
    if (tg !== undefined && tg >= 0 && view.byId.get(tg)) {
      const p = view.byId.get(tg);
      M.target.visible = true;
      M.target.position.set(p.x, 0, p.z);
    } else M.target.visible = false;
  }

  updateFire(view, dt) {
    if (!view || !view.snap || !view.snap.pl) return;
    const s = view.snap;
    const pl = s.pl;
    for (const p of view.players) {
      const team = p.id >= 16 ? 1 : 0;
      const side = pl.ps === team ? 1 : 2;
      if (!(s.fire[team] & side)) continue;
      const carrier = view.ball.carrier === p.id;
      const ctrl = pl.ctl[team] === p.id;
      if (!(carrier || ctrl)) continue;
      if (Math.random() < 0.7) this.effects.flame(p.x, 0.4 + Math.random() * 1.6, p.z, 1);
    }
  }
}
