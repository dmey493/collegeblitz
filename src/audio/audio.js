// Mostly procedural audio. The recorded sounds are the announcer's calls (announcer.js), the
// robot down-and-distance call (downcall.js) and, kept quiet under the mix, pad hits, grunts, the
// line's clash at the snap and crowd roars and oohs (./sfx, made with ElevenLabs sound effects).
// AUDIO IDENTITY: packed night stadium. Timbre: mechanical impacts (pad cracks = noise + thump)
// with brassy saw stabs. Key: E minor pentatonic (E G A B D).
// Success = rising E-G-B-E; failure = the same notes falling into a thud.
// Signature: the big-hit CRACK followed by the crowd's "OOOH".

import { pickLine, TAKES } from './announcer.js';
import { downCallParts } from './downcall.js';

// the build inlines each clip as a data: URL
const SFX_FILES = import.meta.glob('./sfx/*.mp3', { eager: true, query: '?url', import: 'default' });
const DOWN_FILES = import.meta.glob('./downs/*.mp3', { eager: true, query: '?url', import: 'default' });
// "hit" -> [url, ...] (hit-0.mp3, hit-1.mp3, ...)
const SAMPLES = {};
for (const [path, url] of Object.entries(SFX_FILES)) {
  const m = /\/([a-z]+)-\d+\.mp3$/.exec(path);
  if (m) (SAMPLES[m[1]] ||= []).push(url);
}
// "down-3" -> url
const DOWN_CLIPS = {};
for (const [path, url] of Object.entries(DOWN_FILES)) {
  const m = /\/([a-z0-9-]+)\.mp3$/.exec(path);
  if (m) DOWN_CLIPS[m[1]] = url;
}

// where the speech in a clip stops (the echo tail runs on under the next piece)
const speechEnds = new WeakMap();
function speechEnd(buf) {
  let end = speechEnds.get(buf);
  if (end == null) {
    const d = buf.getChannelData(0);
    const w = Math.round(buf.sampleRate * 0.01);
    const rms = [];
    for (let i = 0; i + w <= d.length; i += w) {
      let sum = 0;
      for (let j = i; j < i + w; j++) sum += d[j] * d[j];
      rms.push(Math.sqrt(sum / w));
    }
    const floor = Math.max(...rms) * 0.1; // 20 dB under the loudest moment
    let last = rms.length - 1;
    while (last > 0 && rms[last] < floor) last--;
    end = Math.min(buf.duration, (last + 1) * 0.01 + 0.03);
    speechEnds.set(buf, end);
  }
  return end;
}

// calls that may cut off whatever the announcer is in the middle of
const URGENT_CALLS = new Set(['td', 'int', 'fumble', 'safety', 'fg', 'nofg']);

const NOTE = { E2: 82.41, G2: 98.0, A2: 110.0, B2: 123.47, D3: 146.83, E3: 164.81, G3: 196.0, A3: 220.0, B3: 246.94, D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0, B4: 493.88, D5: 587.33, E5: 659.25, G5: 783.99, B5: 987.77, E6: 1318.5 };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.settings = { sound: true, music: true, announcer: true };
    this.musicOn = false;
    this.crowdLevel = 0.1;
    this.lastHit = 0;
    this.voices = null;
    this.clipBufs = new Map();
    this.voiceSeq = 0;
    this.voiceSrcs = [];
    this.voiceUntil = 0;
    this.lastTake = {};
    this.lastSample = {};
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.settings.sound ? 0.8 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = 1.15;
    this.voiceBus.connect(this.master);
    // the recorded hits, grunts and crowd sit well under the announcer: there, not loud
    this.fxBus = ctx.createGain();
    this.fxBus.gain.value = 0.5;
    this.fxBus.connect(this.master);
    // decode every recorded clip up front so they fire on the frame of the play
    const urls = [...Object.values(TAKES).flat(), ...Object.values(SAMPLES).flat(), ...Object.values(DOWN_CLIPS)];
    for (const url of urls) this.clipBuffer(url).catch(() => {});
    // noise buffers
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    this.white = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const wd = this.white.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    this.startCrowd();
    if (this.wantMusic) this.startMusic();
  }

  apply(settings) {
    Object.assign(this.settings, settings);
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.settings.sound ? 0.8 : 0, this.ctx.currentTime, 0.05);
    if (!this.settings.music) this.stopMusic();
    else if (this.wantMusic) this.startMusic();
  }

  get t() {
    return this.ctx.currentTime;
  }

  // ---------------------------------------------------------------- building blocks
  env(g, t, a, peak, d, sustain = 0) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
  }

  tone(freq, { type = 'sine', t = this.t, a = 0.005, d = 0.15, peak = 0.3, slideTo, dest = this.sfx, detune = 0 } = {}) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + a + d);
    this.env(g, t, a, peak, d);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + a + d + 0.05);
    return o;
  }

  burst({ t = this.t, a = 0.002, d = 0.08, peak = 0.4, type = 'bandpass', freq = 1500, q = 1, sweepTo, dest = this.sfx, buf } = {}) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf || this.white;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + a + d);
    f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, a, peak, d);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(t + a + d + 0.05);
  }

  brass(notes, { t = this.t, d = 0.18, peak = 0.12, gap = 0 } = {}) {
    notes.forEach((n, i) => {
      const tt = t + i * gap;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, tt);
      f.frequency.exponentialRampToValueAtTime(3200, tt + 0.04);
      f.frequency.exponentialRampToValueAtTime(1200, tt + d);
      f.connect(this.sfx);
      for (const det of [-8, 7]) this.tone(NOTE[n], { type: 'sawtooth', t: tt, a: 0.01, d, peak: peak / 2, dest: f, detune: det });
    });
  }

  // ---------------------------------------------------------------- crowd
  startCrowd() {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 650;
    bp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.0001;
    s.connect(bp).connect(lp).connect(this.crowdGain).connect(this.master);
    s.start();
    this.crowdFilter = bp;
  }

  crowd(level, time = 0.5) {
    if (!this.ctx) return;
    this.crowdLevel = level;
    this.crowdGain.gain.setTargetAtTime(Math.max(0.0001, level), this.t, time);
  }

  cheer(amount = 1, dur = 2.5) {
    if (!this.ctx) return;
    const t = this.t;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this.crowdLevel + 0.45 * amount, t, 0.08);
    g.setTargetAtTime(this.crowdLevel, t + dur * 0.5, dur * 0.4);
    this.crowdFilter.frequency.setTargetAtTime(900, t, 0.1);
    this.crowdFilter.frequency.setTargetAtTime(650, t + dur * 0.5, 0.6);
  }

  ooh() {
    if (!this.ctx) return;
    if (SAMPLES.ooh) {
      this.sample('ooh', { gain: 0.8, delay: 0.08, spread: 0.03 });
      return;
    }
    const t = this.t + 0.05;
    for (const [f0, f1] of [[520, 300], [780, 420]]) this.burst({ t, a: 0.12, d: 0.9, peak: 0.16, freq: f0, sweepTo: f1, q: 3, buf: this.noise });
  }

  // a recorded sound effect ('hit', 'grunt', 'clash', 'roar', 'ooh'): a random take, never the
  // same one twice running, at a slightly different pitch each time
  sample(name, { gain = 1, delay = 0, spread = 0.06 } = {}) {
    if (!this.ctx || !this.settings.sound) return;
    const urls = SAMPLES[name];
    if (!urls) return;
    const at = this.t + delay;
    // a pile of bodies is one crunch, not ten
    if (at - (this.lastSample[name] ?? -1) < 0.09) return;
    this.lastSample[name] = at;
    let i = Math.floor(Math.random() * urls.length);
    if (urls.length > 1 && i === this.lastTake[name]) i = (i + 1) % urls.length;
    this.lastTake[name] = i;
    this.clipBuffer(urls[i]).then((buf) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * spread;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(this.fxBus);
      src.start(Math.max(at, this.t));
    }, () => {});
  }

  // ---------------------------------------------------------------- sfx
  whistle() {
    if (!this.ctx) return;
    const t = this.t;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 38;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 140;
    lfo.connect(lfoG);
    for (const f of [2850, 3120]) {
      const o = this.tone(f, { t, a: 0.02, d: 0.34, peak: 0.07 });
      lfoG.connect(o.frequency);
    }
    lfo.start(t);
    lfo.stop(t + 0.45);
    this.burst({ t, a: 0.02, d: 0.3, peak: 0.05, freq: 3000, q: 2 });
  }

  hit(big = false) {
    if (!this.ctx) return;
    const t = this.t;
    if (t - this.lastHit < 0.05) return;
    this.lastHit = t;
    const v = 0.96 + Math.random() * 0.08;
    this.tone(95 * v, { t, a: 0.003, d: big ? 0.28 : 0.15, peak: big ? 0.9 : 0.55, slideTo: 42 });
    this.burst({ t, d: big ? 0.12 : 0.05, peak: big ? 0.7 : 0.35, type: 'highpass', freq: 1400 * v });
    this.burst({ t: t + 0.01, d: 0.09, peak: big ? 0.5 : 0.2, freq: 450, q: 0.8 });
    if (big) {
      this.burst({ t: t + 0.015, d: 0.22, peak: 0.45, type: 'bandpass', freq: 2600, q: 0.6 });
      this.ooh();
    }
  }

  hike() {
    if (!this.ctx) return;
    const t = this.t;
    for (const tt of [t, t + 0.22]) {
      this.burst({ t: tt, a: 0.005, d: 0.08, peak: 0.25, freq: 750, q: 3 });
      this.burst({ t: tt, a: 0.005, d: 0.07, peak: 0.18, freq: 1250, q: 4 });
      this.tone(150, { t: tt, type: 'sawtooth', a: 0.004, d: 0.07, peak: 0.08, slideTo: 110 });
    }
  }

  throwBall() {
    if (!this.ctx) return;
    this.burst({ a: 0.01, d: 0.28, peak: 0.22, freq: 400, sweepTo: 2200, q: 1.2 });
  }

  catchBall() {
    if (!this.ctx) return;
    this.tone(190, { a: 0.002, d: 0.07, peak: 0.35, slideTo: 120 });
    this.burst({ d: 0.03, peak: 0.25, type: 'highpass', freq: 2500 });
  }

  kick() {
    if (!this.ctx) return;
    this.tone(160, { a: 0.002, d: 0.1, peak: 0.7, slideTo: 60 });
    this.tone(420, { a: 0.002, d: 0.05, peak: 0.3, slideTo: 220 });
  }

  // pitch: < 1 a heavier body through the air (a dive), > 1 a quick hop
  whoosh(pitch = 1) {
    if (!this.ctx) return;
    this.burst({ a: 0.02, d: 0.22 / Math.sqrt(pitch), peak: 0.18, freq: 300 * pitch, sweepTo: 1500 * pitch, q: 0.8 });
  }

  // ---------------------------------------------------------------- ui + stingers
  uiMove() {
    if (!this.ctx) return;
    this.tone(NOTE.E6 * (0.98 + Math.random() * 0.04), { type: 'square', a: 0.002, d: 0.03, peak: 0.035 });
  }

  uiSelect() {
    if (!this.ctx) return;
    this.brass(['E4', 'B4', 'E5'], { d: 0.16, peak: 0.12 });
    this.hit(false);
  }

  uiBack() {
    if (!this.ctx) return;
    this.tone(NOTE.B5, { type: 'square', a: 0.002, d: 0.04, peak: 0.03 });
    this.tone(NOTE.E5, { type: 'square', t: this.t + 0.05, a: 0.002, d: 0.05, peak: 0.03 });
  }

  firstDown() {
    if (!this.ctx) return;
    this.brass(['E4', 'B4'], { d: 0.14, gap: 0.09, peak: 0.13 });
  }

  touchdown() {
    if (!this.ctx) return;
    const t = this.t;
    this.brass(['E4', 'G4', 'B4'], { t, d: 0.12, gap: 0.1, peak: 0.14 });
    this.brass(['E4', 'B4', 'E5', 'G5'], { t: t + 0.32, d: 0.9, peak: 0.16 });
    this.cheer(1.2, 5);
  }

  turnover() {
    if (!this.ctx) return;
    const t = this.t;
    this.brass(['B3', 'G3', 'E3'], { t, d: 0.16, gap: 0.12, peak: 0.13 });
    this.tone(70, { t: t + 0.38, a: 0.003, d: 0.4, peak: 0.6, slideTo: 38 });
    this.cheer(0.7, 2.5);
  }

  fire() {
    if (!this.ctx) return;
    const t = this.t;
    this.burst({ t, a: 0.3, d: 0.8, peak: 0.3, type: 'bandpass', freq: 300, sweepTo: 3000, q: 0.7, buf: this.noise });
    for (let i = 0; i < 14; i++) this.burst({ t: t + Math.random() * 1.1, d: 0.02, peak: 0.12, type: 'highpass', freq: 3000 });
    this.brass(['E4', 'G4', 'B4', 'D5', 'E5'], { t: t + 0.25, d: 0.1, gap: 0.07, peak: 0.1 });
  }

  // ---------------------------------------------------------------- menu music
  startMusic() {
    this.wantMusic = true;
    if (!this.ctx || !this.settings.music || this.musicOn) return;
    this.musicOn = true;
    this.musicBus.gain.setTargetAtTime(0.32, this.t, 0.3);
    const bpm = 140;
    const step = 60 / bpm / 4; // 16ths
    let n = 0;
    let next = this.t + 0.1;
    const bass = ['E2', 'E2', 'E3', 'E2', 'G2', 'E2', 'A2', 'B2', 'E2', 'E2', 'E3', 'E2', 'D3', 'B2', 'A2', 'G2'];
    const chords = [['E3', 'B3'], ['E3', 'B3'], ['G3', 'D4'], ['A3', 'E4']];
    const tick = () => {
      if (!this.musicOn) return;
      while (next < this.t + 0.12) {
        const s16 = n % 16;
        const bar = Math.floor(n / 16) % 4;
        const dest = this.musicBus;
        if (s16 % 4 === 0 || s16 === 10) this.tone(62, { t: next, a: 0.002, d: 0.18, peak: 0.6, slideTo: 38, dest });
        if (s16 === 4 || s16 === 12) {
          this.burst({ t: next, d: 0.14, peak: 0.32, freq: 1900, q: 0.7, dest });
          this.tone(210, { t: next, a: 0.002, d: 0.07, peak: 0.2, slideTo: 150, dest });
        }
        if (s16 % 2 === 0) this.burst({ t: next, d: 0.03, peak: s16 % 4 === 2 ? 0.12 : 0.06, type: 'highpass', freq: 7500, dest });
        if (s16 % 2 === 0) {
          const f = NOTE[bass[(s16 / 2 + bar * 8) % 16]];
          const lp = this.ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 520;
          lp.connect(dest);
          this.tone(f, { type: 'sawtooth', t: next, a: 0.005, d: step * 1.7, peak: 0.22, dest: lp });
        }
        if (s16 === 0 || s16 === 6 || s16 === 12) {
          const ch = chords[bar];
          const lp = this.ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 1800;
          lp.connect(dest);
          for (const nn of ch) for (const det of [-10, 10]) this.tone(NOTE[nn], { type: 'sawtooth', t: next, a: 0.005, d: s16 === 12 ? step * 3.5 : step * 1.6, peak: 0.07, dest: lp, detune: det });
        }
        next += step;
        n++;
      }
      this.musicTimer = setTimeout(tick, 25);
    };
    tick();
  }

  stopMusic(keepWant = false) {
    if (!keepWant) this.wantMusic = false;
    this.musicOn = false;
    clearTimeout(this.musicTimer);
    if (this.ctx) this.musicBus.gain.setTargetAtTime(0, this.t, 0.2);
  }

  // ---------------------------------------------------------------- announcer
  // A call ('td', 'big', ...): a recorded ElevenLabs take when the line has one, otherwise the
  // browser reads it out.
  announce(key) {
    // the quips run two or three seconds: a minor call waits its turn rather than cutting one off
    if (this.ctx && this.t < this.voiceUntil - 0.2 && !URGENT_CALLS.has(key)) return;
    const line = pickLine(key);
    if (!line) return;
    if (line.url && this.ctx) this.playVoice(line.url, line.text);
    else this.say(line.text);
  }

  // The robot at the line: "THIRD AND TWELVE", "FIRST AND GOAL". It takes over from the announcer,
  // and his quips wait until it's done.
  downCall(dn, tg, goal) {
    if (!this.ctx || !this.settings.announcer || !this.settings.sound) return;
    const urls = downCallParts(dn, tg, goal).map((n) => DOWN_CLIPS[n]);
    if (!urls.length || !urls.every(Boolean)) return;
    const id = ++this.voiceSeq;
    Promise.all(urls.map((u) => this.clipBuffer(u))).then((bufs) => {
      if (id !== this.voiceSeq) return;
      this.stopVoice();
      let at = this.t + 0.03;
      for (const buf of bufs) {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.voiceBus);
        src.start(at);
        this.voiceSrcs.push(src);
        at += speechEnd(buf);
      }
      this.voiceUntil = at + 0.2;
    }, () => {});
  }

  stopVoice() {
    for (const src of this.voiceSrcs) {
      try {
        src.stop();
      } catch {
        /* already finished */
      }
    }
    this.voiceSrcs = [];
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  clipBuffer(url) {
    let p = this.clipBufs.get(url);
    if (!p) {
      p = (async () => {
        let bytes;
        if (url.startsWith('data:')) {
          // inlined by the build: decode it here (the page may not be allowed to fetch data: URLs)
          const bin = atob(url.slice(url.indexOf(',') + 1));
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } else bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        return this.ctx.decodeAudioData(bytes.buffer);
      })();
      this.clipBufs.set(url, p);
    }
    return p;
  }

  playVoice(url, text) {
    if (!this.settings.announcer || !this.settings.sound) return;
    const id = ++this.voiceSeq;
    this.clipBuffer(url).then((buf) => {
      if (id !== this.voiceSeq) return; // a newer call came in while this one decoded
      // one announcer: a new call cuts off the last one
      this.stopVoice();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voiceBus);
      src.start();
      this.voiceSrcs.push(src);
      this.voiceUntil = this.t + buf.duration;
    }, () => this.say(text));
  }

  // fallback for lines with no recording yet (text-to-speech)
  say(text, { rate = 1.12, pitch = 0.75, interrupt = true } = {}) {
    if (!this.settings.announcer || !this.settings.sound || !window.speechSynthesis) return;
    try {
      const synth = window.speechSynthesis;
      if (interrupt) {
        this.voiceSeq++;
        if (this.ctx) this.stopVoice();
        else synth.cancel();
      }
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      u.pitch = pitch;
      u.volume = 1;
      if (!this.voices) this.voices = synth.getVoices();
      const v = this.voices.find((x) => /en-US/i.test(x.lang) && /male|david|daniel|alex|fred/i.test(x.name)) || this.voices.find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      synth.speak(u);
    } catch {
      /* speech not available */
    }
  }
}
