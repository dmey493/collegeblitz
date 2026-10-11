// In-game heads-up display: score bug, down & distance, turbo, big Blitz-style call-outs.
import { h, ordinal, clockText } from './dom.js';
import { logoDataURL } from '../render/textures.js';

export function downText(snap) {
  if (snap.conv) return 'CONVERSION';
  const goal = snap.fd >= 100;
  return `${ordinal(snap.dn)} & ${goal ? 'GOAL' : snap.tg}`;
}

export function spotText(snap, teams) {
  const on = snap.on;
  if (on === 50) return 'BALL ON THE 50';
  const team = on < 50 ? teams[snap.pos] : teams[1 - snap.pos];
  return `BALL ON ${team.abbr} ${on < 50 ? on : 100 - on}`;
}

export class HUD {
  constructor(root) {
    this.root = root;
    this.el = h('div.hud');
    root.append(this.el);
    this.teams = null;
    this.shownScore = [0, 0];
    this.msgT = 0;
    this.popT = 0;
  }

  setTeams(teams, myTeam) {
    this.teams = teams;
    this.myTeam = myTeam;
    this.el.innerHTML = '';
    const side = (i) => {
      const t = teams[i];
      return h(`div.sb-team.sb-${i}`, { style: { '--tc': t.colors.primary, '--tl': t.colors.light } },
        h('img.sb-logo', { src: logoDataURL(t, 96), alt: '' }),
        h('span.sb-name', t.abbr),
        h('span.sb-poss', '◆'),
        h('span.sb-fire', '🔥'),
        h(`span.sb-score#sb-score-${i}`, '0'));
    };
    this.score = h('div.scorebug', side(0), h('div.sb-mid', h('span.sb-q', '1ST'), h('span.sb-clock', '2:00')), side(1));
    this.down = h('div.downdist', h('div.dd-main', ''), h('div.dd-sub', ''));
    this.turbo = h('div.turbo', h('div.turbo-label', 'TURBO'), h('div.turbo-bar', h('div.turbo-fill')));
    this.msg = h('div.callout', h('div.co-main'), h('div.co-sub'));
    this.pop = h('div.pop');
    this.hint = h('div.hint');
    this.ping = h('div.ping');
    this.banner = h('div.banner', h('div.bn-main'), h('div.bn-sub'));
    this.el.append(this.score, this.down, this.turbo, this.msg, this.pop, this.hint, this.ping, this.banner);
    this.shownScore = [0, 0];
    this.lastScore = [0, 0];
  }

  show(on) {
    this.el.classList.toggle('on', on);
  }

  callout(main, sub = '', cls = 'gold', dur = 1.8) {
    const m = this.msg;
    m.className = `callout show ${cls}`;
    m.querySelector('.co-main').textContent = main;
    m.querySelector('.co-sub').textContent = sub;
    void m.offsetWidth;
    m.classList.add('anim');
    this.msgT = dur;
  }

  popup(text, cls = '') {
    const p = this.pop;
    p.className = `pop show ${cls}`;
    p.textContent = text;
    void p.offsetWidth;
    p.classList.add('anim');
    this.popT = 1.0;
  }

  onEvents(events, view) {
    if (!this.teams) return;
    const snap = view && view.snap;
    const name = (t) => this.teams[t].name;
    for (const e of events) {
      switch (e.k) {
        case 'firstDown':
          this.callout('FIRST DOWN!', e.gain > 0 ? `+${e.gain} YARDS` : '', 'gold', 1.6);
          break;
        case 'gain':
          if (e.gain > 0) this.popup(`+${e.gain} YDS`);
          else if (e.gain < 0) this.popup(`LOSS OF ${-e.gain}`, 'bad');
          else this.popup('NO GAIN', 'bad');
          break;
        case 'td':
          this.callout('TOUCHDOWN!', name(e.team), 'hot', 3);
          break;
        case 'int':
          this.callout('INTERCEPTED!', '', 'red', 2);
          break;
        case 'fumble':
          this.callout('FUMBLE!', '', 'red', 1.6);
          break;
        case 'recover':
          if (e.lost) this.callout('TURNOVER!', `${name(e.team)} BALL`, 'red', 2);
          break;
        case 'tackle':
          if (e.sack) this.callout('SACKED!', '', 'red', 1.6);
          else if (e.big) this.popup('BIG HIT!', 'hot');
          break;
        case 'incomplete':
          this.callout('INCOMPLETE', '', 'white', 1.2);
          break;
        case 'drop':
          this.popup('DROPPED!', 'bad');
          break;
        case 'deflect':
          this.popup('BROKEN UP!', 'bad');
          break;
        case 'downs':
          this.callout('TURNOVER ON DOWNS', '', 'red', 2);
          break;
        case 'fgGood':
          this.callout("IT'S GOOD!", '', 'gold', 2);
          break;
        case 'fgMiss':
          this.callout('NO GOOD!', '', 'red', 2);
          break;
        case 'conv':
          if (e.two) this.callout(e.good ? 'TWO-POINT CONVERSION!' : 'NO GOOD', '', e.good ? 'gold' : 'red', 1.8);
          break;
        case 'safety':
          this.callout('SAFETY!', '', 'hot', 2);
          break;
        case 'fire':
          this.callout(`${name(e.team)} IS ON FIRE!`, e.side === 'off' ? 'UNLIMITED TURBO' : 'DEFENSE IS LIT', 'hot', 2.4);
          break;
        case 'juke':
          this.popup('JUKED!', 'hot');
          break;
        case 'broken':
          this.popup('BROKE THE TACKLE!', 'hot');
          break;
        case 'stiffArmed':
          this.popup('STIFF ARM!', 'hot');
          break;
        case 'hurdled':
          this.popup('HURDLED!', 'hot');
          break;
        case 'lateHit':
          this.popup('LATE HIT!', 'hot');
          break;
        case 'whistle':
          if (e.type === 'touchback') this.callout('TOUCHBACK', '', 'white', 1.4);
          break;
        default:
          break;
      }
    }
    if (snap && snap.ph === 'banner' && snap.bn) {
      this.banner.classList.add('show');
      this.banner.querySelector('.bn-main').textContent = snap.bn.lines[0] || '';
      this.banner.querySelector('.bn-sub').textContent = snap.bn.lines[1] || '';
    } else this.banner.classList.remove('show');
  }

  update(view, dt, ctx = {}) {
    if (!this.teams || !view || !view.snap) return;
    const s = view.snap;
    this.el.classList.toggle('final', s.ph === 'final');
    // score count-up
    for (const i of [0, 1]) {
      if (s.sc[i] !== this.lastScore[i]) {
        this.lastScore[i] = s.sc[i];
        const el = this.score.querySelector(`.sb-${i}`);
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
      }
      if (this.shownScore[i] !== s.sc[i]) {
        const d = s.sc[i] - this.shownScore[i];
        this.shownScore[i] += Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) * dt * 6));
        if (Math.sign(s.sc[i] - this.shownScore[i]) !== Math.sign(d)) this.shownScore[i] = s.sc[i];
        this.score.querySelector(`#sb-score-${i}`).textContent = String(this.shownScore[i]);
      }
      const side = this.score.querySelector(`.sb-${i}`);
      side.classList.toggle('has-ball', s.pos === i && s.ph !== 'final');
      side.classList.toggle('fire', !!s.fire[i]);
    }
    this.score.querySelector('.sb-q').textContent = s.ot ? (s.ot > 1 ? `${s.ot}OT` : 'OT') : ordinal(s.q);
    const clk = this.score.querySelector('.sb-clock');
    clk.textContent = s.ot ? '--' : clockText(s.clk);
    clk.classList.toggle('low', !s.ot && s.clk <= 10);

    const pl = s.pl;
    const pre = pl && s.ph === 'play' && (pl.ph === 'lineup' || pl.ph === 'presnap') && (pl.k === 'scrimmage' || pl.k === 'two');
    this.down.classList.toggle('show', !!pre && s.ph !== 'banner');
    if (pre) {
      this.down.querySelector('.dd-main').textContent = downText(s);
      this.down.querySelector('.dd-sub').textContent = spotText(s, this.teams);
    }
    // turbo meter for my team
    const t = this.myTeam;
    const fire = s.fire[t];
    this.turbo.classList.toggle('fire', !!fire);
    this.turbo.style.setProperty('--tc', this.teams[t].colors.primary);
    this.turbo.querySelector('.turbo-fill').style.width = `${Math.round((fire ? 1 : s.tb[t]) * 100)}%`;
    this.turbo.classList.toggle('show', s.ph === 'play' || s.ph === 'playSelect');

    // context hint, spelled with whatever keys / buttons this player is using
    let hint = '';
    const L = ctx.labels;
    if (L && pl && s.ph === 'play' && view.local && view.local[t]) {
      const me = pl.ctl[t];
      const carrier = view.ball && view.ball.carrier;
      const scrim = pl.k === 'scrimmage' || pl.k === 'two';
      const icons = ctx.passing !== 'aim';
      const any = L.icons.join(' / ');
      if (pl.ph === 'presnap') {
        if (pl.off === t && scrim) hint = pl.ic && icons ? `SNAP: ${any} · THEN PRESS A RECEIVER'S KEY TO THROW` : `SNAP: ${any}`;
        else if (pl.off === t && pl.k === 'kickoff') hint = `KICK: ${any}`;
        else if (pl.off !== t && scrim) hint = `SWITCH PLAYER: ${L.pass} · MOVE: ${L.move}`;
      } else if (pl.ph === 'live') {
        if (carrier === me && pl.ps === t && view.byId.get(me)) {
          if (pl.cp && pl.ic && pl.off === t) {
            hint = icons ? `THROW: ${L.icons.join(' / ')} (RECEIVER'S KEY) · HOLD ${L.turbo} = BULLET` : `AIM: ${L.move} · THROW: ${L.pass} · HOLD ${L.turbo} = BULLET`;
          } else hint = `TURBO: ${L.turbo} · STIFF ARM: ${L.pass} · HURDLE: ${L.jump} · SPIN: ${L.spin}`;
        } else if (pl.ps !== t) hint = `SWITCH: ${L.pass} · JUMP: ${L.jump} · DIVE: ${L.spin} · TURBO: ${L.turbo}`;
        else if (view.flight && view.flight.kind === 'pass' && view.flight.intended === me && view.ball.state === 'air') hint = `JUMP FOR IT: ${L.jump} · DIVE FOR IT: ${L.spin}`;
      }
    }
    if (this.hint.textContent !== hint) this.hint.textContent = hint;
    this.hint.classList.toggle('show', !!hint);

    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.msg.classList.remove('show', 'anim');
    }
    if (this.popT > 0) {
      this.popT -= dt;
      if (this.popT <= 0) this.pop.classList.remove('show', 'anim');
    }
    if (ctx.ping !== undefined) {
      this.ping.textContent = ctx.ping ? `${Math.round(ctx.ping)} ms` : '';
      this.ping.classList.toggle('bad', ctx.ping > 150);
    }
  }
}
