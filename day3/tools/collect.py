#!/usr/bin/env python3
"""
IMmerseU — auto-capture gesture data collector.

You press ENTER once per gesture. The tool then auto-triggers on your motion,
grabs a window around each punch's peak, and moves on — no per-rep keypresses.

Two capture modes:
  * DYNAMIC (jab/hook/uppercut/overhand/dodge/parry): waits for a motion spike,
    then snapshots pre_ms + post_ms around the peak.
  * HOLD (idle/block): 3-2-1 countdown, then records 1 s of your held pose,
    with a stillness check so a wobble asks for a redo.

Run:  python collect.py
"""
import collections
import csv
import glob
import math
import sys
import threading
import time
from pathlib import Path

try:
    import serial
except ImportError:
    sys.exit("pyserial not installed. `pip install pyserial`")

COLS = ["t_us", "ax", "ay", "az", "gx", "gy", "gz", "roll", "pitch"]

SAMPLE_HZ     = 200
PRE_MS        = 500     # samples kept BEFORE the trigger peak (widened
POST_MS       = 800     # samples kept AFTER the trigger peak            from
                        # 200/400 so wind-up and full retraction are captured)
REFRACTORY_MS = 600     # dead time after a capture before re-arming
ARM_WINDOW_S  = 6.0     # seconds of window in which we listen for a rep

# Trigger thresholds — loose, tuned to fire on any real gesture but not on idle noise.
# We look at "dynamic accel" (|a| − g) OR gyro magnitude; either can trip it.
G = 9.80665
TRIG_DYN_ACCEL = 2.0     # m/s² above/below 1g (dropped from 4.0 so lighter
TRIG_GYRO      = 100.0   # deg/s               reps get captured too)

# Raw mode — no trigger, no windowing. Continuously records a full session
# per label so we see the "unfiltered" arm stream around each attempt.
RAW_DURATION_S = 4.0     # seconds recorded per rep

# Hold-mode stillness threshold — reject if motion is too high during the record window.
HOLD_STILL_ACCEL = 1.2   # m/s² dynamic
HOLD_STILL_GYRO  = 40.0  # deg/s
HOLD_DURATION_S  = 1.0

# Gesture set mirrored from kevinyhe/eureka-hacks-2026 (their Wii-boxing move
# The full training set from GESTURES.md.
#
# Priority for the boxing classifier (do these first):
#   jab, hook, uppercut, block, idle
# Nice-to-have polish:
#   dodge_left, dodge_right, dodge_back, idle_twist
# Optional for raw-detector inspection (bowling / tennis / baseball
# don't need training but capturing 5-10 reps each lets you check the
# raw signal in replay.mjs and tune the game's per-file constants):
#   bowl_swing, tennis_forehand, tennis_backhand, bat_swing
GESTURE_MODES = {
    # ---- boxing classifier, PRIMARY (what the demo actually reads) ----
    # Simplified to jab-vs-block. Hook / uppercut classification was too
    # sensitive to wrist-mount rotation; the game now treats every detected
    # swing as a hit and varies the mascot's animation for flavor.
    "jab":              "dyn",
    "block":            "hold",
    "idle":             "hold",
    # ---- everything below is optional, kept for replay + future retunes ----
    "hook":             "dyn",
    "uppercut":         "dyn",
    "dodge_left":       "dyn",
    "dodge_right":      "dyn",
    "dodge_back":       "dyn",
    "idle_twist":       "dyn",
    "bowl_swing":       "dyn",
    "tennis_forehand":  "dyn",
    "tennis_backhand":  "dyn",
    "bat_swing":        "dyn",
}
DEFAULT_GESTURES = list(GESTURE_MODES.keys())

GESTURE_HINTS = {
    "jab":              "sharp straight punch forward from guard, snap back.",
    "hook":             "horizontal hooking punch, elbow around 90 degrees, arc across the body.",
    "uppercut":         "upward punch from hip level, drive up under their chin.",
    "block":            "committed guard, both fists up covering the face, forearms vertical, hold perfectly still about 1 second.",
    "idle":             "guard pose, fists near chin, small natural sway. this is the noise floor between punches.",
    "dodge_left":       "lean torso left, the band travels sideways with your body.",
    "dodge_right":      "lean torso right.",
    "dodge_back":       "lean torso back, pull your head away.",
    "idle_twist":       "twist forearm palm-up-to-palm-down without translating. negative class.",
    "bowl_swing":       "underhand arm arc, backswing then forward and down through release.",
    "tennis_forehand":  "horizontal swing, right to left across the body, wider than a hook.",
    "tennis_backhand":  "horizontal swing crossing from left back to right.",
    "bat_swing":        "batting-cage swing, whole arm horizontal from behind to in front.",
}

# ─────────────────────────────────────────── serial reader ──

class Stream:
    def __init__(self, port, baud=115200, only_arm=None):
        self.ser = serial.Serial(port, baud, timeout=0.05)
        self.ring = collections.deque(maxlen=int(SAMPLE_HZ * 8))
        self.stop = threading.Event()
        self.sample_count = 0
        self.last_sample_t = 0.0
        # None → accept both arms (or the wired day1 stream, which has no arm prefix).
        # Set to 0 or 1 when training a specific band so the other arm's samples
        # don't pollute the ring.
        self.only_arm = only_arm
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        time.sleep(0.4)
        self.ser.reset_input_buffer()
        while not self.stop.is_set():
            line = self.ser.readline().decode(errors="ignore").strip()
            if not line or line.startswith("#") or line.startswith("ERR"):
                continue
            parts = line.split(",")
            # Two firmware formats:
            #   * day1 tethered  → 9 fields (t_us,ax,...,pitch)
            #   * day3 wireless  → 10 fields (arm,t_us,ax,...,pitch)
            # Keep only the arm we want. If self.only_arm is None, accept both.
            if len(parts) == len(COLS) + 1:
                try: arm = int(parts[0])
                except ValueError: continue
                if self.only_arm is not None and arm != self.only_arm:
                    continue
                parts = parts[1:]
            elif len(parts) != len(COLS):
                continue
            try:
                row = [float(p) for p in parts]
            except ValueError:
                continue
            # Attach a python wall-clock stamp so we can slice windows by time.
            self.ring.append((time.time(), row))
            self.sample_count += 1
            self.last_sample_t = time.time()

    def alive(self):
        return time.time() - self.last_sample_t < 0.3

    def latest_since(self, t_start):
        return [r for r in list(self.ring) if r[0] >= t_start]

    def window_around(self, t_center, pre_s, post_s):
        lo, hi = t_center - pre_s, t_center + post_s
        return [r for r in list(self.ring) if lo <= r[0] <= hi]

    def close(self):
        self.stop.set()
        self.ser.close()

# ─────────────────────────────────────────── magnitudes ──

def dyn_accel(sample_row):
    _, ax, ay, az, *_ = sample_row
    return abs(math.sqrt(ax*ax + ay*ay + az*az) - G)

def gyro_mag(sample_row):
    _, _, _, _, gx, gy, gz, *_ = sample_row
    return math.sqrt(gx*gx + gy*gy + gz*gz)

# ─────────────────────────────────────────── UI helpers ──

def prompt(msg, default=None):
    tail = f" [{default}]" if default is not None else ""
    ans = input(f"{msg}{tail}: ").strip()
    return ans if ans else (default if default is not None else "")

def prompt_int(msg, default):
    while True:
        raw = prompt(msg, str(default))
        try:
            return int(raw)
        except ValueError:
            print("  need a number.")

def pick_port():
    candidates = sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))
    if not candidates:
        return prompt("Serial port", "/dev/ttyACM0")
    if len(candidates) == 1:
        return prompt("Serial port", candidates[0])
    print("Detected serial ports:")
    for i, c in enumerate(candidates):
        print(f"  [{i}] {c}")
    while True:
        raw = prompt("Pick one", "0")
        try:
            return candidates[int(raw)]
        except (ValueError, IndexError):
            print("  invalid choice.")

def pick_gesture():
    print("\nGesture menu:")
    for i, g in enumerate(DEFAULT_GESTURES):
        mode = GESTURE_MODES[g]
        print(f"  [{i}] {g:9s} ({mode})  — {GESTURE_HINTS[g]}")
    print("  [c] custom  [q] quit session")
    while True:
        raw = prompt("Pick", "1")
        if raw.lower() == "q":
            return None
        if raw.lower() == "c":
            name = prompt("Custom gesture name")
            if not name:
                continue
            mode = prompt("Mode (dyn/hold)", "dyn")
            GESTURE_MODES[name] = "hold" if mode.startswith("h") else "dyn"
            GESTURE_HINTS[name] = "custom gesture"
            return name
        try:
            return DEFAULT_GESTURES[int(raw)]
        except (ValueError, IndexError):
            print("  invalid choice.")

def countdown(msg, seconds=3):
    for k in range(seconds, 0, -1):
        print(f"   {msg}  {k}...", end="\r", flush=True)
        time.sleep(1.0)
    print(f"   {msg}  GO!         ")

# ─────────────────────────────────────────── dynamic capture ──

def wait_for_spike(stream, deadline_t):
    """Return (peak_time, peak_metric) once a spike crosses the trigger, or None on timeout."""
    seen_start = time.time()
    peak_t = None
    peak_val = 0.0
    trigger_t = None

    while time.time() < deadline_t:
        rows = stream.latest_since(seen_start)
        if rows:
            seen_start = rows[-1][0] + 1e-6
            for t, row in rows:
                d = dyn_accel(row)
                g = gyro_mag(row)
                m = max(d / TRIG_DYN_ACCEL, g / TRIG_GYRO)  # >=1.0 means over threshold
                if m >= 1.0:
                    # Track peak while we're above threshold.
                    if trigger_t is None:
                        trigger_t = t
                    if m > peak_val:
                        peak_val = m
                        peak_t = t
                elif trigger_t is not None and (t - trigger_t) > 0.15:
                    # We had a trigger and motion has settled — that's our rep.
                    return peak_t, peak_val
        time.sleep(0.01)

    if trigger_t is not None:
        return peak_t, peak_val
    return None

def capture_dynamic(stream, label, n_reps):
    reps = []
    r = 0
    while r < n_reps:
        print(f"\n   rep {r+1}/{n_reps}  ({label})")
        countdown("get ready", 3)
        print(f"   ⚡ throw the gesture — you've got {ARM_WINDOW_S:.0f} s")

        result = wait_for_spike(stream, time.time() + ARM_WINDOW_S)
        if result is None:
            print("   ⚠  no spike detected. redo? (ENTER=yes, s=skip)")
            if prompt("", "").lower() == "s":
                r += 1
            continue

        peak_t, peak_val = result
        # Wait for the tail of the window to accumulate.
        time.sleep(POST_MS / 1000.0 + 0.05)
        samples = stream.window_around(peak_t, PRE_MS / 1000.0, POST_MS / 1000.0)

        if len(samples) < int((PRE_MS + POST_MS) / 1000.0 * SAMPLE_HZ) * 0.6:
            print(f"   ⚠  only {len(samples)} samples in window — stream may have stalled. redo.")
            continue

        peak_a = max(dyn_accel(row) for _, row in samples)
        peak_g = max(gyro_mag(row)  for _, row in samples)
        print(f"   ✓  {len(samples)} samples   peak|a-g|={peak_a:5.1f} m/s²   peak|ω|={peak_g:6.1f} °/s")
        reps.append([row for _, row in samples])
        r += 1

        # Refractory so a bounce doesn't fire again on the next iteration.
        time.sleep(REFRACTORY_MS / 1000.0)
    return reps

# ─────────────────────────────────────────── hold capture ──

def capture_hold(stream, label, n_reps):
    reps = []
    r = 0
    while r < n_reps:
        print(f"\n   rep {r+1}/{n_reps}  ({label})")
        countdown("hold pose", 3)
        t_start = time.time()
        print(f"   ⏺ recording {HOLD_DURATION_S:.0f} s — stay still")
        time.sleep(HOLD_DURATION_S + 0.05)

        samples = stream.window_around(t_start + HOLD_DURATION_S/2,
                                       HOLD_DURATION_S/2, HOLD_DURATION_S/2 + 0.05)
        if len(samples) < int(HOLD_DURATION_S * SAMPLE_HZ) * 0.6:
            print(f"   ⚠  only {len(samples)} samples — stream stall. redo.")
            continue

        peak_a = max(dyn_accel(row) for _, row in samples)
        peak_g = max(gyro_mag(row)  for _, row in samples)
        if peak_a > HOLD_STILL_ACCEL or peak_g > HOLD_STILL_GYRO:
            print(f"   ⚠  too much motion (peak|a-g|={peak_a:.1f}, peak|ω|={peak_g:.1f}). redo.")
            continue

        print(f"   ✓  {len(samples)} samples   peak|a-g|={peak_a:5.2f}   peak|ω|={peak_g:5.1f}")
        reps.append([row for _, row in samples])
        r += 1
        time.sleep(0.3)
    return reps

# ─────────────────────────────────────────── save ──

def save_reps(reps, label, out_path):
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["rep", "label"] + COLS)
        for r_idx, samples in enumerate(reps):
            for row in samples:
                w.writerow([r_idx, label] + row)
    print(f"   → wrote {len(reps)} reps to {out_path}")

# ─────────────────────────────────────────── main ──

def main():
    import argparse
    ap = argparse.ArgumentParser(description="IMmerseU — auto-capture gesture collector")
    ap.add_argument("--port", default=None,
                    help="serial port (auto-detected if omitted)")
    ap.add_argument("--arm", type=int, default=None, choices=[0, 1],
                    help="filter to a single arm id (0=right, 1=left). "
                         "Omit to accept whichever band(s) are streaming.")
    ap.add_argument("--data-dir", default="data",
                    help="output directory (default: data)")
    ap.add_argument("--reps", type=int, default=20,
                    help="default reps per gesture, overridable at the prompt (default: 20)")
    args = ap.parse_args()

    print("IMmerseU — auto-capture gesture collector")
    port = args.port or pick_port()
    try:
        stream = Stream(port, only_arm=args.arm)
    except serial.SerialException as e:
        sys.exit(f"could not open {port}: {e}")
    if args.arm is not None:
        print(f"[stream] filtering to arm={args.arm} ({'left' if args.arm == 1 else 'right'})")

    print(f"[stream] opening {port}, waiting for samples...")
    t0 = time.time()
    while stream.sample_count < 20 and time.time() - t0 < 3.0:
        time.sleep(0.1)
    if stream.sample_count < 20:
        stream.close()
        sys.exit("no CSV samples. Is the wrist firmware running? Is `pio device monitor` still open?")
    rate = stream.sample_count / (time.time() - t0)
    print(f"[stream] {stream.sample_count} samples in warm-up ({rate:.0f}/s). good.\n")

    out_dir = args.data_dir

    while True:
        label = pick_gesture()
        if label is None:
            break
        mode = GESTURE_MODES[label]
        n = prompt_int("How many reps?", args.reps)
        out = str(Path(out_dir) / f"{label}.csv")
        if Path(out).exists():
            if prompt(f"  {out} exists. overwrite? (y/n)", "y").lower() != "y":
                print("  skipping.")
                continue

        print(f"\n── collecting {label} ({mode} mode) → {out}")
        print(f"   hint: {GESTURE_HINTS[label]}")
        input("   press ENTER when strapped in and ready > ")

        try:
            if mode == "dyn":
                reps = capture_dynamic(stream, label, n)
            else:
                reps = capture_hold(stream, label, n)
        except KeyboardInterrupt:
            print("\n   interrupted mid-gesture.")
            reps = []

        if reps:
            save_reps(reps, label, out)

    stream.close()
    print("\ndone.")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\ninterrupted.")
