// Keyboard/gamepad/mouse navigable menu list.
import { h } from './dom.js';

export class MenuList {
  // items: { label, kind: 'button'|'select'|'input', options:[{label,value}], value, onChange, onPress, disabled, hint }
  constructor(items, { onBack, onMove, onSelect, className = '' } = {}) {
    this.items = items;
    this.onBack = onBack;
    this.onMove = onMove;
    this.onSelect = onSelect;
    this.i = Math.max(0, items.findIndex((it) => !it.disabled));
    this.el = h(`div.menu${className ? '.' + className : ''}`);
    this.render();
  }

  render() {
    this.el.innerHTML = '';
    this.rows = this.items.map((it, idx) => {
      let row;
      if (it.kind === 'select') {
        const opt = it.options.find((o) => o.value === it.value) || it.options[0];
        row = h('div.mi.mi-select', { 'data-i': idx },
          h('span.mi-label', it.label),
          h('span.mi-value', h('b.arrow', { onclick: (e) => { e.stopPropagation(); this.focus(idx); this.change(-1); } }, '◀'), h('span.mi-opt', opt.label), h('b.arrow', { onclick: (e) => { e.stopPropagation(); this.focus(idx); this.change(1); } }, '▶')));
      } else if (it.kind === 'input') {
        const inp = h('input.mi-input', { value: it.value || '', placeholder: it.placeholder || '', maxlength: it.maxlength || 64, spellcheck: 'false', autocomplete: 'off' });
        inp.addEventListener('input', () => {
          it.value = it.upper ? inp.value.toUpperCase() : inp.value;
          if (it.upper) inp.value = it.value;
          it.onChange && it.onChange(it.value);
        });
        row = h('div.mi.mi-input-row', { 'data-i': idx }, h('span.mi-label', it.label), inp);
        it.inputEl = inp;
      } else {
        row = h('div.mi.mi-button', { 'data-i': idx }, h('span.mi-label', it.label), it.hint ? h('span.mi-hint', it.hint) : null);
      }
      if (it.disabled) row.classList.add('disabled');
      row.addEventListener('pointerenter', () => this.focus(idx, false));
      row.addEventListener('click', () => {
        this.focus(idx, false);
        if (it.kind === 'select') this.change(1);
        else if (it.kind === 'input') it.inputEl.focus();
        else this.press();
      });
      this.el.append(row);
      return row;
    });
    this.paint();
  }

  paint() {
    this.rows.forEach((r, idx) => r.classList.toggle('focus', idx === this.i));
  }

  focus(idx, sound = true) {
    if (this.items[idx].disabled || idx === this.i) return;
    this.i = idx;
    this.paint();
    if (sound && this.onMove) this.onMove();
    const it = this.items[idx];
    if (it.kind === 'input' && it.inputEl) it.inputEl.focus();
    else if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
  }

  move(d) {
    let j = this.i;
    for (let k = 0; k < this.items.length; k++) {
      j = (j + d + this.items.length) % this.items.length;
      if (!this.items[j].disabled) break;
    }
    if (j !== this.i) {
      this.i = j;
      this.paint();
      this.onMove && this.onMove();
      const it = this.items[j];
      if (it.kind === 'input' && it.inputEl) it.inputEl.focus();
      else if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    }
  }

  change(d) {
    const it = this.items[this.i];
    if (it.kind !== 'select') return;
    const k = it.options.findIndex((o) => o.value === it.value);
    const n = it.options.length;
    it.value = it.options[(k + d + n) % n].value;
    it.onChange && it.onChange(it.value);
    this.onMove && this.onMove();
    this.render();
  }

  press() {
    const it = this.items[this.i];
    if (!it || it.disabled) return;
    if (it.kind === 'select') return this.change(1);
    if (it.kind === 'input') return this.move(1);
    if (it.onPress) {
      this.onSelect && this.onSelect();
      it.onPress();
    }
  }

  handle(evt) {
    switch (evt) {
      case 'up':
        return this.move(-1);
      case 'down':
        return this.move(1);
      case 'left':
        return this.change(-1);
      case 'right':
        return this.change(1);
      case 'confirm':
        return this.press();
      case 'back':
        return this.onBack && this.onBack();
      default:
        return undefined;
    }
  }
}
