// The 3x3 play-select grid, plus the extra-point choice.
import { h } from './dom.js';
import { OFF_PAGES, DEF_PLAYS, getPlay } from '../sim/playbook.js';
import { offenseDiagram, defenseDiagram } from './diagram.js';
import { downText, spotText } from './hud.js';

export class PlaySelect {
  constructor({ teams, myTeam, snap, onPick, onMove, lastPage = 0, labels = { move: 'ARROWS', pass: 'F' } }) {
    this.teams = teams;
    this.team = teams[myTeam];
    this.myTeam = myTeam;
    this.offense = snap.pos === myTeam;
    this.onPick = onPick;
    this.onMove = onMove;
    this.conv = snap.conv;
    this.ot = !!snap.ot;
    this.pages = this.offense ? OFF_PAGES.map((ids) => ids.map(getPlay)) : [DEF_PLAYS];
    this.page = Math.min(lastPage, this.pages.length - 1);
    this.cursor = 0;
    this.picked = null;
    this.el = h('div.playselect', { style: { '--tc': this.team.colors.primary, '--tl': this.team.colors.light } });
    this.header = h('div.ps-head',
      h('div.ps-team', h('span.ps-name', this.team.name), h('span.ps-side', this.offense ? 'OFFENSE' : 'DEFENSE')),
      h('div.ps-down', h('div.ps-dd', downText(snap)), h('div.ps-spot', spotText(snap, teams))),
      h('div.ps-timer', h('span.ps-sec', '15')));
    this.grid = h('div.ps-grid');
    this.pager = h('div.ps-pager');
    this.waiting = h('div.ps-wait', 'WAITING FOR OPPONENT…');
    this.el.append(this.header, this.grid, this.pager, this.waiting,
      h('div.ps-foot', h('span', `MOVE: ${labels.move} / STICK`), h('span', `PICK: ${labels.pass} / ENTER / (A)`), this.pages.length > 1 ? h('span', 'PAGE: Q / E / BUMPERS') : null));
    this.render();
  }

  disabled(p) {
    if (!p) return true;
    if (p.special && this.conv) return true;
    if (p.id === 'punt' && this.ot) return true;
    return false;
  }

  render() {
    const plays = this.pages[this.page];
    this.grid.innerHTML = '';
    this.cards = [];
    for (let i = 0; i < 9; i++) {
      const p = plays[i];
      if (!p) {
        this.cards.push(null);
        this.grid.append(h('div.ps-card.empty'));
        continue;
      }
      const card = h('div.ps-card', { style: { animationDelay: `${i * 45}ms` } },
        h('div.ps-diag', { html: this.offense ? offenseDiagram(p) : defenseDiagram(p) }),
        h('div.ps-pname', p.name),
        !this.offense && p.blurb ? h('div.ps-blurb', p.blurb) : null);
      if (this.disabled(p)) card.classList.add('disabled');
      card.addEventListener('pointerenter', () => {
        if (!this.picked && this.cursor !== i) {
          this.cursor = i;
          this.paint();
          this.onMove && this.onMove();
        }
      });
      card.addEventListener('click', () => {
        this.cursor = i;
        this.pick();
      });
      this.cards.push(card);
      this.grid.append(card);
    }
    this.pager.innerHTML = '';
    if (this.pages.length > 1) {
      this.pager.append(
        h('b.pg-arrow', { onclick: () => this.turn(-1) }, '◀'),
        ...this.pages.map((_, i) => h(`span.pg-dot${i === this.page ? '.on' : ''}`, { onclick: () => this.turn(i - this.page) }, i === 2 ? 'SPECIAL' : `PAGE ${i + 1}`)),
        h('b.pg-arrow', { onclick: () => this.turn(1) }, '▶'),
      );
    }
    this.paint();
  }

  paint() {
    this.cards.forEach((c, i) => c && c.classList.toggle('focus', i === this.cursor));
    this.el.classList.toggle('locked', !!this.picked);
  }

  turn(d) {
    if (this.picked || this.pages.length < 2) return;
    this.page = (this.page + d + this.pages.length) % this.pages.length;
    const n = this.pages[this.page].length;
    if (this.cursor >= n) this.cursor = n - 1;
    this.onMove && this.onMove();
    this.render();
  }

  moveCursor(dx, dy) {
    if (this.picked) return;
    const n = this.pages[this.page].length;
    let col = this.cursor % 3;
    let row = Math.floor(this.cursor / 3);
    if (dx) {
      col += dx;
      if (col < 0 || col > 2) {
        if (this.pages.length > 1) {
          this.turn(dx);
          col = dx > 0 ? 0 : 2;
          const nn = this.pages[this.page].length;
          this.cursor = Math.min(row * 3 + col, nn - 1);
          this.paint();
          return;
        }
        col = (col + 3) % 3;
      }
    }
    if (dy) row = (row + dy + 3) % 3;
    let idx = row * 3 + col;
    if (idx >= n) idx = dy ? (dy > 0 ? col : Math.min(n - 1, idx)) : n - 1;
    if (idx !== this.cursor) {
      this.cursor = idx;
      this.paint();
      this.onMove && this.onMove();
    }
  }

  pick() {
    if (this.picked) return;
    const p = this.pages[this.page][this.cursor];
    if (this.disabled(p)) return;
    this.picked = p.id;
    this.cards[this.cursor].classList.add('picked');
    this.paint();
    this.onPick(p.id, this.page);
  }

  handle(evt) {
    if (evt === 'up') this.moveCursor(0, -1);
    else if (evt === 'down') this.moveCursor(0, 1);
    else if (evt === 'left') this.moveCursor(-1, 0);
    else if (evt === 'right') this.moveCursor(1, 0);
    else if (evt === 'pageL') this.turn(-1);
    else if (evt === 'pageR') this.turn(1);
    else if (evt === 'confirm') this.pick();
  }

  update(snap) {
    if (!snap.ps) return;
    this.header.querySelector('.ps-sec').textContent = String(Math.ceil(snap.ps.t));
    this.header.querySelector('.ps-timer').classList.toggle('low', snap.ps.t <= 5);
    const oppDone = snap.ps.pk[1 - this.myTeam];
    this.waiting.classList.toggle('show', !!this.picked && !oppDone);
  }
}

export class PatChoice {
  constructor({ team, onPick, onMove }) {
    this.onPick = onPick;
    this.onMove = onMove;
    this.i = 0;
    this.done = false;
    this.opts = [
      { id: 'kick', main: 'KICK IT', sub: '1 POINT · FROM THE 3' },
      { id: 'two', main: 'GO FOR 2', sub: 'ONE PLAY · FROM THE 3' },
    ];
    this.cards = this.opts.map((o, i) => {
      const c = h('div.pat-card', h('div.pat-main', o.main), h('div.pat-sub', o.sub));
      c.addEventListener('pointerenter', () => this.focus(i));
      c.addEventListener('click', () => {
        this.focus(i);
        this.pick();
      });
      return c;
    });
    this.timer = h('div.pat-timer', '8');
    this.el = h('div.patchoice', { style: { '--tc': team.colors.primary } }, h('div.pat-title', 'EXTRA POINT'), h('div.pat-row', ...this.cards), this.timer);
    this.paint();
  }

  focus(i) {
    if (this.done || i === this.i) return;
    this.i = i;
    this.paint();
    this.onMove && this.onMove();
  }

  paint() {
    this.cards.forEach((c, i) => c.classList.toggle('focus', i === this.i));
  }

  pick() {
    if (this.done) return;
    this.done = true;
    this.cards[this.i].classList.add('picked');
    this.onPick(this.opts[this.i].id);
  }

  handle(evt) {
    if (evt === 'left' || evt === 'up') this.focus(0);
    else if (evt === 'right' || evt === 'down') this.focus(1);
    else if (evt === 'confirm') this.pick();
  }

  update(snap) {
    if (snap.pat) this.timer.textContent = String(Math.ceil(snap.pat.t));
  }
}
