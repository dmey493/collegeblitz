// Keyboard + gamepad. Produces a per-frame game input and edge-triggered menu events.
//
// Two keyboard layouts, so all the buttons sit under the hand that isn't steering:
//   ARROWS: move with the arrow keys (right hand); F pass · D jump · S spin/dive · SPACE turbo (left hand)
//   WASD:   move with W A S D (left hand);         J pass · K jump · L spin/dive · SPACE turbo (thumb)
// Index finger = pass, middle = jump, ring = spin/dive in both. No two-button combos.
// When your QB has the ball, the same three keys throw to the receiver wearing that key's
// icon, laid out left-to-right on the keyboard like the receivers are on screen.

export const LAYOUTS = {
  arrows: {
    name: 'ARROWS + S D F',
    move: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'] },
    pass: ['KeyF', 'Enter', 'NumpadEnter'],
    jump: ['KeyD'],
    spin: ['KeyS'],
    icons: ['KeyS', 'KeyD', 'KeyF'],
    labels: { move: 'ARROWS', pass: 'F', jump: 'D', spin: 'S', turbo: 'SPACE', icons: ['S', 'D', 'F'] },
  },
  wasd: {
    name: 'WASD + J K L',
    move: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'] },
    pass: ['KeyJ', 'Enter', 'NumpadEnter'],
    jump: ['KeyK'],
    spin: ['KeyL'],
    icons: ['KeyJ', 'KeyK', 'KeyL'],
    labels: { move: 'W A S D', pass: 'J', jump: 'K', spin: 'L', turbo: 'SPACE', icons: ['J', 'K', 'L'] },
  },
};

const COMMON = {
  turbo: ['Space', 'ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  back: ['Escape', 'Backspace'],
  pageL: ['KeyQ', 'PageUp'],
  pageR: ['KeyE', 'PageDown'],
  navUp: ['ArrowUp'],
  navDown: ['ArrowDown'],
  navLeft: ['ArrowLeft'],
  navRight: ['ArrowRight'],
};

// Standard gamepad mapping (Xbox layout): A pass · B jump · X spin/dive · RT/RB turbo.
// Icon passing follows the face buttons' physical layout: X (left) · A (middle) · B (right).
const PAD = { pass: [0], jump: [1], spin: [2], turbo: [7, 5, 6], pause: [9], back: [1], pageL: [4], pageR: [5], icons: [2, 0, 1] };
export const PAD_LABELS = { move: 'STICK', pass: 'A', jump: 'B', spin: 'X', turbo: 'RT', icons: ['X', 'A', 'B'] };

export class Input {
  constructor(layout = 'arrows') {
    this.down = new Set();
    this.menuQ = [];
    this.a = 0; // pass presses
    this.j = 0; // jump presses
    this.s = 0; // spin/dive presses
    this.c = [0, 0, 0]; // receiver-icon presses (left, middle, right)
    this.padPrev = {};
    this.repeat = {};
    this.lastDevice = 'keyboard';
    this.setLayout(layout);
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.down.clear());
  }

  setLayout(name) {
    this.layoutName = LAYOUTS[name] ? name : 'arrows';
    this.L = LAYOUTS[this.layoutName];
    const all = [...Object.values(this.L.move).flat(), ...this.L.pass, ...this.L.jump, ...this.L.spin, ...Object.values(COMMON).flat()];
    this.usedKeys = new Set(all);
    this.down.clear();
  }

  labels() {
    return this.lastDevice === 'gamepad' ? PAD_LABELS : this.L.labels;
  }

  isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  }

  onKey(e, isDown) {
    if (this.isTyping(e)) {
      if (isDown && (e.code === 'Enter' || e.code === 'Escape')) this.menuQ.push(e.code === 'Enter' ? 'confirm' : 'back');
      return;
    }
    const c = e.code;
    if (this.usedKeys.has(c)) e.preventDefault();
    this.lastDevice = 'keyboard';
    const L = this.L;
    if (isDown) {
      if (!e.repeat) {
        if (L.pass.includes(c)) {
          this.a++;
          this.menuQ.push('confirm');
        }
        if (L.jump.includes(c)) this.j++;
        if (L.spin.includes(c)) this.s++;
        const icon = L.icons.indexOf(c);
        if (icon >= 0) this.c[icon]++;
        if (COMMON.back.includes(c)) this.menuQ.push('back');
        if (COMMON.pause.includes(c)) this.menuQ.push('pause');
        if (COMMON.pageL.includes(c)) this.menuQ.push('pageL');
        if (COMMON.pageR.includes(c)) this.menuQ.push('pageR');
      }
      // menus: arrows always navigate; WASD too when it's the movement layout
      const nav = { up: [...COMMON.navUp], down: [...COMMON.navDown], left: [...COMMON.navLeft], right: [...COMMON.navRight] };
      if (this.layoutName === 'wasd') for (const d of Object.keys(nav)) nav[d].push(...L.move[d]);
      for (const d of Object.keys(nav)) if (nav[d].includes(c)) this.menuQ.push(d);
      this.down.add(c);
    } else this.down.delete(c);
  }

  heldAny(list) {
    return list.some((k) => this.down.has(k));
  }

  pads() {
    if (!navigator.getGamepads || this.noPads) return [];
    try {
      return Array.from(navigator.getGamepads()).filter(Boolean);
    } catch {
      // gamepads can be blocked inside sandboxed frames
      this.noPads = true;
      return [];
    }
  }

  // Called once per frame. Returns the game input for the local player.
  poll(dt) {
    const M = this.L.move;
    let mx = (this.heldAny(M.right) ? 1 : 0) - (this.heldAny(M.left) ? 1 : 0);
    let my = (this.heldAny(M.up) ? 1 : 0) - (this.heldAny(M.down) ? 1 : 0);
    let turbo = this.heldAny(COMMON.turbo);
    for (const gp of this.pads()) {
      const ax = gp.axes[0] || 0;
      const ay = gp.axes[1] || 0;
      const b = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4);
      let px = Math.abs(ax) > 0.22 ? ax : 0;
      let py = Math.abs(ay) > 0.22 ? -ay : 0;
      if (b(14)) px = -1;
      if (b(15)) px = 1;
      if (b(12)) py = 1;
      if (b(13)) py = -1;
      if (px || py) {
        mx = px;
        my = py;
        this.lastDevice = 'gamepad';
      }
      if (PAD.turbo.some(b)) turbo = true;
      const prev = this.padPrev[gp.index] || {};
      const now = {};
      for (let i = 0; i < gp.buttons.length; i++) now[i] = b(i);
      const pressed = (i) => now[i] && !prev[i];
      if (PAD.pass.some(pressed)) {
        this.a++;
        this.menuQ.push('confirm');
      }
      if (PAD.jump.some(pressed)) this.j++;
      if (PAD.spin.some(pressed)) this.s++;
      PAD.icons.forEach((btn, k) => {
        if (pressed(btn)) this.c[k]++;
      });
      if ([0, 1, 2, 3].some(pressed)) this.lastDevice = 'gamepad';
      if (PAD.back.some(pressed)) this.menuQ.push('back');
      if (PAD.pause.some(pressed)) this.menuQ.push('pause');
      if (PAD.pageL.some(pressed)) this.menuQ.push('pageL');
      if (PAD.pageR.some(pressed)) this.menuQ.push('pageR');
      // stick / dpad menu navigation with auto-repeat
      const dirs = { up: py > 0.6, down: py < -0.6, left: px < -0.6, right: px > 0.6 };
      for (const d in dirs) {
        const key = `${gp.index}-${d}`;
        if (dirs[d]) {
          const r = this.repeat[key];
          if (r === undefined) {
            this.menuQ.push(d);
            this.repeat[key] = 0.35;
          } else {
            this.repeat[key] = r - dt;
            if (this.repeat[key] <= 0) {
              this.menuQ.push(d);
              this.repeat[key] = 0.12;
            }
          }
        } else delete this.repeat[key];
      }
      this.padPrev[gp.index] = now;
    }
    const l = Math.hypot(mx, my);
    if (l > 1) {
      mx /= l;
      my /= l;
    }
    return { mx, my, turbo, a: this.a, j: this.j, s: this.s, c0: this.c[0], c1: this.c[1], c2: this.c[2] };
  }

  takeMenu() {
    const q = this.menuQ;
    this.menuQ = [];
    return q;
  }
}
