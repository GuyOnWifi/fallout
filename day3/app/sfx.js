// Soup Sports — sfx.js
// Zero-dependency Web Audio synthesis. Every sound is generated on the fly,
// no assets, CSP-safe. Master gain is kept low so effects sit under speech.
//
// Usage:
//   import { sfx } from './sfx.js';
//   sfx.punch(0.8);
//
// The AudioContext is created lazily on first call because browsers require
// a user gesture to resume audio. If it's still suspended after creation
// (page loaded, no interaction yet), we resume() on demand and swallow
// rejection.

let ctx = null;
let master = null;
let noiseBuf = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.setValueAtTime(0.15, ctx.currentTime);
  master.connect(ctx.destination);
  // Pre-bake a second of white noise for reuse.
  const len = ctx.sampleRate * 1.0;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

function resumeIfNeeded() {
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function init() {
  ensure();
  resumeIfNeeded();
}

// ─── helpers ───
function now() { return ctx.currentTime; }

function noise(dest, dur, { gain = 1, filterType, freq, q = 1 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  let node = src;
  if (filterType) {
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, now());
    f.Q.value = q;
    node.connect(f);
    node = f;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, now());
  g.gain.exponentialRampToValueAtTime(0.001, now() + dur);
  node.connect(g);
  g.connect(dest);
  src.start();
  src.stop(now() + dur + 0.02);
  return { src, g };
}

function tone(dest, dur, {
  type = 'sine', freq, endFreq, gain = 0.4, attack = 0.005,
} = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, now());
  if (endFreq !== undefined) {
    o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), now() + dur);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now());
  g.gain.exponentialRampToValueAtTime(gain, now() + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
  o.connect(g); g.connect(dest);
  o.start();
  o.stop(now() + dur + 0.02);
  return { o, g };
}

// clamp helper — most methods take a "power" 0..1
const clamp01 = (v) => Math.max(0, Math.min(1, isFinite(v) ? v : 0.5));

// ─── public sound methods ───
export const sfx = {
  init,

  // Snappy jab — quick noise burst + low thump.
  punch(power = 0.7) {
    if (!ensure()) return; resumeIfNeeded();
    const p = clamp01(power);
    noise(master, 0.09 + 0.03 * p, {
      filterType: 'bandpass', freq: 900 + 400 * p, q: 1.4,
      gain: 0.35 + 0.25 * p,
    });
    tone(master, 0.12, { type: 'sine', freq: 140 + 40 * p, endFreq: 55, gain: 0.35 + 0.2 * p });
  },

  // Meaty hook — lower pitched, longer thump.
  hookImpact(power = 0.8) {
    if (!ensure()) return; resumeIfNeeded();
    const p = clamp01(power);
    noise(master, 0.14, {
      filterType: 'bandpass', freq: 650, q: 0.9, gain: 0.45 + 0.2 * p,
    });
    tone(master, 0.18, { type: 'sine', freq: 110, endFreq: 40, gain: 0.5 + 0.2 * p });
    tone(master, 0.09, { type: 'triangle', freq: 220, endFreq: 90, gain: 0.15 });
  },

  // Uppercut — rising thwack.
  uppercutImpact(power = 0.9) {
    if (!ensure()) return; resumeIfNeeded();
    const p = clamp01(power);
    noise(master, 0.11, { filterType: 'bandpass', freq: 1200, q: 1.5, gain: 0.35 + 0.2 * p });
    tone(master, 0.22, { type: 'sine', freq: 80, endFreq: 240, gain: 0.5 + 0.2 * p });
  },

  // KO — big boom with a long tail.
  ko() {
    if (!ensure()) return; resumeIfNeeded();
    noise(master, 0.42, {
      filterType: 'lowpass', freq: 800, q: 0.7, gain: 0.9,
    });
    tone(master, 0.45, { type: 'sine', freq: 90, endFreq: 30, gain: 0.9 });
    tone(master, 0.6, { type: 'triangle', freq: 55, endFreq: 22, gain: 0.4 });
  },

  // Pin knock — sharp filtered noise + triangle clack.
  pinHit(power = 0.6) {
    if (!ensure()) return; resumeIfNeeded();
    const p = clamp01(power);
    noise(master, 0.06, {
      filterType: 'bandpass', freq: 1600 + 300 * p, q: 3, gain: 0.35 + 0.2 * p,
    });
    tone(master, 0.10, { type: 'triangle', freq: 380, endFreq: 180, gain: 0.35 });
  },

  // Ball roll — soft low rumble.
  ballRoll() {
    if (!ensure()) return; resumeIfNeeded();
    noise(master, 0.6, { filterType: 'lowpass', freq: 220, q: 0.9, gain: 0.25 });
  },

  // Strike celebration — chord + sparkle tinkle.
  strike() {
    if (!ensure()) return; resumeIfNeeded();
    // C-major-ish chord (C5, E5, G5) then a fifth-up sparkle.
    tone(master, 0.4, { type: 'triangle', freq: 523.25, gain: 0.35 });
    tone(master, 0.4, { type: 'triangle', freq: 659.25, gain: 0.30 });
    tone(master, 0.4, { type: 'triangle', freq: 783.99, gain: 0.28 });
    setTimeout(() => {
      if (!ctx) return;
      tone(master, 0.25, { type: 'sine', freq: 1568, endFreq: 2093, gain: 0.22 });
      tone(master, 0.20, { type: 'sine', freq: 2637, gain: 0.15 });
    }, 150);
  },

  // Gutter — sad soft whiff.
  gutter() {
    if (!ensure()) return; resumeIfNeeded();
    noise(master, 0.35, { filterType: 'lowpass', freq: 420, q: 0.6, gain: 0.35 });
    tone(master, 0.35, { type: 'sine', freq: 300, endFreq: 120, gain: 0.25 });
  },

  // Tennis rally hit — dense "thock".
  rally(power = 0.7) {
    if (!ensure()) return; resumeIfNeeded();
    const p = clamp01(power);
    noise(master, 0.05, {
      filterType: 'bandpass', freq: 2200 + 400 * p, q: 3.5, gain: 0.4 + 0.2 * p,
    });
    tone(master, 0.08, { type: 'square', freq: 520 + 100 * p, endFreq: 220, gain: 0.28 });
  },

  // Serve — racket hit + soft whoosh underneath.
  serve(power = 0.7) {
    if (!ensure()) return; resumeIfNeeded();
    const p = clamp01(power);
    noise(master, 0.18, {
      filterType: 'bandpass', freq: 1800, q: 1.2, gain: 0.4,
    });
    noise(master, 0.28, {
      filterType: 'highpass', freq: 400, q: 0.7, gain: 0.18,
    });
    tone(master, 0.10, { type: 'square', freq: 640, endFreq: 280, gain: 0.3 + 0.15 * p });
  },

  // Knife swoosh — highpass noise sliding down.
  slice() {
    if (!ensure()) return; resumeIfNeeded();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(4200, now());
    f.frequency.exponentialRampToValueAtTime(500, now() + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, now());
    g.gain.exponentialRampToValueAtTime(0.001, now() + 0.2);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(); src.stop(now() + 0.22);
  },

  // Bomb — big BOOM + sub thump.
  bombSlash() {
    if (!ensure()) return; resumeIfNeeded();
    noise(master, 0.55, { filterType: 'lowpass', freq: 900, q: 0.6, gain: 1.0 });
    tone(master, 0.6, { type: 'sine', freq: 120, endFreq: 30, gain: 1.0 });
    tone(master, 0.8, { type: 'triangle', freq: 60, endFreq: 20, gain: 0.5 });
  },

  // UI tick.
  click() {
    if (!ensure()) return; resumeIfNeeded();
    tone(master, 0.03, { type: 'sine', freq: 8000, gain: 0.25 });
  },

  // Pair chime — soft rising two-note C5 → E5.
  pairChime() {
    if (!ensure()) return; resumeIfNeeded();
    tone(master, 0.14, { type: 'sine', freq: 523.25, gain: 0.35, attack: 0.02 });
    setTimeout(() => {
      if (!ctx) return;
      tone(master, 0.18, { type: 'sine', freq: 659.25, gain: 0.4, attack: 0.02 });
    }, 110);
  },
};

export default sfx;
