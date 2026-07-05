# GESTURES.md — what the games need from the wristband

Two kinds of input the games can consume:

- **Trained multi-class gestures** — the `Classifier` in `app/classifier.js`
  emits discrete gesture events with labels like `jab`, `hook`, etc. Requires
  labeled reps from `tools/collect.py` and threshold tuning against
  `tools/replay.mjs`.
- **Raw per-sample stream** — the game reads every IMU sample and does its own
  detection. No training data required; tune constants in the game's own file.

Different games use different amounts of each.

---

## Boxing (`boxing.html`)

**Trained gestures — need labeled data.** Currently the classifier is in
JAB-ONLY mode (see JOURNEY.md for why). Restore the discriminator once fresh
reps land for each label below.

| Label | Description | Signature |
|---|---|---|
| `jab` | Sharp straight forward punch from guard, snap back. | Big `+X` accel, low rotation. |
| `hook` | Horizontal hooking punch, elbow ~90°, arc across body. | Big `gy` (yaw) or `gx` (forearm roll), moderate accel. |
| `uppercut` | Upward punch from hip level, drive up. | Big `+Y` accel, pitch snap. |
| `block` (hold) | Forearm up in front of face, palm inward, hold ≥ 0.5s still. | Sustained low motion + specific orientation. |
| `idle` (hold) | Baseline noise floor — arm relaxed, don't move. | Sets rest thresholds. |
| `dodge_left` | Lean torso left, band travels with it. | Lateral accel + held roll. |
| `dodge_right` | Lean torso right. | Same, opposite sign. |
| `dodge_back` | Lean body backward, pull head away. | Backward accel, brief. |

**Priority: `jab`, `hook`, `uppercut`, `block`, `idle` first — enough for a
playable demo. Dodges are polish.**

Collect with:
```bash
cd day3/tools
python collect.py --arm 0     # right arm
python collect.py --arm 1     # left arm
node replay.mjs               # verify accuracy per label
```

---

## Bowling (`bowling.html`)

**Raw-detected — no training data needed.**

Single gesture: **`bowl_swing`**.

- Physical motion: underhand arm arc (like a real bowling delivery). Arm
  starts up/behind, swings forward and down through the release point.
- Detection: watch peak `|gyro|` over a rolling window. When gyro drops
  back below ~30% of the peak, that's the release moment. Ball launches:
  - **Speed** = `peak_gyro / GYRO_MAX` (clamped 0..1)
  - **Angle** = wrist roll or `ax` at release moment (aims left/right)
- Tuning knobs live at the top of `bowling.html`.

If the raw detector gives false positives (e.g. from any wave), fall back to
gating on a rough swing envelope: peak `|gyro| > 300 dps` **and** peak
`horizontal accel > 8 m/s²` inside the same 500ms window.

---

## Tennis (`tennis.html`)

**Raw-detected — no training data needed. Timing-critical.**

Gestures:

- **`tennis_swing_forehand`** — right-arm horizontal swing, ball in front of
  body. Similar to a hook but wider arc + you're expecting the ball at a
  specific moment.
- **`tennis_swing_backhand`** — right-arm horizontal swing crossing the body
  (right-to-left for a right-hander). Detect by sign of the yaw rate.

Detection: watch for a big rotational + translational spike (peak `|gyro|`
above ~250 dps, peak accel above ~10 m/s²) inside the "ball is hittable"
window scripted by the game.

If the swing lands inside the hittable window → return the ball. Outside → miss.

- **Return direction** = wrist tilt (roll) at moment of peak.
- **Return power** = peak accel magnitude.

Forehand vs. backhand: sign of yaw rate (`gz` or gravity-aligned `w_yaw`).
Positive = forehand (right → left across body for a right-hander),
negative = backhand.

---

## Baseball (`baseball.html`)

**Raw-detected — no training data needed. Timing-critical.**

Single gesture: **`bat_swing`**.

- Physical motion: horizontal swing, both arms out to one side (right-handed
  batter: right-shoulder-back to left-shoulder-forward). Wristband is on the
  lead arm (whichever the batter's forearm the sensor is on).
- Detection: large peak `|gyro|` (>350 dps) **inside** the "ball is in strike
  zone" window (~200ms during pitch travel).
- Contact if peak lands in window → ball flies out. Miss otherwise.

Distance / trajectory:
- **Exit velocity** = peak accel magnitude → clamps to a HOME_RUN threshold.
- **Launch angle** = wrist pitch at moment of peak. Above horizontal → fly
  ball. Below → grounder.
- **Pull vs. opposite field** = wrist yaw / horizontal swing plane.

---

## Summary: what training team needs to collect

**Highest priority (boxing demo dependencies):**

1. `jab` — 20 reps per arm
2. `hook` — 20 reps per arm
3. `uppercut` — 20 reps per arm
4. `block` — 20 reps per arm (hold mode)
5. `idle` — 20 reps per arm (hold mode)

**Nice-to-have** (only if `hook`/`uppercut` don't discriminate reliably from `jab` with the current features):

- Include a "wrist twist only" negative class (`idle_twist`) so the trained
  classifier learns to reject pure wrist rotation. Do 20 reps: just twist
  the forearm palm-up-to-palm-down without translating the hand.

**Not required for launch** — bowling / tennis / baseball detectors are all
raw-sample based. Tune the constants at the top of each game's HTML file
against how the swing feels, no training pass needed. If any of them start
firing accidentally on other gestures, we add a per-game gate later.
