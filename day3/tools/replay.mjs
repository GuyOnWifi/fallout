// Verify the browser classifier by replaying real recorded reps through it.
// Feeds each CSV row (in "t_us,ax,ay,az,gx,gy,gz,roll,pitch" form) into
// classifier.js just as the serial line reader would, at ~real time.

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Classifier } from '../app/classifier.js';

function loadCsv(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const header = lines.shift().split(',');
  const idx = Object.fromEntries(header.map((h,i)=>[h,i]));
  const reps = new Map();
  for (const l of lines) {
    const c = l.split(',');
    const r = +c[idx.rep];
    const row = [c[idx.t_us], c.ax, c.ay, c.az, c.gx, c.gy, c.gz, c.roll, c.pitch]; // ignored
    const csv = `${c[idx.t_us]},${c[idx.ax]},${c[idx.ay]},${c[idx.az]},${c[idx.gx]},${c[idx.gy]},${c[idx.gz]},${c[idx.roll]},${c[idx.pitch]}`;
    if (!reps.has(r)) reps.set(r, []);
    reps.get(r).push(csv);
  }
  return [...reps.values()];
}

// Shim `performance.now()` to advance in fake time per sample (5ms @ 200Hz).
let fakeNow = 0;
const origNow = performance.now.bind(performance);
performance.now = () => fakeNow;

// Derive a canonical "quiet" sample from idle.csv if it exists. All punch
// recordings center on peak motion and never contain true rest, so we can't
// derive gravity from them — but idle.csv is captured as sustained still,
// which gives us a real gravity reference for the mount.
import { existsSync as _exists } from 'node:fs';
let quietFromIdle = '0,7.82,5.94,-1.93,0,0,0,0,0';   // sensible fallback (~1g)
const idlePath = new URL('./data/idle.csv', import.meta.url).pathname;
if (_exists(idlePath)) {
  const rows = readFileSync(idlePath, 'utf8').split('\n').filter(Boolean).slice(1);
  let sax=0, say=0, saz=0, n=0;
  for (const r of rows) {
    const c = r.split(',').map(Number);
    // cols: rep,label,t_us,ax,ay,az,...
    if (!isNaN(c[3])) { sax += c[3]; say += c[4]; saz += c[5]; n++; }
  }
  if (n > 0) {
    quietFromIdle = `0,${(sax/n).toFixed(3)},${(say/n).toFixed(3)},${(saz/n).toFixed(3)},0,0,0,0,0`;
    console.log(`# Using idle.csv gravity: ${quietFromIdle.slice(2)}  (${n} samples)`);
  }
}

function replayFile(path, label) {
  const reps = loadCsv(path);
  const clf = new Classifier();
  const results = [];
  clf.onGesture = (g) => results.push(g);

  // Use idle.csv (if present) as the ground-truth gravity vector for
  // between-rep quiet injection. The auto-triggered collector centers on
  // peak motion, so the recording window itself never contains true rest;
  // we cannot derive gravity from the punch data at all.
  const quietLine = quietFromIdle;

  for (const rep of reps) {

    // Warm-up: settle the classifier's gravity LPF to the rep's pose and
    // let the hasRested latch flip. 3000 samples * 5ms = 15s (fake time),
    // longer than the 850ms REFRACT so it does not matter what state the
    // previous rep left us in.
    for (let i = 0; i < 3000; i++) { fakeNow += 5; clf.onSample(quietLine); }

    // The actual gesture recording.
    for (const line of rep) { fakeNow += 5; clf.onSample(line); }

    // Trailing quiet so the state machine can fire on POST_PEAK or QUIET.
    for (let i = 0; i < 400; i++) { fakeNow += 5; clf.onSample(quietLine); }
  }

  const tally = {};
  for (const r of results) tally[r.gesture] = (tally[r.gesture]||0)+1;
  const correct = results.filter(r => r.gesture === label).length;
  console.log(`${label.padEnd(6)}  reps=${reps.length}  detections=${results.length}  correct=${correct}  tally=${JSON.stringify(tally)}`);
  console.log(`   powers: ${results.slice(0,10).map(r=>r.power.toFixed(2)).join(' ')}...`);
}

// Replay every label we have training data for. Missing files skip silently.
import { existsSync } from 'node:fs';
for (const label of ['jab', 'hook', 'uppercut', 'block', 'idle', 'dodge_left', 'dodge_right', 'dodge_back', 'idle_twist']) {
  const p = new URL(`./data/${label}.csv`, import.meta.url).pathname;
  if (existsSync(p)) replayFile(p, label);
}

performance.now = origNow;
