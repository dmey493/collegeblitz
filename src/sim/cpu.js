// CPU coach: play calling and fourth-down / PAT decisions.
import { OFF_PLAYS, DEF_PLAYS } from './playbook.js';

const DEEP = new Set(['sky', 'zigzag', 'corner', 'hookgo', 'cross', 'posts', 'hail']);
const QUICK = new Set(['slants', 'outs', 'curls', 'spider', 'flood', 'screen']);

export function cpuOffense(m, team) {
  const rng = m.rng;
  const on = m.ballOn;
  const lead = m.score[team] - m.score[1 - team];
  const late = m.quarter >= 4 && m.clock < 100 && !m.ot;
  if (!m.conversion && m.down === 4) {
    const fgYards = 100 - on + 17;
    const needTD = late && lead < -3;
    if (fgYards <= 50 && !needTD && !(m.ot && lead < -3)) return 'fg';
    if (on < 52 && !(late && lead < 0) && !m.ot) return 'punt';
  }
  const style = m.teams[team].style;
  const passBias = style === 'air' ? 1.3 : 0.85;
  const togo = m.conversion ? 3 : m.togo;
  const goalLine = on >= 88;
  const plays = OFF_PLAYS.filter((p) => !p.special);
  const recent = m.recentCalls[team];
  const pick = rng.weighted(plays, (p) => {
    let w = 1;
    if (p.type === 'pass') w *= passBias;
    else w *= 1.6 - passBias * 0.6;
    if (p.id === 'hail') w *= late && lead < 0 && on < 60 ? 3 : 0.15;
    if (p.id === 'sneak') w *= togo <= 2 ? 2 : 0.1;
    if (togo >= 20 && DEEP.has(p.id)) w *= 1.6;
    if (togo >= 20 && p.type === 'run') w *= 0.7;
    if (togo <= 8 && (QUICK.has(p.id) || p.type === 'run')) w *= 1.6;
    if (goalLine && (DEEP.has(p.id) && p.id !== 'corner')) w *= 0.4;
    if (recent.includes(p.id)) w *= 0.25;
    return w;
  });
  remember(m, team, pick.id);
  return pick.id;
}

export function cpuDefense(m, team) {
  const rng = m.rng;
  const togo = m.conversion ? 3 : m.togo;
  const recent = m.recentCalls[team];
  const pick = rng.weighted(DEF_PLAYS, (p) => {
    let w = 1;
    if (togo >= 22 && (p.id === 'safe' || p.id === 'deep' || p.id === 'man')) w *= 1.6;
    if (togo <= 8 && (p.id === 'stuff' || p.id === 'blitz1' || p.id === 'blitz2')) w *= 1.7;
    if (p.id === 'allout') w *= togo <= 12 ? 0.9 : 0.4;
    if (p.id === 'deep') w *= m.ballOn > 80 ? 0.2 : 0.8;
    if (recent.includes(p.id)) w *= 0.3;
    return w;
  });
  remember(m, team, pick.id);
  return pick.id;
}

function remember(m, team, id) {
  const r = m.recentCalls[team];
  r.push(id);
  if (r.length > 2) r.shift();
}

export function cpuPat(m, team) {
  const diff = m.score[team] - m.score[1 - team]; // after the TD
  if (m.ot && m.otn >= 3) return 'two';
  if (m.quarter >= 4 || m.ot) {
    if ([-2, -5, -10, 1, 5, -9, -12].includes(diff)) return 'two';
  } else if (diff === -2 || diff === 1) return 'two';
  return 'one';
}
