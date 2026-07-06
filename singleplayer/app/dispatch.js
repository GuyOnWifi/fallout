// Route incoming CSV lines to one Classifier instance per arm.
//
// The day-3 wireless firmware prefixes every line with an ARM_ID:
//   arm,t_us,ax,ay,az,gx,gy,gz,roll,pitch     (10 fields)
//
// The day-1 wired firmware sends the unprefixed form:
//   t_us,ax,ay,az,gx,gy,gz,roll,pitch          (9 fields)
//
// This dispatcher handles both:
//   * 10 fields → parse arm id, strip it, feed remainder to per-arm classifier.
//   * 9 fields  → treat as arm 0 (backwards-compat with the tethered wristband).
//
// Also filters '#' status lines from the dongle so they never confuse the
// classifier's onSample() parser.

import { Classifier } from './classifier.js';

export class ArmDispatcher {
  /**
   * @param {(armId:number, gesture:object) => void} onGesture
   *   called when either arm's classifier fires a gesture.
   */
  constructor(onGesture) {
    this.onGesture = onGesture;
    this.classifiers = new Map();   // armId -> Classifier
    this.armsSeen = new Set();
  }

  _classifierFor(armId) {
    let clf = this.classifiers.get(armId);
    if (!clf) {
      clf = new Classifier();
      clf.onGesture = (g) => this.onGesture(armId, g);
      this.classifiers.set(armId, clf);
      this.armsSeen.add(armId);
    }
    return clf;
  }

  /** Feed a single serial line (already trimmed of trailing '\n'). */
  onLine(line) {
    if (!line || line[0] === '#' || line.startsWith('ERR')) return;
    // Fast field count without splitting twice.
    let commas = 0;
    for (let i = 0; i < line.length; i++) if (line[i] === ',') commas++;
    if (commas === 9) {
      // 10 fields → arm-prefixed.
      const firstComma = line.indexOf(',');
      const armId = +line.slice(0, firstComma);
      if (Number.isNaN(armId)) return;
      this._classifierFor(armId).onSample(line.slice(firstComma + 1));
    } else if (commas === 8) {
      // 9 fields → legacy tethered format; treat as arm 0.
      this._classifierFor(0).onSample(line);
    }
    // Anything else: ignore (short/garbled line).
  }

  /** For debug/HUD: which arm IDs have we ever received? */
  connectedArms() { return [...this.armsSeen].sort(); }
}
