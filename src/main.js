// App shell: menus, the game loop, and wiring between session, renderer, HUD and audio.
import '@fontsource/kanit/latin-600.css';
import '@fontsource/kanit/latin-700.css';
import '@fontsource/kanit/latin-800.css';
import '@fontsource/kanit/latin-800-italic.css';
import '@fontsource/kanit/latin-900-italic.css';
import '@fontsource/graduate/latin-400.css';
import './ui/style.css';
import { TEAMS } from './sim/teams.js';
import { Input } from './input.js';
import { AudioEngine } from './audio/audio.js';
import { GameRenderer } from './render/renderer.js';
import { LocalSession } from './net/local.js';
import { OnlineSession, defaultServerUrl, socketTransport } from './net/online.js';
import { P2PHost, connectToHost } from './net/p2p.js';
import { HUD } from './ui/hud.js';
import { PlaySelect, PatChoice } from './ui/playselect.js';
import { h, clear } from './ui/dom.js';
import { brushedMetalDataURL } from './render/textures.js';
import { titleScreen, setupScreen, howToScreen, settingsScreen, onlineScreen, lobbyScreen, pauseScreen, finalScreen } from './ui/screens.js';

const STORE = 'collegeblitz.settings.v1';
function loadSettings() {
  const base = {
    sound: true, music: true, announcer: true, quality: 'high', quarterSec: 120, fdYards: 30, difficulty: 'varsity',
    hang: 1, dives: 1, pace: 1,
    team: 'IND', name: 'PLAYER', server: defaultServerUrl(), keys: 'arrows', passing: 'icons', online: 'direct',
  };
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || '{}');
    return { ...base, ...s, server: s.server || base.server };
  } catch {
    return base;
  }
}
function saveSettings(s) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}

const PRESS_KEYS = ['a', 'j', 's', 'c0', 'c1', 'c2'];

const CALLS = {
  td: ['Touchdown!', 'He takes it to the house!', 'Six points!'],
  int: ['Intercepted!', 'Picked off!'],
  fumble: ['Fumble!', 'He coughs it up!'],
  sack: ['Sacked!', 'Quarterback down!'],
  big: ['What a hit!', 'Oh, he got crushed!', 'Bone crusher!', 'He felt that one!'],
  fire: ["He's on fire!"],
  fg: ["It's good!"],
  nofg: ['No good!'],
  first: ['First down!'],
  late: ['Late hit!'],
  noflag: ['No flag!', 'No flags in this league!', 'Interference? Not here!'],
  juke: ['Spin move!', 'Look at that move!'],
  grab: ['What a catch!', 'He went up and got it!', 'Unbelievable grab!'],
  layout: ['Diving catch!', 'He laid out for it!'],
};

class App {
  constructor() {
    this.settings = loadSettings();
    document.documentElement.style.setProperty('--steel-tex', `url(${brushedMetalDataURL()})`);
    this.canvas = document.getElementById('game');
    this.ui = document.getElementById('ui');
    this.overlayRoot = h('div.overlays');
    this.ui.append(this.overlayRoot);
    this.input = new Input(this.settings.keys);
    this.audio = new AudioEngine();
    this.audio.apply(this.settings);
    this.renderer = new GameRenderer(this.canvas, { quality: this.settings.quality });
    this.renderer.setMatch([TEAMS.IND, TEAMS.MICH]);
    this.hud = new HUD(this.ui);
    this.mode = 'menu';
    this.session = null;
    this.screen = null;
    this.overlay = null;
    this.overlayKey = '';
    this.paused = false;
    this.lastView = null;
    this.ping = 0;
    this.sfx = { move: () => this.audio.uiMove(), select: () => this.audio.uiSelect() };
    window.addEventListener('resize', () => this.renderer.resize());
    const unlock = () => {
      this.audio.unlock();
      if (this.mode === 'menu') this.audio.startMusic();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // closing the tab: tell the other player right away instead of letting them time out
    window.addEventListener('pagehide', () => this.session && this.session.kind === 'online' && this.endSession());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.session && this.session.kind === 'local' && this.mode === 'game' && !this.paused) this.openPause();
    });
    const params = new URLSearchParams(location.search);
    const join = params.get('join');
    if (join) this.showOnline(join.toUpperCase(), params.get('server') ? 'server' : 'direct');
    else this.showTitle();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- screens
  setScreen(s) {
    if (this.screen) this.screen.el.remove();
    this.screen = s;
    if (s) {
      this.overlayRoot.append(s.el);
      s.el.classList.add('enter');
    }
  }

  showTitle() {
    this.endSession();
    this.mode = 'menu';
    this.hud.show(false);
    this.renderer.setMatch([TEAMS.IND, TEAMS.MICH]);
    this.audio.startMusic();
    this.audio.crowd(0.05);
    this.setScreen(titleScreen({
      onPlay: () => this.showSetup(),
      onOnline: () => this.showOnline(),
      onHowTo: () => this.showHowTo(() => this.showTitle()),
      onSettings: () => this.showSettings(),
      sfx: this.sfx,
    }));
  }

  showSetup() {
    this.setScreen(setupScreen({
      settings: this.settings,
      onControls: (s) => this.input.setLayout(s.keys),
      onStart: (s) => {
        Object.assign(this.settings, s);
        saveSettings(this.settings);
        this.input.setLayout(this.settings.keys);
        this.startLocal();
      },
      onBack: () => {
        this.audio.uiBack();
        this.showTitle();
      },
      sfx: this.sfx,
    }));
  }

  showHowTo(back) {
    this.setScreen(howToScreen({ settings: this.settings, onBack: () => { this.audio.uiBack(); back(); }, sfx: this.sfx }));
  }

  showSettings() {
    this.setScreen(settingsScreen({
      settings: this.settings,
      onChange: (s) => {
        saveSettings(s);
        this.audio.apply(s);
        this.renderer.setQuality(s.quality);
        this.input.setLayout(s.keys);
      },
      onBack: () => {
        this.audio.uiBack();
        this.showTitle();
      },
      sfx: this.sfx,
    }));
  }

  showOnline(prefill = '', via = null) {
    this.endSession();
    this.mode = 'menu';
    this.hud.show(false);
    if (via) this.settings.online = via;
    const scr = onlineScreen({
      settings: this.settings,
      prefillCode: prefill,
      onCreate: (st) => this.connect(st, null),
      onJoin: (st) => {
        if (!/^[A-Z]{4}$/.test(st.code || '')) return scr.setStatus('Enter the 4-letter room code.', true);
        this.connect(st, st.code);
      },
      onBack: () => {
        this.audio.uiBack();
        this.showTitle();
      },
      sfx: this.sfx,
    });
    this.onlineScr = scr;
    this.setScreen(scr);
  }

  // Online play, three ways: host a direct (peer-to-peer) game in this browser, join one,
  // or use a College Blitz game server over WebSocket.
  connect(st, code) {
    this.settings.name = (st.name || 'PLAYER').slice(0, 12);
    this.settings.server = st.server || defaultServerUrl();
    this.settings.online = st.via === 'server' ? 'server' : 'direct';
    saveSettings(this.settings);
    this.endSession();
    if (this.settings.online === 'server') this.connectServer(code);
    else if (code) this.joinDirect(code);
    else this.hostDirect();
  }

  connectServer(code) {
    const scr = this.onlineScr;
    scr && scr.setStatus('Connecting…');
    let s;
    try {
      s = new OnlineSession(socketTransport(this.settings.server), { via: 'server' });
    } catch {
      scr && scr.setStatus('That server address is not valid.', true);
      return;
    }
    this.session = s;
    this.wireSession(s);
    s.on('open', () => (code ? s.join(code, this.settings.name) : s.create(this.settings.name)));
  }

  async hostDirect() {
    const scr = this.onlineScr;
    scr && scr.setStatus('Setting up your room…');
    const host = new P2PHost();
    this.pending = host;
    try {
      await host.open();
    } catch (e) {
      host.close();
      if (this.pending === host && scr) scr.setStatus(e.message, true);
      return;
    }
    if (this.pending !== host) return host.close();
    this.pending = null;
    const s = new OnlineSession(host.localTransport(), { via: 'host', minDelay: 0.035, peer: host });
    this.session = s;
    this.wireSession(s);
    s.on('open', () => s.create(this.settings.name));
    host.waitForGuest().catch((e) => {
      if (this.session === s && this.lobbyScr) this.lobbyScr.setStatus(e.message, true);
    });
  }

  async joinDirect(code) {
    const scr = this.onlineScr;
    scr && scr.setStatus(`Connecting to room ${code}…`);
    const token = { close() {} };
    this.pending = token;
    let transport;
    try {
      transport = await connectToHost(code);
    } catch (e) {
      if (this.pending === token && scr) scr.setStatus(e.message, true);
      return;
    }
    if (this.pending !== token) return transport.close();
    this.pending = null;
    const s = new OnlineSession(transport, { via: 'guest' });
    this.session = s;
    this.wireSession(s);
    s.on('open', () => s.join(code, this.settings.name));
  }

  wireSession(s) {
    const scr = this.onlineScr;
    s.on('error', (msg) => scr && scr.setStatus(msg || 'Connection failed.', true));
    s.on('err', (m) => {
      if (this.mode === 'menu' && this.screen === scr) scr.setStatus(m.msg, true);
      else if (this.mode === 'menu') {
        this.showOnline();
        this.onlineScr.setStatus(m.msg, true);
      }
    });
    s.on('room', (m) => this.showLobby(s, m));
    s.on('lobby', (m) => {
      this.lobbyLast = m.lobby;
      if (this.lobbyScr) this.lobbyScr.setLobby(m.lobby);
    });
    s.on('start', (m) => this.startOnline(s, m));
    s.on('ping', (rtt) => (this.ping = rtt));
    s.on('left', () => {
      if (this.mode === 'game') this.hud.callout('OPPONENT LEFT', 'CPU TAKES OVER', 'red', 3);
    });
    s.on('close', () => {
      // a failed connect already showed its own error message
      if (this.session !== s || !s.opened) return;
      const what = s.via === 'guest' ? 'host' : 'server';
      if (this.mode === 'game') {
        this.hud.callout('DISCONNECTED', `CONNECTION TO ${what.toUpperCase()} LOST`, 'red', 4);
        if (s.via === 'guest') {
          // the host was running the game: nothing left to play
          setTimeout(() => {
            if (this.session !== s) return;
            this.showOnline();
            this.onlineScr.setStatus('The host left or the connection dropped.', true);
          }, 3500);
        }
      } else {
        this.showOnline();
        this.onlineScr.setStatus(s.via === 'guest' ? 'Lost the connection to the host.' : 'Disconnected from the server.', true);
      }
    });
  }

  showLobby(s, m) {
    const server = s.via === 'server' ? `&server=${encodeURIComponent(this.settings.server)}` : '';
    const link = `${location.origin}${location.pathname}?join=${m.code}${server}`;
    this.lobbyScr = lobbyScreen({
      code: m.code,
      isHost: m.slot === 0,
      direct: s.via !== 'server',
      link,
      onLobby: (st) => s.lobby(st),
      onReady: (r) => s.ready(r),
      onLeave: () => {
        this.audio.uiBack();
        this.showOnline();
      },
      sfx: this.sfx,
    });
    this.setScreen(this.lobbyScr);
    if (m.lobby) this.lobbyScr.setLobby(m.lobby);
  }

  // ---------------------------------------------------------------- matches
  startLocal() {
    const mine = this.settings.team;
    const other = Object.keys(TEAMS).find((id) => id !== mine);
    this.endSession();
    this.session = new LocalSession({
      teams: [mine, other],
      humanTeam: 0,
      rules: {
        quarterSec: this.settings.quarterSec, fdYards: this.settings.fdYards,
        hang: this.settings.hang, dives: this.settings.dives, pace: this.settings.pace,
      },
      difficulty: this.settings.difficulty,
    });
    this.enterGame([TEAMS[mine], TEAMS[other]], 0);
  }

  startOnline(s, m) {
    this.session = s;
    const ids = m.info.teams;
    this.enterGame([TEAMS[ids[0]], TEAMS[ids[1]]], m.you);
  }

  enterGame(teams, myTeam) {
    this.mode = 'game';
    this.teams = teams;
    this.myTeam = myTeam;
    this.paused = false;
    this.setScreen(null);
    this.clearOverlay();
    this.renderer.setMatch(teams);
    this.hud.setTeams(teams, myTeam);
    this.hud.show(true);
    this.audio.stopMusic();
    this.audio.crowd(0.13, 1.5);
    this.psPage = 0;
  }

  endSession() {
    if (this.pending) {
      this.pending.close();
      this.pending = null;
    }
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.lobbyScr = null;
    this.clearOverlay();
  }

  clearOverlay() {
    if (this.overlay) this.overlay.el.remove();
    this.overlay = null;
    this.overlayKey = '';
  }

  setOverlay(key, make) {
    if (this.overlayKey === key) return;
    this.clearOverlay();
    if (!make) return;
    this.overlay = make();
    this.overlayKey = key;
    this.overlay.el.classList.add('enter');
    this.overlayRoot.append(this.overlay.el);
  }

  openPause() {
    const online = this.session && this.session.kind === 'online';
    this.paused = true;
    if (!online) this.session.setPaused(true);
    const back = () => this.openPause();
    this.setScreen(pauseScreen({
      online,
      onResume: () => this.closePause(),
      onHowTo: () => this.showHowTo(back),
      onQuit: () => {
        this.audio.uiBack();
        this.showTitle();
      },
      sfx: this.sfx,
    }));
  }

  closePause() {
    this.paused = false;
    this.setScreen(null);
    if (this.session) this.session.setPaused(false);
  }

  // ---------------------------------------------------------------- per-frame
  syncOverlays(view) {
    const s = view && view.snap;
    if (!s) return;
    const me = this.myTeam;
    if (s.ph === 'playSelect' && view.local[me]) {
      this.setOverlay(`ps-${s.n}-${s.pos}-${s.dn}-${s.on}-${s.conv}`, () => new PlaySelect({
        teams: this.teams,
        myTeam: me,
        snap: s,
        lastPage: s.pos === me ? this.psPage : 0,
        labels: this.input.L.labels,
        onMove: this.sfx.move,
        onPick: (id, page) => {
          if (s.pos === me) this.psPage = page < 2 ? page : 0;
          this.audio.uiSelect();
          this.session.command({ type: 'pick', id });
        },
      }));
      this.overlay && this.overlay.update && this.overlay.update(s);
    } else if (s.ph === 'patChoice' && s.pat && s.pat.team === me) {
      this.setOverlay(`pat-${s.n}`, () => new PatChoice({
        team: this.teams[me],
        onMove: this.sfx.move,
        onPick: (choice) => {
          this.audio.uiSelect();
          this.session.command({ type: 'pat', choice });
        },
      }));
      this.overlay && this.overlay.update && this.overlay.update(s);
    } else if (s.ph === 'final') {
      const online = this.session.kind === 'online';
      this.setOverlay(`final-${s.n}`, () => finalScreen({
        snap: s,
        teams: this.teams,
        myTeam: me,
        online,
        sfx: this.sfx,
        onRematch: () => {
          if (online) {
            this.session.rematch();
            this.hud.callout('REMATCH REQUESTED', 'WAITING FOR OPPONENT', 'white', 3);
          } else this.startLocal();
        },
        onMenu: () => this.showTitle(),
      }));
    } else if (this.overlay) this.clearOverlay();
  }

  sounds(events, view) {
    const A = this.audio;
    const say = (k) => A.say(CALLS[k][Math.floor(Math.random() * CALLS[k].length)]);
    for (const e of events) {
      switch (e.k) {
        case 'snap':
          if (e.kind === 'scrimmage' || e.kind === 'two') A.hike();
          break;
        case 'whistle':
          if (e.type !== 'td') A.whistle();
          break;
        case 'tackle':
          A.hit(!!e.big);
          if (e.sack) say('sack');
          else if (e.big && Math.random() < 0.6) say('big');
          break;
        case 'lateHit':
          A.hit(true);
          say('late');
          break;
        case 'interference':
          A.hit(false);
          A.ooh();
          if (Math.random() < 0.6) say('noflag');
          break;
        case 'throw':
          A.throwBall();
          break;
        case 'catch':
          A.catchBall();
          if (e.air || e.layout) {
            A.cheer(0.55, 1.6);
            if (Math.random() < 0.55) say(e.layout ? 'layout' : 'grab');
          }
          break;
        case 'dive':
          A.whoosh(0.7);
          break;
        case 'jump':
          A.whoosh(1.4);
          break;
        case 'kick':
          A.kick();
          break;
        case 'td':
          A.touchdown();
          say('td');
          break;
        case 'int':
          A.turnover();
          say('int');
          break;
        case 'fumble':
          A.turnover();
          say('fumble');
          break;
        case 'firstDown':
          A.firstDown();
          if (Math.random() < 0.5) say('first');
          break;
        case 'fire':
          A.fire();
          say('fire');
          break;
        case 'fgGood':
          A.cheer(0.9, 3);
          say('fg');
          break;
        case 'fgMiss':
          say('nofg');
          break;
        case 'juke':
        case 'spin':
          A.whoosh();
          if (e.k === 'juke' && Math.random() < 0.4) say('juke');
          break;
        case 'broken':
        case 'stiffArmed':
          A.hit(false);
          break;
        case 'downs':
        case 'safety':
          A.turnover();
          break;
        case 'set':
          A.crowd(0.1 + (view && view.snap && view.snap.dn >= 3 ? 0.08 : 0), 0.8);
          break;
        default:
          break;
      }
    }
  }

  // Button presses made while a menu is up (pause, settings) must never reach the game, or the
  // press that picks RESUME would also snap the ball. The press counters are frozen while held
  // and re-based afterwards so the game only ever sees new presses.
  gameInput(inp, hold) {
    const off = (this.pressOffset ||= { a: 0, j: 0, s: 0, c0: 0, c1: 0, c2: 0 });
    if (hold) {
      if (!this.heldPresses) this.heldPresses = Object.fromEntries(PRESS_KEYS.map((k) => [k, inp[k] - off[k]]));
      return { ...inp, mx: 0, my: 0, turbo: false, ...this.heldPresses };
    }
    if (this.heldPresses) {
      for (const k of PRESS_KEYS) off[k] = inp[k] - this.heldPresses[k];
      this.heldPresses = null;
    }
    const out = { ...inp };
    for (const k of PRESS_KEYS) out[k] = inp[k] - off[k];
    return out;
  }

  // Test hook: advance the whole client by `sec` seconds in fixed 1/60 steps, drawing once.
  debugAdvance(sec) {
    this.manual = true;
    const n = Math.max(1, Math.round(sec * 60));
    for (let i = 0; i < n; i++) this.tick(1 / 60, i < n - 1);
  }

  frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.manual) this.tick(dt, false);
    requestAnimationFrame((t) => this.frame(t));
  }

  tick(dt, skipDraw) {
    const I = this.input;
    let inp = { mx: 0, my: 0, turbo: false, a: I.a, j: I.j, s: I.s, c0: I.c[0], c1: I.c[1], c2: I.c[2] };
    try {
      inp = I.poll(dt);
    } catch (err) {
      console.error(err);
    }
    inp.pm = this.settings.passing === 'aim' ? 'aim' : 'icons';
    const evts = this.input.takeMenu();
    try {
      if (this.mode === 'game' && this.session) {
        // Esc reports both 'back' and 'pause'; treat it as one press
        const list = evts.includes('pause') ? evts.filter((e) => e !== 'back') : evts;
        for (const e of list) {
          if (e === 'pause') {
            if (!this.paused) this.openPause();
            else if (this.screen) this.screen.handle('back');
            continue;
          }
          if (this.paused && this.screen) this.screen.handle(e);
          else if (this.overlay) this.overlay.handle(e);
        }
        if (this.session) this.session.update(dt, this.gameInput(inp, this.paused));
        const { view, events } = this.session ? this.session.sample(dt) : { view: null, events: [] };
        if (view) {
          this.lastView = view;
          this.renderer.onEvents(events, view);
          this.hud.onEvents(events, view);
          this.sounds(events, view);
          if (!this.paused) this.syncOverlays(view);
          this.hud.update(view, dt, { labels: I.labels(), passing: this.settings.passing, ping: this.session && this.session.kind === 'online' && this.session.via !== 'host' ? this.ping : undefined });
        }
        const icons = this.settings.passing === 'aim' ? null : { labels: I.labels().icons, round: I.lastDevice === 'gamepad' };
        this.renderer.render(view, this.paused && this.session && this.session.kind === 'local' ? 0 : dt, { mode: 'game', skipDraw, icons });
      } else {
        const list = evts.includes('pause') ? evts.filter((e) => e !== 'pause') : evts;
        for (const e of list) if (this.screen) this.screen.handle(e);
        if (this.session && this.session.update) this.session.update(dt, inp);
        this.renderer.render(null, dt, { mode: 'title', skipDraw });
      }
    } catch (err) {
      console.error(err);
    }
  }
}

async function boot() {
  // canvas textures need the display font loaded first
  try {
    await Promise.race([
      Promise.all(['italic 900 64px Kanit', 'italic 800 64px Kanit', '800 64px Kanit', '700 64px Kanit', '600 32px Kanit', '400 64px Graduate'].map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* fall back to system fonts */
  }
  window.app = new App();
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();
