// Keyboard + gamepad. Produces a per-frame game input and edge-triggered menu events.

const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  action: ['Space', 'KeyJ', 'KeyC', 'Enter', 'NumpadEnter'],
  jump: ['KeyK', 'KeyX'],
  turbo: ['ShiftLeft', 'ShiftRight', 'KeyL', 'KeyZ'],
  pause: ['Escape', 'KeyP'],
  back: ['Escape', 'Backspace'],
  pageL: ['KeyQ', 'PageUp', 'Comma'],
  pageR: ['KeyE', 'PageDown', 'Period'],
};

const PAD = { action: [0], jump: [1, 2], turbo: [7, 5, 3], pause: [9], back: [1], pageL: [4, 6], pageR: [5, 7] };

export class Input {
  constructor() {
    this.down = new Set();
    this.menuQ = [];
    this.a = 0;
    this.j = 0;
    this.padPrev = {};
    this.repeat = {};
    this.usedPad = false;
    this.lastDevice = 'keyboard';
    this.typing = false;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.down.clear());
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
    const used = Object.values(KEYS).some((list) => list.includes(c));
    if (used) e.preventDefault();
    this.lastDevice = 'keyboard';
    if (isDown) {
      if (!e.repeat) {
        if (KEYS.action.includes(c)) this.a++;
        if (KEYS.jump.includes(c)) this.j++;
        if (KEYS.action.includes(c)) this.menuQ.push('confirm');
        if (KEYS.back.includes(c)) this.menuQ.push('back');
        if (KEYS.pause.includes(c)) this.menuQ.push('pause');
        if (KEYS.pageL.includes(c)) this.menuQ.push('pageL');
        if (KEYS.pageR.includes(c)) this.menuQ.push('pageR');
      }
      for (const d of ['up', 'down', 'left', 'right']) if (KEYS[d].includes(c)) this.menuQ.push(d);
      this.down.add(c);
    } else this.down.delete(c);
  }

  held(name) {
    return KEYS[name].some((k) => this.down.has(k));
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

  // Called once per frame. Returns the game input for local player 1.
  poll(dt) {
    let mx = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    let my = (this.held('up') ? 1 : 0) - (this.held('down') ? 1 : 0);
    let turbo = this.held('turbo');
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
      if (PAD.action.some(pressed)) {
        this.a++;
        this.menuQ.push('confirm');
        this.lastDevice = 'gamepad';
      }
      if (PAD.jump.some(pressed)) {
        this.j++;
        this.lastDevice = 'gamepad';
      }
      if (PAD.back.some(pressed)) this.menuQ.push('back');
      if (PAD.pause.some(pressed)) this.menuQ.push('pause');
      if (pressed(4)) this.menuQ.push('pageL');
      if (pressed(5)) this.menuQ.push('pageR');
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
    return { mx, my, turbo, a: this.a, j: this.j };
  }

  takeMenu() {
    const q = this.menuQ;
    this.menuQ = [];
    return q;
  }
}
