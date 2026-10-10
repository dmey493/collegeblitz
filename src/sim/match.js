// Match flow: possessions, downs, the clock, scoring, kicks, overtime.
// Runs identically in the browser (vs CPU) and on the server (online).

import { HZ, playerId, ballOnOfZ, zOfBallOn, ROSTER_SLOTS, IDS_PER_TEAM, DIFFICULTY } from './constants.js';
import { clamp, round2 } from './math.js';
import { makeRng } from './rng.js';
import { TEAMS } from './teams.js';
import { OFF_PLAYS, DEF_PLAYS, getPlay } from './playbook.js';
import { Play } from './play.js';
import { cpuOffense, cpuDefense, cpuPat } from './cpu.js';

const ORD = ['', '1ST', '2ND', '3RD', '4TH'];

export const blankInput = () => ({ mx: 0, my: 0, turbo: false, a: 0, j: 0 });

const newStats = () => ({
  passAtt: 0, passComp: 0, passYds: 0, rushAtt: 0, rushYds: 0, tds: 0, ints: 0, fumbles: 0,
  sacks: 0, firstDowns: 0, bigHits: 0, longest: 0, fgMade: 0, fgAtt: 0,
});

export class Match {
  constructor(opts = {}) {
    this.teamIds = opts.teams || ['IND', 'MICH'];
    this.teams = this.teamIds.map((id) => TEAMS[id]);
    this.human = [...(opts.humans || [true, false])];
    this.rules = { quarterSec: 120, fdYards: 30, ...(opts.rules || {}) };
    this.difficulty = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'varsity';
    this.seed = opts.seed ?? ((Math.random() * 2 ** 31) | 0);
    this.rng = makeRng(this.seed);
    this.time = 0;
    this.events = [];
    this.score = [0, 0];
    this.quarter = 1;
    this.clock = this.rules.quarterSec;
    this.clockExpired = false;
    this.poss = 0;
    this.ballOn = 25;
    this.down = 1;
    this.togo = this.rules.fdYards;
    this.fdOn = 25 + this.rules.fdYards;
    this.phase = 'banner';
    this.play = null;
    this.playNo = 0;
    this.turbo = [1, 1];
    this.inputs = [blankInput(), blankInput()];
    this.seen = [{ a: 0, j: 0 }, { a: 0, j: 0 }];
    this.picks = [null, null];
    this.psT = 0;
    this.cpuPickAt = [0, 0];
    this.conversion = false;
    this.stats = [newStats(), newStats()];
    this.streak = [{ comp: 0, sack: 0 }, { comp: 0, sack: 0 }];
    this.fire = [{ off: false, def: false }, { off: false, def: false }];
    this.defPref = [null, null];
    this.recentCalls = [[], []];
    this.freeze = 0;
    this.slow = 0;
    this.pendingKick = null;
    this.ot = false;
    this.otn = 0;
    this.otTurn = 0;
    this.otFirst = 0;
    this.lastResult = null;
    this.bannerLines = null;
    this.bannerT = 0;
    this.bannerNext = null;
    this.pat = null;
    this.paused = false;
    this.winner = -1;
    const recv = this.rng() < 0.5 ? 0 : 1;
    this.openingRecv = recv;
    this.setBanner(['COIN TOSS', `${this.teams[recv].name} RECEIVES`], 2.4, () => this.startKickoff(1 - recv, 35), 'toss');
  }

  // ---------------------------------------------------------------- io
  emit(e) {
    e.t = round2(this.time);
    this.events.push(e);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  setInput(team, inp) {
    const i = this.inputs[team];
    i.mx = clamp(+inp.mx || 0, -1, 1);
    i.my = clamp(+inp.my || 0, -1, 1);
    i.turbo = !!inp.turbo;
    if (Number.isFinite(inp.a)) i.a = inp.a | 0;
    if (Number.isFinite(inp.j)) i.j = inp.j | 0;
  }

  readPresses() {
    const out = [{ a: false, j: false }, { a: false, j: false }];
    for (const t of [0, 1]) {
      const i = this.inputs[t];
      const s = this.seen[t];
      if (i.a !== s.a) {
        out[t].a = true;
        s.a = i.a;
      }
      if (i.j !== s.j) {
        out[t].j = true;
        s.j = i.j;
      }
    }
    return out;
  }

  setHuman(team, isHuman) {
    this.human[team] = !!isHuman;
    if (this.play && !isHuman) this.play.ctrl[team] = null;
  }

  command(team, cmd) {
    if (!cmd || typeof cmd !== 'object') return;
    if (cmd.type === 'pick' && this.phase === 'playSelect' && !this.picks[team]) {
      const p = getPlay(cmd.id);
      if (!p) return;
      const isOff = team === this.poss;
      const valid = isOff ? OFF_PLAYS.includes(p) : DEF_PLAYS.includes(p);
      if (!valid) return;
      if (isOff && p.special && (this.conversion || (this.ot && p.id === 'punt'))) return;
      this.picks[team] = p.id;
      this.emit({ k: 'picked', team });
      this.maybeStartScrimmage();
    } else if (cmd.type === 'pat' && this.phase === 'patChoice' && this.pat && this.pat.team === team) {
      this.choosePat(cmd.choice === 'two' ? 'two' : 'kick');
    }
  }

  hitStop(freeze, slow) {
    this.freeze = Math.max(this.freeze, freeze);
    this.slow = Math.max(this.slow, slow);
  }

  // ---------------------------------------------------------------- step
  step(dt = 1 / HZ) {
    if (this.paused) return;
    this.time += dt;
    const presses = this.readPresses();
    if (this.freeze > 0) {
      this.freeze -= dt;
      return;
    }
    let sdt = dt;
    if (this.slow > 0) {
      this.slow -= dt;
      sdt = dt * 0.35;
    }
    switch (this.phase) {
      case 'banner':
        this.bannerT -= dt;
        if (this.bannerT <= 0) {
          const n = this.bannerNext;
          this.bannerNext = null;
          if (n) n();
        }
        break;
      case 'playSelect':
        this.stepPlaySelect(dt);
        break;
      case 'patChoice':
        this.pat.t -= dt;
        if (!this.human[this.pat.team] && this.pat.t < this.pat.cpuAt) this.choosePat(cpuPat(this, this.pat.team));
        else if (this.pat.t <= 0) this.choosePat('kick');
        break;
      case 'play': {
        const pl = this.play;
        pl.step(sdt, this.inputs, presses);
        if (pl.phase === 'live' && pl.clockRunning && !this.ot && !this.clockExpired) {
          this.clock = Math.max(0, this.clock - sdt);
          if (this.clock <= 0) this.clockExpired = true;
        }
        if (pl.finished) this.finishPlay();
        break;
      }
      default:
        break;
    }
    if (!(this.phase === 'play' && this.play && this.play.phase === 'live')) {
      for (const t of [0, 1]) this.turbo[t] = Math.min(1, this.turbo[t] + dt * 0.3);
    }
  }

  setBanner(lines, dur, next, kind = 'info') {
    this.phase = 'banner';
    this.bannerLines = lines;
    this.bannerKind = kind;
    this.bannerT = dur;
    this.bannerNext = next;
    this.emit({ k: 'banner', lines, kind });
  }

  // ---------------------------------------------------------------- play select
  startPlaySelect() {
    this.phase = 'playSelect';
    this.picks = [null, null];
    this.psT = 15;
    this.play = null;
    for (const t of [0, 1]) this.cpuPickAt[t] = this.rng.range(0.4, 1.1);
    this.emit({ k: 'playSelect', poss: this.poss });
  }

  stepPlaySelect(dt) {
    this.psT -= dt;
    const elapsed = 15 - this.psT;
    for (const t of [0, 1]) {
      if (this.picks[t]) continue;
      if (!this.human[t] && elapsed >= this.cpuPickAt[t]) {
        this.picks[t] = t === this.poss ? cpuOffense(this, t) : cpuDefense(this, t);
        this.emit({ k: 'picked', team: t });
      } else if (this.psT <= 0) {
        this.picks[t] = t === this.poss ? cpuOffense(this, t) : cpuDefense(this, t);
        this.emit({ k: 'picked', team: t, auto: true });
      }
    }
    this.maybeStartScrimmage();
  }

  maybeStartScrimmage() {
    if (this.phase !== 'playSelect' || !this.picks[0] || !this.picks[1]) return;
    const off = this.poss;
    const offId = this.picks[off];
    const defId = this.picks[1 - off];
    this.lastPicks = { off: offId, def: defId };
    let kind = this.conversion ? 'two' : 'scrimmage';
    if (offId === 'punt') kind = 'punt';
    if (offId === 'fg') kind = 'fg';
    this.startPlay({ kind, off, ballOn: this.ballOn, fdOn: this.fdOn, offPlayId: offId, defPlayId: defId });
    this.emit({ k: 'calls', off: offId, def: defId });
  }

  startPlay(spec) {
    this.phase = 'play';
    this.playNo++;
    this.play = new Play(this, spec);
  }

  startKickoff(kickTeam, fromOn = 35) {
    this.conversion = false;
    this.pendingKick = null;
    this.poss = 1 - kickTeam;
    this.startPlay({ kind: 'kickoff', off: kickTeam, ballOn: fromOn });
  }

  // ---------------------------------------------------------------- results
  finishPlay() {
    const play = this.play;
    const res = play.result;
    this.lastResult = res;
    this.recordStats(res, play);
    this.applyResult(res, play);
  }

  addScore(team, pts) {
    this.score[team] += pts;
    this.emit({ k: 'score', team, pts, score: [...this.score] });
    // getting scored on puts out the other side's fire
    const other = 1 - team;
    for (const side of ['off', 'def']) {
      if (this.fire[other][side]) {
        this.fire[other][side] = false;
        this.emit({ k: 'fireOut', team: other, side });
      }
    }
    this.streak[other].comp = 0;
    this.streak[other].sack = 0;
  }

  applyResult(res, play) {
    const off = play.off;
    const kind = play.kind;
    const fd = this.rules.fdYards;

    if (kind === 'pat') {
      if (res.good && !res.scored) this.addScore(off, 1);
      this.emit({ k: 'conv', team: off, good: !!res.good, two: false });
      return this.afterScore(off);
    }
    if (kind === 'two') {
      const good = res.type === 'td' && res.team === off;
      if (good) this.addScore(off, 2);
      else if (res.type === 'td') this.addScore(res.team, 2); // defensive return
      this.emit({ k: 'conv', team: off, good, two: true });
      this.conversion = false;
      return this.afterScore(off);
    }
    if (res.type === 'td') {
      if (!res.scored) this.addScore(res.team, 6);
      this.stats[res.team].tds++;
      return this.startPatChoice(res.team);
    }
    if (res.type === 'safety') {
      const scorer = 1 - res.team;
      this.addScore(scorer, 2);
      this.emit({ k: 'safety', team: scorer });
      if (this.ot) return this.endOTPossession();
      this.pendingKick = { team: res.team, on: 20 };
      return this.nextAfterPlay();
    }
    if (kind === 'fg') {
      this.stats[off].fgAtt++;
      if (res.good) {
        this.stats[off].fgMade++;
        if (!res.scored) this.addScore(off, 3);
        return this.afterScore(off);
      }
      if (this.ot) return this.endOTPossession();
      return this.newPossession(1 - off, Math.max(100 - play.ballOn, 20));
    }
    if (res.type === 'touchback') {
      if (this.ot) return this.endOTPossession();
      return this.newPossession(res.team, kind === 'kickoff' ? 25 : 20);
    }
    if (kind === 'kickoff' || kind === 'punt') {
      const team = res.team;
      const on = clamp(Math.round(ballOnOfZ(team, res.spotZ)), 1, 99);
      return this.newPossession(team, on);
    }
    // ----- scrimmage
    if (res.team !== off) {
      this.emit({ k: 'turnover', team: res.team, how: res.turnover || 'fumble' });
      if (this.ot) return this.endOTPossession();
      const on = clamp(Math.round(ballOnOfZ(res.team, res.spotZ)), 1, 99);
      return this.newPossession(res.team, on);
    }
    const newOn = res.type === 'incomplete' ? play.ballOn : clamp(Math.round(ballOnOfZ(off, res.spotZ)), 1, 99);
    const gain = newOn - play.ballOn;
    if (res.type === 'tackle' && !this.clockExpired && !this.ot) {
      this.clock = Math.max(0, this.clock - 4);
      if (this.clock <= 0) this.clockExpired = true;
    }
    if (newOn >= this.fdOn) {
      this.down = 1;
      this.ballOn = newOn;
      this.fdOn = Math.min(100, newOn + fd);
      this.togo = this.fdOn - newOn;
      this.stats[off].firstDowns++;
      this.emit({ k: 'firstDown', team: off, gain });
      this.douse(1 - off, 'def');
    } else if (this.down >= 4) {
      this.emit({ k: 'downs', team: off, gain });
      if (this.ot) return this.endOTPossession();
      return this.newPossession(1 - off, 100 - newOn, true);
    } else {
      this.down++;
      this.ballOn = newOn;
      this.togo = this.fdOn - newOn;
      this.emit({ k: 'gain', team: off, gain, down: this.down });
    }
    this.nextAfterPlay();
  }

  douse(team, side) {
    if (this.fire[team][side]) {
      this.fire[team][side] = false;
      this.emit({ k: 'fireOut', team, side });
    }
  }

  newPossession(team, on, downs = false) {
    const prev = this.poss;
    this.poss = team;
    this.ballOn = on;
    this.down = 1;
    this.fdOn = Math.min(100, on + this.rules.fdYards);
    this.togo = this.fdOn - on;
    if (prev !== team) {
      this.douse(prev, 'off');
      this.streak[prev].comp = 0;
    }
    this.emit({ k: 'possession', team, on, downs });
    this.nextAfterPlay();
  }

  nextAfterPlay() {
    if (this.clockExpired && !this.ot) return this.endQuarter();
    if (this.pendingKick) {
      const k = this.pendingKick;
      this.pendingKick = null;
      return this.startKickoff(k.team, k.on);
    }
    this.startPlaySelect();
  }

  // ---------------------------------------------------------------- PAT
  startPatChoice(team) {
    this.phase = 'patChoice';
    this.pat = { team, t: 8, cpuAt: 8 - this.rng.range(0.7, 1.3) };
    this.play = null;
    this.emit({ k: 'patChoice', team });
  }

  choosePat(choice) {
    const team = this.pat.team;
    this.pat = null;
    this.emit({ k: 'patPick', team, choice });
    if (choice === 'two') {
      this.conversion = true;
      this.poss = team;
      this.ballOn = 97;
      this.down = 1;
      this.fdOn = 100;
      this.togo = 3;
      this.startPlaySelect();
    } else {
      this.startPlay({ kind: 'pat', off: team, ballOn: 97 });
    }
  }

  afterScore(team) {
    this.conversion = false;
    if (this.ot) return this.endOTPossession();
    this.pendingKick = { team, on: 35 };
    this.nextAfterPlay();
  }

  // ---------------------------------------------------------------- clock / periods
  endQuarter() {
    this.clockExpired = false;
    const q = this.quarter;
    if (q === 1 || q === 3) {
      this.setBanner([`END OF ${ORD[q]} QUARTER`], 2.6, () => {
        this.quarter++;
        this.clock = this.rules.quarterSec;
        this.nextAfterPlay();
      }, 'quarter');
      return;
    }
    if (q === 2) {
      this.pendingKick = null;
      this.setBanner(['HALFTIME'], 4.0, () => {
        this.quarter = 3;
        this.clock = this.rules.quarterSec;
        this.startKickoff(this.openingRecv, 35);
      }, 'half');
      return;
    }
    // end of regulation
    if (this.score[0] === this.score[1]) {
      this.pendingKick = null;
      this.ot = true;
      this.otn = 1;
      this.otTurn = 0;
      this.otFirst = this.rng() < 0.5 ? 0 : 1;
      this.setBanner(['END OF REGULATION', 'OVERTIME!'], 3.0, () => this.startOTPossession(this.otFirst), 'ot');
      return;
    }
    this.endGame();
  }

  startOTPossession(team) {
    this.quarter = 5;
    this.poss = team;
    this.ballOn = 75;
    this.down = 1;
    this.fdOn = 100;
    this.togo = 25;
    this.conversion = false;
    this.pendingKick = null;
    this.setBanner([this.otn > 1 ? `OVERTIME ${this.otn}` : 'OVERTIME', `${this.teams[team].name} BALL`], 2.2, () => this.startPlaySelect(), 'ot');
  }

  endOTPossession() {
    this.conversion = false;
    this.pendingKick = null;
    this.otTurn++;
    if (this.otTurn % 2 === 1) return this.startOTPossession(1 - this.otFirst);
    if (this.score[0] !== this.score[1]) return this.endGame();
    this.otn++;
    this.otFirst = 1 - this.otFirst;
    return this.startOTPossession(this.otFirst);
  }

  endGame() {
    this.phase = 'final';
    this.play = null;
    this.winner = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
    this.emit({ k: 'final', score: [...this.score], winner: this.winner });
  }

  // ---------------------------------------------------------------- stats & streaks
  recordStats(res, play) {
    if (play.kind !== 'scrimmage' && play.kind !== 'two') {
      if (res.big) this.stats[1 - res.team].bigHits++;
      return;
    }
    const off = play.off;
    const S = this.stats[off];
    const yards = res.team === off && res.type !== 'incomplete' && res.type !== 'safety'
      ? (res.type === 'td' ? 100 - play.ballOn : Math.round(ballOnOfZ(off, res.spotZ)) - play.ballOn)
      : 0;
    if (res.big) this.stats[play.def].bigHits++;
    if (res.passThrown) {
      S.passAtt++;
      if (res.passComplete) {
        S.passComp++;
        S.passYds += yards;
      }
    } else if (res.sack) {
      this.stats[play.def].sacks++;
    } else if (play.offPlay && play.offPlay.type === 'run' || res.carrierSlot === 'QB' || res.carrierSlot === 'RB') {
      S.rushAtt++;
      S.rushYds += yards;
    }
    if (yards > S.longest) S.longest = yards;
    if (res.turnover === 'int') S.ints++;
    else if (res.turnover === 'fumble') S.fumbles++;

    // ON FIRE streaks
    const st = this.streak[off];
    if (res.passThrown) {
      if (res.passComplete) {
        st.comp++;
        if (st.comp >= 3 && !this.fire[off].off) {
          this.fire[off].off = true;
          this.emit({ k: 'fire', team: off, side: 'off' });
        }
      } else st.comp = 0;
    }
    if (res.turnover) {
      st.comp = 0;
      this.douse(off, 'off');
    }
    const ds = this.streak[play.def];
    if (res.sack) {
      ds.sack++;
      if (ds.sack >= 2 && !this.fire[play.def].def) {
        this.fire[play.def].def = true;
        this.emit({ k: 'fire', team: play.def, side: 'def' });
      }
    } else ds.sack = 0;
  }

  // ---------------------------------------------------------------- snapshot
  info() {
    const roster = {};
    for (const t of [0, 1]) {
      for (const slot of ROSTER_SLOTS) {
        const id = playerId(t, slot);
        roster[id] = { team: t, slot, num: this.teams[t].numbers[slot] };
      }
    }
    return { teams: this.teamIds, human: [...this.human], rules: { ...this.rules }, difficulty: this.difficulty, roster, idsPerTeam: IDS_PER_TEAM };
  }

  snapshot() {
    const p = this.play;
    const s = {
      t: round2(this.time),
      ph: this.phase,
      q: this.quarter,
      ot: this.ot ? this.otn : 0,
      clk: Math.ceil(this.clock),
      sc: [...this.score],
      pos: this.poss,
      on: this.ballOn,
      dn: this.down,
      tg: this.togo,
      fd: this.fdOn,
      conv: this.conversion,
      tb: [round2(this.turbo[0]), round2(this.turbo[1])],
      fire: [(this.fire[0].off ? 1 : 0) | (this.fire[0].def ? 2 : 0), (this.fire[1].off ? 1 : 0) | (this.fire[1].def ? 2 : 0)],
      hu: [...this.human],
      n: this.playNo,
    };
    if (this.phase === 'banner') s.bn = { lines: this.bannerLines, kind: this.bannerKind, t: round2(this.bannerT) };
    if (this.phase === 'playSelect') s.ps = { t: round2(Math.max(0, this.psT)), pk: [!!this.picks[0], !!this.picks[1]] };
    if (this.phase === 'patChoice') s.pat = { team: this.pat.team, t: round2(this.pat.t) };
    if (this.phase === 'final') s.fin = { winner: this.winner, stats: this.stats };
    if (p) {
      const b = p.ball;
      s.pl = {
        k: p.kind,
        ph: p.phase,
        t: round2(p.liveT),
        dir: p.dir,
        los: round2(p.losZ),
        fd: p.fdZ === null ? null : round2(p.fdZ),
        off: p.off,
        ps: p.poss,
        op: p.offPlay ? p.offPlay.id : null,
        dp: p.defPlay ? p.defPlay.id : null,
        ctl: [p.ctrl[0] ? p.ctrl[0].id : -1, p.ctrl[1] ? p.ctrl[1].id : -1],
        tg: [p.target[0] ? p.target[0].id : -1, p.target[1] ? p.target[1].id : -1],
        P: p.players.map((q) => [
          q.id, round2(q.x), round2(q.z), round2(q.y), round2(q.face), round2(q.vx), round2(q.vz),
          q.state, round2(q.st), (q.turboOn ? 1 : 0) | (q.fallFwd ? 2 : 0),
        ]),
        B: [round2(b.x), round2(b.y), round2(b.z), b.state, b.carrier ? b.carrier.id : -1, b.f ? b.f.kind : ''],
        res: p.result ? { type: p.result.type, team: p.result.team, good: p.result.good, id: p.scorer ? p.scorer.id : -1 } : null,
      };
      if (b.f) s.pl.F = [round2(b.f.fx), round2(b.f.fz), round2(b.f.tx), round2(b.f.tz), b.f.intended ? b.f.intended.id : -1, b.f.kind];
    }
    return s;
  }
}

export { zOfBallOn, ballOnOfZ };
