// Streaming gesture classifier — gravity-aligned features.
//
// The wrist-rotation problem: raw sensor-frame axes (ax, gx, ...) change
// meaning when the user rolls their forearm. So we don't use them. Instead
// we low-pass the accel to get "which way is up" in the sensor frame, and
// derive orientation-invariant features:
//
//   a_up     = signed accel along gravity      (uppercut ↑ / overhand ↓)
//   a_horiz  = accel magnitude in horiz plane  (jab / hook both spike here)
//   w_mag    = total gyro magnitude            (rotational-ness)
//
// The classifier then splits on those, so rolling the wrist between reps
// no longer breaks classification.
//
// Input:  CSV "t_us,ax,ay,az,gx,gy,gz,roll,pitch"
// Output: onGesture({ gesture, power, features })

const G = 9.80665;
const DEG_TO_RAD = Math.PI / 180;

// LPF constant for the gravity estimate. At 200 Hz, α=0.995 → τ≈1 s:
// slow enough that a punch (~0.3 s) barely nudges it, fast enough to
// track pose changes over ~a second.
const GRAV_ALPHA = 0.995;

// Trigger / release thresholds. Retuned against day3/tools/data/{jab,hook,
// uppercut,block,idle}.csv on the current sensor mount (mild off-axis
// angle). Live medians for the three punches: dynA 73..90, wmag 823..959.
// Idle/block max dynA < 1.5. Huge margin.
// Trigger thresholds. Retuned against day3/tools/data on the current mount.
// Live medians for the three punches: dynA 73..90, wmag 823..959. Idle max
// dynA is below 2 and wmag under 30. Comfortable gap in the middle.
const ARM_DYN_ACCEL   = 25.0;
const ARM_GYRO        = 400.0;
const RELAX_DYN_ACCEL = 4.0;
const RELAX_GYRO      = 120.0;
const QUIET_MS        = 100;
const REFRACT_MS      = 450;    // shortened so back-to-back punches don't skip
// Classify the moment dynA has dropped this fraction below its running max
// after having been high. Catches the extension peak, ignores the retraction.
const MAX_ACTIVE_MS   = 500;
const POST_PEAK_DROP  = 0.55;
// dynA has a small wind-up bump (~40) before the real punch spike (~80).
// Set POST_PEAK_MIN above the wind-up so we don't classify on the fake peak.
// Jab 25th percentile dynA is 76, hook 77, uppercut 65 — safe floor at 60.
const POST_PEAK_MIN   = 60.0;

// Sanity gate: don't classify unless the ACTIVE window's peak actually
// looks like a punch. Blocks brief noise spikes but lets softer live
// punches through — live SKIP logs showed real punches landing at
// dynA 30..45 and wmag 250..500. Both floors dropped accordingly.
const MIN_PEAK_DYNA  = 28.0;
const MIN_PEAK_GYRO  = 350.0;

// Discriminators from day3/tools/data on the current mount:
//   jab       up  0..19  | down 25..73 | wYaw/wH 0.2..0.5
//   hook      up  8..71  | down 20..76 | wYaw/wH 0.2..0.8
//   uppercut  up 23..76  | down  0..19 | wYaw/wH 1.0..1.9
// Two axes cleanly separate the three:
//   - "up < 20"    → jab       (jab drives horizontally; almost no upward accel)
//   - "down < 20"  → uppercut  (uppercut drives upward; almost no downward accel)
//   - otherwise    → hook      (both up and down present — rotational strike)
// The wY/wH ratio backstops uppercut against odd hooks that skimp on downforce.
const JAB_UP_MAX         = 15.0;
// Live jabs sometimes carry more vertical wobble than the training set (up
// reaches 22..38). Backup path: if down clearly beats up AND is high in
// absolute terms, it's still a jab. Hooks pair down and up at ratio ~1.
const JAB_DOWN_MIN       = 40.0;
const JAB_DOWN_OVER_UP   = 2.0;
// Uppercut has two feature clusters in live data:
//   A) rotational — wY/wH ≥ 1.0 (splits cleanly from hook at 0.49..0.98)
//   B) upward-drive — big `up` peak with tiny `down` (little wind-up)
// Live hooks that happen with the wrist rotated parallel to the floor also
// show high `up` (up to 81), so up>=50 alone isn't safe. Gate the high-up
// rule on down<30 too — real uppercuts don't have significant downward peak
// because the whole motion drives upward.
const UPPERCUT_YAW_RATIO       = 1.0;
const UPPERCUT_UP_HIGH         = 50.0;
const UPPERCUT_UP_HIGH_DOWN_MAX= 30.0;
const UPPERCUT_UPDRIVE_UP_MIN  = 20.0;
const UPPERCUT_UPDRIVE_DOWN_MAX= 15.0;
// Live hook motion turned out to look uppercut-shaped in gravity axes (low
// down, high wYaw/wHoriz). The signal that still cleanly separates them is
// translational: hooks sweep horizontally (horiz >> up), uppercuts drive
// upward (horiz ~ up). If horiz beats up by this ratio, treat as a hook
// even when the yaw-ratio would otherwise call uppercut.
const HOOK_HORIZ_OVER_UP = 2.0;

// Power normalization saturation, retuned for the new magnitudes.
const POWER_ACCEL_SAT = 100.0;
const POWER_GYRO_SAT  = 950.0;

// Block detector — a "held pose" watcher that runs orthogonal to the swing
// state machine. The wristband is considered blocking once it has been
// nearly still for BLOCK_HOLD_MS. When motion resumes above BLOCK_MOTION,
// block turns off almost immediately (BLOCK_RELEASE_MS).
const BLOCK_QUIET_ACCEL  = 1.5;   // m/s² dynA — very still
const BLOCK_QUIET_GYRO   = 40.0;  // deg/s
const BLOCK_HOLD_MS      = 300;   // needs to be still for this long to arm
const BLOCK_RELEASE_MS   = 120;   // any motion for >this drops the block

export class Classifier {
  constructor() {
    this.onGesture = () => {};
    // Fires when a swing entered ACTIVE but was rejected during _classify.
    // Reason strings: 'low-dynA', 'low-wmag', 'no-rest-gate'. Feed this into
    // the tune-log so a "why didn't my punch register?" answer is visible.
    this.onSkip = () => {};
    this.state = 'IDLE';
    // Gravity estimate seeded to nothing. The first ~20 quasi-static samples
    // will snap it to the actual sensor-frame gravity direction. Until then
    // the classifier refuses to fire, because gravity-aligned features are
    // meaningless when the gravity axis is wrong.
    this.gx_ = 0; this.gy_ = 0; this.gz_ = G;
    // Gravity SNAPSHOT captured at IDLE → ACTIVE. Features during the whole
    // active window use this instead of the drifting live LPF.
    this._actGx = 0; this._actGy = 0; this._actGz = G;
    // Track previous-sample timestamp so gyro integration during ACTIVE
    // has a proper dt (not just assuming 200 Hz — the wristband may be
    // running at 100 Hz on LiPo save mode, etc).
    this._prevMs = 0;
    this.calibrated = false;
    // Block detector — separate cheap watcher. Triggers when the wristband
    // is held nearly still (dynA < 1.5, wmag < 40) for BLOCK_HOLD_MS while
    // NOT in an idle-arm pose (so we don't spam block events while the
    // player has their arm resting at their side). While blockActive is
    // true, the game gates incoming damage.
    this._blockQuietFromMs = 0;
    this.blockActive = false;
    this.onBlockChange = () => {};
    this._calibN = 0; this._calibSumX = 0; this._calibSumY = 0; this._calibSumZ = 0;
    // Once a classification fires, we refuse to arm the next one until the
    // arm has actually reached rest at least briefly. Stops the retraction
    // of a slow hook from being counted as a second hook after COOLDOWN.
    this.hasRestedSinceLast = true;
    this._resetPeaks();
  }

  _resetPeaks() {
    this.peak = {
      dynA: 0,          // |a - g_vec| peak (used for trigger + power)
      up: 0,            // max signed a_up_dyn (positive up)
      down: 0,          // max -a_up_dyn (positive == downward)
      horiz: 0,         // max horizontal accel magnitude
      wmag: 0,          // peak gyro magnitude
      wYaw: 0,          // peak |ω · up|  — rotation about gravity
      wHoriz: 0,        // peak |ω - up*(ω·up)| — rotation in horiz plane
      pgx: 0,           // peak |gx| — forearm roll rate
      pgy: 0,           // peak |gy| — forearm pitch rate (uppercut giveaway)
      pgz: 0,           // peak |gz| — forearm yaw rate (jab vs hook)
    };
    this.tStartMs = 0;
    this.tQuietFromMs = 0;
    this.tCooldownUntil = 0;
  }

  onSample(line) {
    if (!line || line[0] === '#' || line.startsWith('ERR')) return;
    const parts = line.split(',');
    if (parts.length < 9) return;
    const ax = +parts[1], ay = +parts[2], az = +parts[3];
    const gxr = +parts[4], gyr = +parts[5], gzr = +parts[6];
    if (Number.isNaN(ax) || Number.isNaN(gxr)) return;

    const amag = Math.hypot(ax, ay, az);

    // --- Fast initial calibration: accumulate ~100ms of quasi-static samples
    // then snap gravity to their mean. Prevents the 4-5 second LPF warmup
    // from producing garbage classifications right after connect.
    if (!this.calibrated) {
      if (Math.abs(amag - G) < 2.5) {
        this._calibSumX += ax; this._calibSumY += ay; this._calibSumZ += az;
        this._calibN++;
        if (this._calibN >= 20) {
          this.gx_ = this._calibSumX / this._calibN;
          this.gy_ = this._calibSumY / this._calibN;
          this.gz_ = this._calibSumZ / this._calibN;
          this.calibrated = true;
        }
      } else {
        // Not quiet, reset accumulator so we only converge on real rest.
        this._calibN = 0;
        this._calibSumX = this._calibSumY = this._calibSumZ = 0;
      }
      return;   // do not classify until we have a real gravity vector
    }

    // Idle-only LPF pulls the sensor-frame gravity vector toward the accel
    // reading when the arm is quiet. Doesn't run during ACTIVE — for that
    // we use gyro integration below, which tracks the wrist rotating during
    // the swing without being confounded by the punch's own accel.
    if (this.state === 'IDLE' && Math.abs(amag - G) < 2.5) {
      this.gx_ = GRAV_ALPHA * this.gx_ + (1 - GRAV_ALPHA) * ax;
      this.gy_ = GRAV_ALPHA * this.gy_ + (1 - GRAV_ALPHA) * ay;
      this.gz_ = GRAV_ALPHA * this.gz_ + (1 - GRAV_ALPHA) * az;
    }

    // Note: attempted gyro-integrated "live-rotated snapshot" here to track
    // wrist rotation during a swing (Mahony/Madgwick core). Reverted — 200 Hz
    // single-precision integration drifts more over a 300 ms punch than the
    // static snapshot is off by, so training-data accuracy dropped hard.
    // Proper attitude fusion (accel-when-close-to-1g feedback) would fix
    // it; that's a real project, not a demo-day tweak.

    // Unit "up" in sensor frame. During ACTIVE we use the snapshot captured
    // at IDLE→ACTIVE; when idle we use the live LPF.
    const gvx = this.state === 'ACTIVE' ? this._actGx : this.gx_;
    const gvy = this.state === 'ACTIVE' ? this._actGy : this.gy_;
    const gvz = this.state === 'ACTIVE' ? this._actGz : this.gz_;
    const gmag = Math.hypot(gvx, gvy, gvz) || G;
    const ux = gvx / gmag, uy = gvy / gmag, uz = gvz / gmag;

    // Project accel onto up + horizontal.
    const aUp   = ax*ux + ay*uy + az*uz;        // ≈ +g at rest
    const aUpDyn = aUp - gmag;                   // dynamic vertical, 0 at rest
    const hx = ax - ux*aUp, hy = ay - uy*aUp, hz = az - uz*aUp;
    const aHoriz = Math.hypot(hx, hy, hz);       // horizontal accel magnitude
    const dynA   = Math.abs(amag - gmag);        // total dynamic accel magnitude

    // Split gyro into rotation about gravity (yaw) and rotation in the
    // horizontal plane. Both are wrist-mount invariant to first order.
    const wYaw = gxr*ux + gyr*uy + gzr*uz;
    const whx = gxr - ux*wYaw, why = gyr - uy*wYaw, whz = gzr - uz*wYaw;
    const wHoriz = Math.hypot(whx, why, whz);
    const wmag = Math.hypot(gxr, gyr, gzr);
    const nowMs = performance.now();

    // NOTE: legacy sustained-still-pose block detector removed. Block is now
    // an explicit peak-detected GESTURE (upward guard motion: `up ≥ 15,
    // down ≤ 30, up ≥ 0.8·down`) fired the same way as `jab`. Merely holding
    // the arm still no longer counts — you have to throw the guard up.

    if (this.state === 'COOLDOWN') {
      if (nowMs >= this.tCooldownUntil) this.state = 'IDLE';
      return;
    }

    const moving = dynA >= ARM_DYN_ACCEL || wmag >= ARM_GYRO;
    const quiet  = dynA <= RELAX_DYN_ACCEL && wmag <= RELAX_GYRO;

    if (this.state === 'IDLE') {
      // Latch "arm has reached rest" the moment we see a quiet sample after
      // classification. Blocks the retraction of the previous throw from
      // re-arming as soon as COOLDOWN expires.
      if (quiet) this.hasRestedSinceLast = true;
      if (moving && this.hasRestedSinceLast) {
        this.state = 'ACTIVE';
        // Snapshot gravity NOW — this is the last known "at rest" pose
        // before the swing starts. The whole gesture will be projected
        // against this frame, no matter how the wrist rotates during the
        // swing itself.
        this._actGx = this.gx_;
        this._actGy = this.gy_;
        this._actGz = this.gz_;
        this._resetPeaks();
        this.tStartMs = nowMs;
        this._trackPeak(dynA, aUpDyn, aHoriz, wmag, wYaw, wHoriz, gxr, gyr, gzr);
      } else if (moving && !this.hasRestedSinceLast) {
        // Arm is moving fast enough to arm but the rest-gate is still latched.
        // Throttled emit so the retraction of the previous punch (a real
        // sustained motion) doesn't spam the log.
        if (!this._skipEmittedAt || nowMs - this._skipEmittedAt > 400) {
          this._skipEmittedAt = nowMs;
          this.onSkip('no-rest-gate', { dynA, wmag });
        }
      }
      return;
    }

    this._trackPeak(dynA, aUpDyn, aHoriz, wmag, wYaw, wHoriz, gxr, gyr, gzr);

    // Post-peak detection. Once we've seen a serious dyn peak, the moment
    // the current dynA drops to POST_PEAK_DROP × peak, the extension is
    // over and we lock in classification before retraction pollutes it.
    if (this.peak.dynA >= POST_PEAK_MIN &&
        dynA < this.peak.dynA * POST_PEAK_DROP) {
      this._classify(nowMs);
      return;
    }

    if (quiet) {
      if (this.tQuietFromMs === 0) this.tQuietFromMs = nowMs;
      if (nowMs - this.tQuietFromMs >= QUIET_MS) this._classify(nowMs);
    } else {
      this.tQuietFromMs = 0;
    }
    if (nowMs - this.tStartMs > MAX_ACTIVE_MS) this._classify(nowMs);
    this._prevMs = nowMs;
  }

  _trackPeak(dynA, aUpDyn, aHoriz, wmag, wYaw, wHoriz, gx, gy, gz) {
    const p = this.peak;
    if (dynA > p.dynA) p.dynA = dynA;
    if (aUpDyn > p.up) p.up = aUpDyn;
    if (-aUpDyn > p.down) p.down = -aUpDyn;
    if (aHoriz > p.horiz) p.horiz = aHoriz;
    if (wmag > p.wmag) p.wmag = wmag;
    if (Math.abs(wYaw) > p.wYaw) p.wYaw = Math.abs(wYaw);
    if (wHoriz > p.wHoriz) p.wHoriz = wHoriz;
    if (Math.abs(gx) > p.pgx) p.pgx = Math.abs(gx);
    if (Math.abs(gy) > p.pgy) p.pgy = Math.abs(gy);
    if (Math.abs(gz) > p.pgz) p.pgz = Math.abs(gz);
  }

  _classify(nowMs) {
    const p = this.peak;
    let gesture = null;

    // Discriminator retuned against day3/tools/data:
    //   jab distinguishes on strong DOWN accel that beats UP
    //   hook vs uppercut splits on wYaw/wHoriz ratio (hook rotates
    //   about vertical more; uppercut lives in the horizontal plane)
    if (p.dynA < MIN_PEAK_DYNA) {
      this.onSkip('low-dynA', { ...p, threshold: MIN_PEAK_DYNA });
    } else if (p.wmag < MIN_PEAK_GYRO) {
      this.onSkip('low-wmag', { ...p, threshold: MIN_PEAK_GYRO });
    }
    if (p.dynA >= MIN_PEAK_DYNA && p.wmag >= MIN_PEAK_GYRO) {
      // Two-gesture model: jab vs block. Retuned against fresh block
      // training data (tools/data/uppercut.csv, ~20 reps captured under the
      // label the game calls "block").
      //
      // Feature signatures (medians):
      //   block: up 37, down 24, dynA 46, wHoriz 436
      //   jab:   up  2, down 51, dynA 88, wHoriz 797
      //
      // Two axes cleanly split them:
      //   1. block has MUCH smaller total motion (dynA + wHoriz) than jab
      //   2. block has up ≳ down; jab is down-dominant
      //
      // Rule: block if (down ≤ 30 AND up ≥ down·0.8 AND up ≥ 15).
      const blockish = p.down <= 30 && p.up >= 15 && p.up >= p.down * 0.8;
      if (blockish) {
        gesture = 'block';
      } else {
        gesture = 'jab';
      }
    }

    if (gesture) {
      const power = Math.min(1.0, Math.max(
        p.dynA / POWER_ACCEL_SAT,
        p.wmag / POWER_GYRO_SAT
      ));
      this.onGesture({ gesture, power, features: { ...p } });
    }

    this.state = 'COOLDOWN';
    this.tCooldownUntil = nowMs + REFRACT_MS;
    this.hasRestedSinceLast = false;
    this._resetPeaks();
  }
}
