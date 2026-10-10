// Tiny DOM helper: h('div.class#id', { attrs }, ...children)
export function h(sel, attrs, ...kids) {
  const [tagPart, ...rest] = sel.split(/(?=[.#])/);
  const el = document.createElement(tagPart || 'div');
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    kids.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids.flat()) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const ordinal = (n) => ['', '1ST', '2ND', '3RD', '4TH'][n] || `${n}TH`;
export const clockText = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
