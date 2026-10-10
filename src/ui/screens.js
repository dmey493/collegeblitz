// Menus and full-screen pages: title, setup, how-to, settings, online lobby, pause, final.
import { h } from './dom.js';
import { MenuList } from './menu.js';
import { TEAMS } from '../sim/teams.js';
import { logoDataURL } from '../render/textures.js';

export function logoBlock(small = false) {
  return h(`div.logo${small ? '.small' : ''}`,
    h('div.logo-top', 'COLLEGE'),
    h('div.logo-main', 'BLITZ'),
    h('div.logo-tag', '1ST & 30 · NO FLAGS · NO MERCY'));
}

export function titleScreen({ onPlay, onOnline, onHowTo, onSettings, sfx }) {
  const menu = new MenuList([
    { label: 'PLAY VS CPU', onPress: onPlay },
    { label: 'PLAY ONLINE', hint: 'HEAD-TO-HEAD', onPress: onOnline },
    { label: 'HOW TO PLAY', onPress: onHowTo },
    { label: 'SETTINGS', onPress: onSettings },
  ], { onMove: sfx.move, onSelect: sfx.select, className: 'title-menu' });
  const el = h('div.screen.title', logoBlock(), menu.el, h('div.press', 'ARROWS / STICK + J, SPACE OR (A)'), h('div.foot', 'MOCKUP v0.1 · INDIANA vs MICHIGAN'));
  return { el, handle: (e) => menu.handle(e) };
}

function ratingBars(team) {
  const r = team.ratings;
  return h('div.rbars', ...[['PASS', r.pass], ['RUSH', r.rush], ['DEFENSE', r.defense], ['SPEED', r.speed]].map(([k, v]) =>
    h('div.rbar', h('span.rk', k), h('span.rtrack', h('span.rfill', { style: { width: `${v * 10}%` } })), h('span.rv', String(v)))));
}

export function teamCard(team, opts = {}) {
  return h('div.tcard', { style: { '--tc': team.colors.primary, '--tl': team.colors.light, '--td': team.colors.dark }, 'data-team': team.id },
    h('img.tlogo', { src: logoDataURL(team, 256), alt: `${team.name} state outline` }),
    h('div.tname', team.name),
    opts.tag ? h('div.ttag', opts.tag) : null,
    ratingBars(team),
    h('div.tblurb', team.blurb));
}

// vs-CPU setup: pick your team + game options
export function setupScreen({ settings, onStart, onBack, sfx }) {
  const ids = Object.keys(TEAMS);
  const cards = h('div.tcards');
  const state = { team: settings.team in TEAMS ? settings.team : 'IND' };
  const paintCards = () => {
    cards.innerHTML = '';
    for (const id of ids) {
      const t = TEAMS[id];
      const mine = id === state.team;
      const c = teamCard(t, { tag: mine ? 'YOU' : 'CPU' });
      c.classList.toggle('mine', mine);
      c.addEventListener('click', () => {
        state.team = id;
        teamItem.value = id;
        sfx.move();
        menu.render();
        paintCards();
      });
      cards.append(c);
    }
  };
  const teamItem = { label: 'YOUR TEAM', kind: 'select', options: ids.map((id) => ({ label: TEAMS[id].name, value: id })), value: state.team, onChange: (v) => { state.team = v; paintCards(); } };
  const menu = new MenuList([
    teamItem,
    { label: 'QUARTER LENGTH', kind: 'select', options: [60, 90, 120, 180, 300].map((s) => ({ label: `${s / 60} MIN`.replace('1.5', '1:30'), value: s })), value: settings.quarterSec, onChange: (v) => (settings.quarterSec = v) },
    { label: 'FIRST DOWN', kind: 'select', options: [{ label: '30 YARDS', value: 30 }, { label: '25 YARDS', value: 25 }, { label: '10 YARDS (SIM)', value: 10 }], value: settings.fdYards, onChange: (v) => (settings.fdYards = v) },
    { label: 'CPU', kind: 'select', options: [{ label: 'ROOKIE', value: 'rookie' }, { label: 'VARSITY', value: 'varsity' }, { label: 'HEISMAN', value: 'heisman' }], value: settings.difficulty, onChange: (v) => (settings.difficulty = v) },
    { label: 'KICK OFF!', onPress: () => onStart({ ...settings, team: state.team }) },
    { label: 'BACK', onPress: onBack },
  ], { onBack, onMove: sfx.move, onSelect: sfx.select, className: 'setup-menu' });
  menu.i = 4;
  menu.paint();
  paintCards();
  const el = h('div.screen.setup', h('div.screen-title', 'CHOOSE YOUR STATE'), cards, h('div.panel.narrow', menu.el));
  return { el, handle: (e) => menu.handle(e) };
}

export function howToScreen({ onBack, sfx }) {
  const menu = new MenuList([{ label: 'BACK', onPress: onBack }], { onBack, onSelect: sfx.select });
  const row = (k, a, b, c) => h('tr', h('th', k), h('td', a), h('td', b), h('td', c));
  const el = h('div.screen.howto',
    h('div.screen-title', 'HOW TO PLAY'),
    h('div.howto-cols',
      h('div.panel',
        h('h3', 'CONTROLS'),
        h('table.keys',
          h('tr', h('th', ''), h('td', 'KEYBOARD'), h('td', 'ALT KEYS'), h('td', 'GAMEPAD')),
          row('MOVE', 'W A S D', 'ARROWS', 'STICK / D-PAD'),
          row('PASS · SNAP · SWITCH', 'J  or  SPACE', 'C', 'A'),
          row('JUMP · HURDLE · DIVE', 'K', 'X', 'B / X'),
          row('TURBO (HOLD)', 'L  or  SHIFT', 'Z', 'RT / RB / Y'),
          row('PAUSE', 'ESC / P', '', 'START'))),
      h('div.panel',
        h('h3', 'MOVES'),
        h('ul',
          h('li', h('b', 'QB: '), 'hold the stick toward a receiver and press PASS. Add TURBO for a bullet.'),
          h('li', h('b', 'Ball carrier: '), 'TURBO+JUMP spins, PASS stiff-arms, JUMP hurdles.'),
          h('li', h('b', 'Defense: '), 'PASS switches to the man nearest the ball. TURBO+JUMP is a dive tackle.'),
          h('li', h('b', 'Hit hard: '), 'run through people with TURBO for a big hit. Late hits are legal.'))),
      h('div.panel',
        h('h3', 'RULES'),
        h('ul',
          h('li', '7-on-7. ', h('b', '4 downs to go 30 yards.')),
          h('li', 'No flags. Ever.'),
          h('li', '3 straight completions or 2 straight sacks = ', h('b.hot', 'ON FIRE'), ' (unlimited turbo).'),
          h('li', 'Punt and field goal live on the SPECIAL page.'),
          h('li', 'Tied after four? College overtime from the 25.')))),
    menu.el);
  return { el, handle: (e) => menu.handle(e) };
}

export function settingsScreen({ settings, onChange, onBack, sfx }) {
  const onOff = (key, label) => ({
    label, kind: 'select', options: [{ label: 'ON', value: true }, { label: 'OFF', value: false }], value: settings[key],
    onChange: (v) => { settings[key] = v; onChange(settings); },
  });
  const menu = new MenuList([
    onOff('sound', 'SOUND'),
    onOff('music', 'MENU MUSIC'),
    onOff('announcer', 'ANNOUNCER (TTS)'),
    { label: 'GRAPHICS', kind: 'select', options: [{ label: 'HIGH', value: 'high' }, { label: 'LOW (FASTER)', value: 'low' }], value: settings.quality, onChange: (v) => { settings.quality = v; onChange(settings); } },
    { label: 'BACK', onPress: onBack },
  ], { onBack, onMove: sfx.move, onSelect: sfx.select });
  const el = h('div.screen.settings', h('div.screen-title', 'SETTINGS'), h('div.panel.narrow', menu.el));
  return { el, handle: (e) => menu.handle(e) };
}

export function onlineScreen({ settings, prefillCode, onCreate, onJoin, onBack, sfx }) {
  const state = { code: prefillCode || '', name: settings.name || 'PLAYER', server: settings.server };
  const status = h('div.status');
  const menu = new MenuList([
    { label: 'YOUR NAME', kind: 'input', value: state.name, maxlength: 12, upper: true, onChange: (v) => (state.name = v) },
    { label: 'CREATE GAME', hint: 'GET A ROOM CODE', onPress: () => onCreate(state) },
    { label: 'ROOM CODE', kind: 'input', value: state.code, placeholder: 'ABCD', maxlength: 4, upper: true, onChange: (v) => (state.code = v) },
    { label: 'JOIN GAME', onPress: () => onJoin(state) },
    { label: 'SERVER', kind: 'input', value: state.server, maxlength: 120, onChange: (v) => (state.server = v) },
    { label: 'BACK', onPress: onBack },
  ], { onBack, onMove: sfx.move, onSelect: sfx.select });
  menu.i = prefillCode ? 3 : 1;
  menu.paint();
  const el = h('div.screen.online', h('div.screen-title', 'PLAY ONLINE'), h('div.panel.narrow', menu.el, status),
    h('div.note', 'Both players need the same game server. Run ', h('code', 'npm start'), ' on one machine (or a host like Render/Fly), then share the room code or invite link.'));
  return {
    el,
    handle: (e) => menu.handle(e),
    setStatus: (text, bad = false) => {
      status.textContent = text;
      status.classList.toggle('bad', bad);
    },
  };
}

export function lobbyScreen({ code, isHost, link, onLobby, onReady, onLeave, sfx }) {
  const ids = Object.keys(TEAMS);
  const st = { team: 'IND', quarterSec: 120, fdYards: 30, ready: false, lobby: null };
  const cards = h('div.tcards');
  const players = h('div.lobby-players');
  const copyBtn = h('button.copy', 'COPY INVITE LINK');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      copyBtn.textContent = 'COPIED!';
    } catch {
      copyBtn.textContent = link;
    }
  });
  const push = () => isHost && onLobby({ team: st.team, rules: { quarterSec: st.quarterSec, fdYards: st.fdYards } });
  const readyItem = { label: 'READY', onPress: () => { st.ready = !st.ready; readyItem.label = st.ready ? 'READY ✔ (CANCEL)' : 'READY'; menu.render(); onReady(st.ready); } };
  const items = isHost
    ? [
      { label: 'HOST TEAM', kind: 'select', options: ids.map((id) => ({ label: TEAMS[id].name, value: id })), value: st.team, onChange: (v) => { st.team = v; push(); paint(); } },
      { label: 'QUARTER LENGTH', kind: 'select', options: [60, 90, 120, 180, 300].map((s) => ({ label: `${s / 60} MIN`.replace('1.5', '1:30'), value: s })), value: st.quarterSec, onChange: (v) => { st.quarterSec = v; push(); } },
      { label: 'FIRST DOWN', kind: 'select', options: [{ label: '30 YARDS', value: 30 }, { label: '25 YARDS', value: 25 }], value: st.fdYards, onChange: (v) => { st.fdYards = v; push(); } },
      readyItem,
      { label: 'LEAVE ROOM', onPress: onLeave },
    ]
    : [readyItem, { label: 'LEAVE ROOM', onPress: onLeave }];
  const menu = new MenuList(items, { onBack: onLeave, onMove: sfx.move, onSelect: sfx.select });
  menu.i = isHost ? 3 : 0;
  menu.paint();
  const paint = () => {
    const lb = st.lobby;
    const hostTeam = lb ? lb.team : st.team;
    cards.innerHTML = '';
    for (const id of ids) {
      const t = TEAMS[id];
      const hostSide = id === hostTeam;
      const mine = isHost ? hostSide : !hostSide;
      const c = teamCard(t, { tag: mine ? 'YOU' : 'OPPONENT' });
      c.classList.toggle('mine', mine);
      cards.append(c);
    }
    players.innerHTML = '';
    const ps = lb ? lb.players : [];
    for (let i = 0; i < 2; i++) {
      const p = ps[i];
      players.append(h(`div.lp${p && p.ready ? '.ready' : ''}`, h('span.lp-role', i === 0 ? 'HOST' : 'GUEST'), h('span.lp-name', p ? p.name : 'waiting…'), h('span.lp-state', p ? (p.ready ? 'READY' : 'NOT READY') : '')));
    }
  };
  paint();
  push();
  const el = h('div.screen.lobby',
    h('div.screen-title', 'ONLINE LOBBY'),
    h('div.room', h('span.room-label', 'ROOM CODE'), h('span.room-code', code), copyBtn),
    cards, players, h('div.panel.narrow', menu.el));
  return {
    el,
    handle: (e) => menu.handle(e),
    setLobby: (lb) => {
      st.lobby = lb;
      paint();
    },
  };
}

export function pauseScreen({ online, onResume, onHowTo, onQuit, sfx }) {
  const menu = new MenuList([
    { label: online ? 'BACK TO GAME' : 'RESUME', onPress: onResume },
    { label: 'HOW TO PLAY', onPress: onHowTo },
    { label: online ? 'LEAVE MATCH' : 'QUIT TO MENU', onPress: onQuit },
  ], { onBack: onResume, onMove: sfx.move, onSelect: sfx.select });
  const el = h('div.screen.pause', h('div.screen-title', online ? 'MENU' : 'PAUSED'), online ? h('div.note', 'The game keeps running online.') : null, h('div.panel.narrow', menu.el));
  return { el, handle: (e) => menu.handle(e) };
}

export function finalScreen({ snap, teams, myTeam, online, onRematch, onMenu, sfx }) {
  const fin = snap.fin;
  const w = fin.winner;
  const head = w < 0 ? 'TIE GAME' : `${teams[w].name} WINS!`;
  const youWon = w === myTeam;
  const S = fin.stats;
  const line = (label, f) => h('tr', h('td', f(S[0])), h('th', label), h('td', f(S[1])));
  const table = h('table.stats',
    h('tr', h('td.tn', { style: { color: teams[0].colors.light === '#FFFFFF' ? '#fff' : teams[0].colors.light } }, teams[0].abbr), h('th', ''), h('td.tn', teams[1].abbr)),
    line('TOTAL YARDS', (s) => s.passYds + s.rushYds),
    line('PASSING', (s) => `${s.passComp}/${s.passAtt} · ${s.passYds}`),
    line('RUSHING', (s) => `${s.rushAtt} · ${s.rushYds}`),
    line('FIRST DOWNS', (s) => s.firstDowns),
    line('TURNOVERS', (s) => s.ints + s.fumbles),
    line('SACKS', (s) => s.sacks),
    line('BIG HITS', (s) => s.bigHits),
    line('LONGEST PLAY', (s) => s.longest));
  const menu = new MenuList([
    { label: online ? 'REMATCH' : 'PLAY AGAIN', onPress: onRematch },
    { label: 'MAIN MENU', onPress: onMenu },
  ], { onBack: onMenu, onMove: sfx.move, onSelect: sfx.select });
  const el = h('div.screen.final',
    h('div.final-head', 'FINAL'),
    h('div.final-score',
      h('div.fs-team', { style: { '--tc': teams[0].colors.primary } }, h('img', { src: logoDataURL(teams[0], 128), alt: '' }), h('span', teams[0].name), h('b', String(snap.sc[0]))),
      h('div.fs-dash', '–'),
      h('div.fs-team', { style: { '--tc': teams[1].colors.primary } }, h('b', String(snap.sc[1])), h('span', teams[1].name), h('img', { src: logoDataURL(teams[1], 128), alt: '' }))),
    h(`div.final-winner${youWon ? '.won' : ''}`, head),
    table,
    h('div.panel.narrow', menu.el));
  return { el, handle: (e) => menu.handle(e), setNote: () => {} };
}
