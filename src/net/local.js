// Single-player session: the authoritative Match runs right here in the browser.
import { Match } from '../sim/match.js';
import { DT } from '../sim/constants.js';
import { SnapshotBuffer } from './buffer.js';

export class LocalSession {
  constructor({ teams, humanTeam = 0, rules, difficulty, seed }) {
    this.kind = 'local';
    this.match = new Match({ teams, humans: [humanTeam === 0, humanTeam === 1], rules, difficulty, seed });
    this.myTeam = humanTeam;
    this.local = [humanTeam === 0, humanTeam === 1];
    this.buffer = new SnapshotBuffer(DT * 1.05);
    this.acc = 0;
    this.paused = false;
    this.info = this.match.info();
    this.buffer.push(this.match.snapshot(), this.match.drainEvents());
  }

  update(dt, input) {
    if (this.paused) return;
    this.match.setInput(this.myTeam, input);
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= DT) {
      this.acc -= DT;
      this.match.step(DT);
      this.buffer.push(this.match.snapshot(), this.match.drainEvents());
    }
  }

  sample(dt) {
    return this.buffer.sample(this.paused ? 0 : dt, this.local);
  }

  command(cmd) {
    this.match.command(this.myTeam, cmd);
  }

  setPaused(p) {
    this.paused = p;
  }

  close() {}
}
