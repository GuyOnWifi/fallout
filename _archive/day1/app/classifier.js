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

// LPF constant for the gravity estimate. At 200 Hz, α=0.995 → τ≈1 s:
// slow enough that a punch (~0.3 s) barely nudges it, fast enough to
// track pose changes over ~a second.
const GRAV_ALPHA = 0.995;

// Trigger / release thresholds. Jab dyn-accel peak ~25 m/s², retraction ~10.
// Arm well above retraction to keep the state machine from firing twice per punch.
const ARM_DYN_ACCEL   = 15.0;   // m/s²  — must clearly exceed idle noise
const ARM_GYRO        = 260.0;  // deg/s
const RELAX_DYN_ACCEL = 3.0;
const RELAX_GYRO      = 90.0;
const QUIET_MS        = 100;
const REFRACT_MS      = 500;
const MAX_ACTIVE_MS   = 700;

// Sanity gate: don't classify unless the ACTIVE window's peak actually
// looks like a punch. Blocks classifier from firing on brief noise spikes
// that briefly clear the ARM threshold but never build to a real punch.
const MIN_PEAK_DYNA  = 18.0;
const MIN_PEAK_GYRO  = 300.0;

// Discriminators (tuned to recorded data — see day1/tools/replay.mjs).
// Vertical thresholds set well above any residual jab down-tilt (jab max down ≈ 18).
const UPPERCUT_UP_MIN   = 15.0;
const OVERHAND_DOWN_MIN = 20.0;
const OVERHAND_DOMINATE = 1.4;  // down must clearly dominate horiz too
const JAB_HORIZ_MIN     = 15.0;
// jab   w_horiz median 314, w_mag median 340
// hook  w_horiz median 381, w_mag median 383  (from prior collection)
const HOOK_ROT_SCORE_MIN = 500.0;
// Power normalization saturation
const POWER_ACCEL_SAT = 30.0;
const POWER_GYRO_SAT  = 500.0;

export class Classifier {
  constructor() {
    this.onGesture = () => {};
    this.state = 'IDLE';
    // Gravity estimate — seeded to +Y (chip flat, sensible default).
    // The LPF will pull it to the real direction within a second or so.
    this.gx_ = 0; this.gy_ = 0; this.gz_ = G;
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

    // --- Gravity estimate: LPF the accel, but only when magnitude is roughly
    // 1 g, so a punch doesn't drag the estimate around.
    const amag = Math.hypot(ax, ay, az);
    if (Math.abs(amag - G) < 4.0) {
      this.gx_ = GRAV_ALPHA * this.gx_ + (1 - GRAV_ALPHA) * ax;
      this.gy_ = GRAV_ALPHA * this.gy_ + (1 - GRAV_ALPHA) * ay;
      this.gz_ = GRAV_ALPHA * this.gz_ + (1 - GRAV_ALPHA) * az;
    }

    // Unit "up" in sensor frame.
    const gmag = Math.hypot(this.gx_, this.gy_, this.gz_) || G;
    const ux = this.gx_ / gmag, uy = this.gy_ / gmag, uz = this.gz_ / gmag;

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

    if (this.state === 'COOLDOWN') {
      if (nowMs >= this.tCooldownUntil) this.state = 'IDLE';
      return;
    }

    const moving = dynA >= ARM_DYN_ACCEL || wmag >= ARM_GYRO;
    const quiet  = dynA <= RELAX_DYN_ACCEL && wmag <= RELAX_GYRO;

    if (this.state === 'IDLE') {
      if (moving) {
        this.state = 'ACTIVE';
        this._resetPeaks();
        this.tStartMs = nowMs;
        this._trackPeak(dynA, aUpDyn, aHoriz, wmag, wYaw, wHoriz);
      }
      return;
    }

    this._trackPeak(dynA, aUpDyn, aHoriz, wmag, wYaw, wHoriz);

    if (quiet) {
      if (this.tQuietFromMs === 0) this.tQuietFromMs = nowMs;
      if (nowMs - this.tQuietFromMs >= QUIET_MS) this._classify(nowMs);
    } else {
      this.tQuietFromMs = 0;
    }
    if (nowMs - this.tStartMs > MAX_ACTIVE_MS) this._classify(nowMs);
  }

  _trackPeak(dynA, aUpDyn, aHoriz, wmag, wYaw, wHoriz) {
    const p = this.peak;
    if (dynA > p.dynA) p.dynA = dynA;
    if (aUpDyn > p.up) p.up = aUpDyn;
    if (-aUpDyn > p.down) p.down = -aUpDyn;
    if (aHoriz > p.horiz) p.horiz = aHoriz;
    if (wmag > p.wmag) p.wmag = wmag;
    if (Math.abs(wYaw) > p.wYaw) p.wYaw = Math.abs(wYaw);
    if (wHoriz > p.wHoriz) p.wHoriz = wHoriz;
  }

  _classify(nowMs) {
    const p = this.peak;
    let gesture = null;

    // JAB-ONLY MODE: a jab is a *translational* punch. Require real linear
    // acceleration in the horizontal plane — pure wrist rotation (high wmag,
    // low horiz) must NOT fire. This mirrors the reference project, which
    // classifies on gravity-subtracted linear accel, not raw accel or gyro.
    if (p.horiz >= JAB_HORIZ_MIN && p.dynA >= MIN_PEAK_DYNA) {
      gesture = 'jab';
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
    this._resetPeaks();
  }
}
