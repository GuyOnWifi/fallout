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

function replayFile(path, label) {
  const reps = loadCsv(path);
  const clf = new Classifier();
  const results = [];
  clf.onGesture = (g) => results.push(g);

  for (const rep of reps) {
    // Warm up the gravity estimator with the rep's own resting pose.
    // The recorded window starts with ~200ms of "before the strike" — its
    // first samples are the arm's actual pre-punch pose, so feed those in
    // repeatedly. 400 samples * 5ms = 2s → LPF (τ≈1s) settles cleanly.
    // Long warm-up so the classifier's LPF gravity converges fully to the
    // rep's actual arm pose. 3000 samples @ α=0.995 → residual < 1e-6.
    const seed = rep[0];
    for (let i = 0; i < 3000; i++) { fakeNow += 5; clf.onSample(seed); }
    for (const line of rep) { fakeNow += 5; clf.onSample(line); }
    // Trailing quiet using rep's last sample so state machine can fire.
    const tail = rep[rep.length - 1];
    for (let i = 0; i < 40; i++) { fakeNow += 5; clf.onSample(tail); }
  }

  const tally = {};
  for (const r of results) tally[r.gesture] = (tally[r.gesture]||0)+1;
  const correct = results.filter(r => r.gesture === label).length;
  console.log(`${label.padEnd(6)}  reps=${reps.length}  detections=${results.length}  correct=${correct}  tally=${JSON.stringify(tally)}`);
  console.log(`   powers: ${results.slice(0,10).map(r=>r.power.toFixed(2)).join(' ')}...`);
}

replayFile(new URL('./data/jab.csv',  import.meta.url).pathname, 'jab');

performance.now = origNow;
