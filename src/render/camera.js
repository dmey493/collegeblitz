// Blitz-style camera: always behind the offense, high and tight, pulling back on deep balls.
import * as THREE from 'three';
import { HALF_W, VIEW_TURN } from '../sim/constants.js';
import { PLAYER_SCALE } from './player-model.js';

const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class CameraDirector {
  constructor(camera) {
    this.cam = camera;
    this.pos = new THREE.Vector3(0, 40, -80);
    this.look = new THREE.Vector3(0, 0, 0);
    this.shake = 0;
    this.t = 0;
    this.tdAngle = null;
    this.mode = 'orbit';
    this.override = null;
  }

  kick(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  update(view, dt, ctx = {}) {
    this.t += dt;
    const s = view && view.snap;
    let pos;
    let look;
    let kp = 4;
    let kl = 6;
    if (!s || ctx.mode === 'title') {
      const a = this.t * 0.12 + 0.6;
      pos = new THREE.Vector3(Math.sin(a) * 19, 4.2 + Math.sin(this.t * 0.2) * 0.8, Math.cos(a) * 19);
      look = new THREE.Vector3(0, 2.0, 0);
      kp = 3;
    } else if (s.ph === 'final') {
      const a = this.t * 0.1;
      pos = new THREE.Vector3(Math.sin(a) * 70, 34, Math.cos(a) * 85);
      look = new THREE.Vector3(0, 0, 0);
      kp = 1.2;
    } else {
      const pl = s.pl;
      // the sim's view direction: behind the offense, swinging around behind whoever has the
      // ball after a turnover or on a return (the controls follow the same direction)
      // the way the view faces: behind the offense, then behind whoever has the ball after a
      // turnover or on a return (the camera swings round to it, see below)
      const dir = pl ? pl.vt || pl.vd || pl.dir : s.pos === 0 ? 1 : -1;
      const losZ = pl ? pl.los : dir * (s.on - 50);
      const b = view.ball;
      if (!pl || pl.ph === 'lineup' || pl.ph === 'presnap' || s.ph !== 'play') {
        const kickoff = pl && pl.k === 'kickoff';
        // a lower angle than a TV camera: the players stand up tall on screen
        const back = kickoff ? 23 : 17.4;
        const h = kickoff ? 15 : s.ph === 'playSelect' ? 13 : 8.6;
        const ahead = kickoff ? 18 : 8.5;
        pos = new THREE.Vector3(0, h, losZ - dir * back);
        look = new THREE.Vector3(0, kickoff ? 0.6 : 1.2, losZ + dir * ahead);
        kp = 3.2;
        this.tdAngle = null;
      } else {
        // follow the ball
        let fx = b.x;
        let fz = b.z;
        // close in on the action (the players are drawn larger than life)
        let h = 7.6;
        let back = 13.2;
        let ahead = 6.6;
        // once a runner is past the line the camera moves in tight on him
        const returning = pl.ps !== undefined && pl.ps !== pl.off;
        if (b.state === 'held' && (returning || (dir * (b.z - losZ) > 0.5 && pl.k !== 'kickoff' && pl.k !== 'punt'))) {
          h = 6.4;
          back = 10.6;
          ahead = 6;
        }
        if (b.state === 'air' && view.flight) {
          const f = view.flight;
          const len = Math.hypot(f.tx - f.fx, f.tz - f.fz);
          if (f.kind === 'pass' && len > 2) {
            // ride the ball out, then move in on the catch (leaps and layouts fill the screen)
            const prog = Math.min(1, Math.hypot(b.x - f.fx, b.z - f.fz) / len);
            const e = Math.min(1, len / 40) * (1 - THREE.MathUtils.smoothstep(prog, 0.3, 0.8));
            const tight = THREE.MathUtils.smoothstep(prog, 0.3, 0.85);
            h = THREE.MathUtils.lerp(h, 6.8, tight) + e * 5;
            back = THREE.MathUtils.lerp(back, 9.2, tight) + e * 6;
            ahead = THREE.MathUtils.lerp(ahead, 5.2, tight) + e * 5;
            fx = THREE.MathUtils.lerp(b.x, f.tx, 0.6 * tight);
            fz = THREE.MathUtils.lerp(b.z, f.tz, 0.6 * tight);
          } else {
            const e = Math.min(1, len / 40);
            h += e * 6;
            back += e * 7;
            ahead += e * 6;
          }
          if (b.kind === 'kick' || b.kind === 'fg') {
            h += 4;
            back += 3;
          }
        }
        if (pl.k === 'kickoff' || pl.k === 'punt') {
          h += 2;
          back += 3;
        }
        // TD celebration orbit
        const scorer = pl.res && pl.res.type === 'td' && pl.ph === 'dead' ? view.byId.get(view.scorerId) : null;
        if (scorer && ctx.deadT > 0.45) {
          if (this.tdAngle === null) this.tdAngle = Math.atan2(this.pos.x - scorer.x, this.pos.z - scorer.z);
          this.tdAngle += dt * 0.55;
          pos = new THREE.Vector3(scorer.x + Math.sin(this.tdAngle) * 7.5, 3.4, scorer.z + Math.cos(this.tdAngle) * 7.5);
          look = new THREE.Vector3(scorer.x, 1.5, scorer.z);
          kp = 2.2;
          kl = 4;
        } else {
          // (the ball is drawn PLAYER_SCALE higher than the game's own heights)
          const lift = b.state === 'air' ? Math.min(b.y * PLAYER_SCALE, 22) * (b.kind === 'kick' || b.kind === 'fg' ? 0.55 : 0.3) : 0;
          pos = new THREE.Vector3(THREE.MathUtils.clamp(fx * 0.72, -15, 15), h + lift * 0.4, fz - dir * back);
          look = new THREE.Vector3(THREE.MathUtils.clamp(fx * 0.85, -HALF_W, HALF_W), 1.0 + lift, fz + dir * ahead);
          kp = 4.2;
          kl = 7;
        }
      }
    }
    // the view flipped (turnover, return): swing round the ball carrier to the new side
    const vt = s && s.pl ? s.pl.vt || s.pl.vd || s.pl.dir : 0;
    if (!this.override && vt && this.lastVt && vt !== this.lastVt && s.pl && (s.pl.ph === 'live' || s.pl.ph === 'dead')) {
      const f = view.ball || { x: 0, z: 0 };
      // go round the side nearer the middle of the field, so the camera stays over the field
      this.turn = { t: 0, sign: (f.x >= 0 ? 1 : -1) * vt };
    }
    this.lastVt = vt;
    if (this.turn && pos && look && !this.override) {
      this.turn.t += dt;
      const k = Math.min(1, this.turn.t / VIEW_TURN);
      const e = k * k * (3 - 2 * k);
      const ang = (1 - e) * Math.PI * this.turn.sign;
      const f = view.ball || { x: pos.x, z: pos.z };
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const rot = (v) => {
        const dx = v.x - f.x;
        const dz = v.z - f.z;
        v.x = f.x + dx * c - dz * sn;
        v.z = f.z + dx * sn + dz * c;
      };
      rot(pos);
      rot(look);
      pos.y += Math.sin(e * Math.PI) * 2.2; // a little lift through the swing
      // follow the orbit exactly: smoothing would cut straight across it
      kp = 1e3;
      kl = 1e3;
      if (k >= 1) this.turn = null;
    }
    if (this.override) {
      // fixed camera for close-ups and screenshots: { pos: [x, y, z], look: [x, y, z] }
      pos = new THREE.Vector3(...this.override.pos);
      look = new THREE.Vector3(...this.override.look);
      kp = 1e3;
      kl = 1e3;
    }
    this.pos.lerp(pos, damp(kp, dt));
    this.look.lerp(look, damp(kl, dt));
    this.cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      const a = this.shake;
      this.cam.position.x += (Math.random() - 0.5) * a;
      this.cam.position.y += (Math.random() - 0.5) * a;
      this.cam.position.z += (Math.random() - 0.5) * a;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    this.cam.lookAt(this.look);
  }
}
