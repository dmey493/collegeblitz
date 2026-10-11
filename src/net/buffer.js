// Snapshot buffer: renders slightly in the past and interpolates between snapshots,
// so a 30 Hz network stream (or a 60 Hz local sim) looks smooth at any frame rate.

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function unpackPlayer(r) {
  return { id: r[0], x: r[1], z: r[2], y: r[3], face: r[4], vx: r[5], vz: r[6], state: r[7], st: r[8], turbo: !!(r[9] & 1), fallFwd: !!(r[9] & 2), hug: !!(r[9] & 4), taunt: !!(r[9] & 8), pile: !!(r[9] & 16) };
}

export class SnapshotBuffer {
  constructor(delay = 0.1) {
    this.delay = delay;
    this.buf = [];
    this.renderT = null;
    this.deliveredT = -Infinity;
  }

  reset() {
    this.buf = [];
    this.renderT = null;
    this.deliveredT = -Infinity;
  }

  push(snap, events = []) {
    this.buf.push({ snap, events, t: snap.t });
    if (this.buf.length > 90) this.buf.shift();
  }

  get latest() {
    return this.buf.length ? this.buf[this.buf.length - 1].snap : null;
  }

  // Advance render time by dt and return { view, events }.
  sample(dt, local = [false, false]) {
    if (!this.buf.length) return { view: null, events: [] };
    const latestT = this.buf[this.buf.length - 1].t;
    const target = latestT - this.delay;
    if (this.renderT === null) this.renderT = target;
    this.renderT += dt;
    const err = target - this.renderT;
    if (Math.abs(err) > 0.3) this.renderT = target;
    else this.renderT += err * Math.min(1, dt * 4);
    if (this.renderT > latestT) this.renderT = latestT;
    const rt = this.renderT;

    // events whose snapshot time has been reached
    const events = [];
    for (const e of this.buf) {
      if (e.t > this.deliveredT && e.t <= rt + 1e-6) events.push(...e.events);
    }
    if (rt > this.deliveredT) this.deliveredT = rt;

    let i = this.buf.length - 1;
    while (i > 0 && this.buf[i - 1].t > rt) i--;
    const b = this.buf[i];
    const a = i > 0 ? this.buf[i - 1] : b;
    // drop history we no longer need
    if (i > 3) this.buf.splice(0, i - 3);
    const span = b.t - a.t;
    const k = span > 1e-6 ? Math.min(1, Math.max(0, (rt - a.t) / span)) : 1;
    return { view: this.makeView(a.snap, b.snap, k, local), events };
  }

  makeView(A, B, k, local) {
    const view = { snap: B, players: [], byId: new Map(), ball: null, flight: null, local, scorerId: -1 };
    const pb = B.pl;
    if (!pb) return view;
    const pa = A.pl && A.n === B.n ? A.pl : null;
    const prev = new Map();
    if (pa) for (const r of pa.P) prev.set(r[0], r);
    for (const r of pb.P) {
      const p = unpackPlayer(r);
      const q = prev.get(r[0]);
      if (q && k < 1) {
        p.x = lerp(q[1], r[1], k);
        p.z = lerp(q[2], r[2], k);
        p.y = lerp(q[3], r[3], k);
        p.face = lerpAngle(q[4], r[4], k);
        p.vx = lerp(q[5], r[5], k);
        p.vz = lerp(q[6], r[6], k);
        if (q[7] === r[7]) p.st = lerp(q[8], r[8], k);
      }
      view.players.push(p);
      view.byId.set(p.id, p);
    }
    const Bb = pb.B;
    const ball = { x: Bb[0], y: Bb[1], z: Bb[2], state: Bb[3], carrier: Bb[4], kind: Bb[5] };
    if (pa && k < 1 && pa.B[3] === Bb[3] && pa.B[4] === Bb[4]) {
      ball.x = lerp(pa.B[0], Bb[0], k);
      ball.y = lerp(pa.B[1], Bb[1], k);
      ball.z = lerp(pa.B[2], Bb[2], k);
    }
    view.ball = ball;
    if (pb.F) view.flight = { fx: pb.F[0], fz: pb.F[1], tx: pb.F[2], tz: pb.F[3], intended: pb.F[4], kind: pb.F[5] };
    if (pb.res && pb.res.id >= 0) view.scorerId = pb.res.id;
    return view;
  }
}
