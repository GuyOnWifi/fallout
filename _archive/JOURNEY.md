# IMmerseU — build journey

Chronological log of what we hit and how we got past it. Written for the next
person (probably future us) who needs to know *why* the code looks the way it
does. Everything below actually happened.

---

## Day 1 — feature stream, classifier, first demo

### Wiring the MPU6050

Started with a GY-521 MPU6050 breakout to a XIAO ESP32-S3.
Verified default pinout: **SDA → D4/GPIO5, SCL → D5/GPIO6, VCC → 3V3-OUT, GND**,
AD0 floating (I²C addr `0x68`). GY-521 has onboard pull-ups so no extra resistors.

### First flash: linker failure

First PIO build failed with `undefined reference to setup / loop`. Cause:
default `src_dir` for a PIO project is `src/` next to `platformio.ini`, but I'd
put main.cpp at `wrist/src/main.cpp`. Fix: add `[platformio] src_dir = wrist/src`
to `platformio.ini`. Two-line change, ten minutes lost.

### Second flash: MPU6050 not found

Firmware built and Serial worked, but `Adafruit_MPU6050::begin()` failed. Added
an I²C bus scan — device answered at `0x68` (so wiring was fine and power was
fine), but the library refused it. Read WHO_AM_I directly and got **`0x70`**,
which is **MPU6500, not MPU6050**. This is a super common bait-and-switch on
cheap "MPU6050" breakouts; the vendor swaps the chip and keeps the silkscreen.

Adafruit's driver strictly checks WHO_AM_I so it won't touch a 6500. Options:
find a 6500-compatible library, or hand-write a minimal driver. MPU6050 and
MPU6500 share the same register map for basic accel+gyro, so I dropped the
Adafruit deps entirely and wrote ~40 lines of raw `Wire` code. Works with either
chip and now the firmware doesn't have library churn to deal with.

### Feature stream working

Complementary filter, 200 Hz, `t_us,ax,ay,az,gx,gy,gz,roll,pitch` CSV over USB
CDC. Two config gotchas worth remembering:

1. `-DARDUINO_USB_CDC_ON_BOOT=1` is mandatory on the S3 — without it, `Serial`
   silently prints nothing over USB-C on PIO, no error.
2. Adafruit's lib reports gyro in **rad/s** — the raw MPU register lets you
   read directly as `raw / 16.4 = deg/s` at ±2000 dps, which is what we want
   for human-readable thresholds. We use deg/s throughout.

Sanity checked at rest: `|a| ≈ 9.8`, gyro noise 1–2 dps. Clean.

### Data collector, take 1: manual ENTER

First collector was cmdline-driven — "press ENTER at the moment of the punch."
User couldn't do that while actually throwing punches. Reasonable feedback.

### Data collector, take 2: interactive prompts

Rewrote with a menu, port auto-detect, per-rep peak readout. Still ENTER-per-rep.
Still not usable — punching *and* pressing ENTER at the same time is a bad ask.

### Data collector, take 3: auto-trigger

Third rewrite: 3-2-1 countdown, then a 6-second arm window where the tool
watches for a motion spike, auto-captures ±200/400 ms around the peak, and
re-arms after a 600 ms refractory. Separate **hold-mode** path for `idle` and
`block` (records a 1 s window and rejects if the user wobbled). This is the
version that got used.

Also added gesture hints (what the physical motion actually is) — the model
kept describing "punch" without saying whether the wrist should be palm-up or
palm-down, and that ambiguity would kill classifier consistency.

### Building the Three.js demo

Started with a plain scene. User pointed at kevinyhe/eureka-hacks-2026 and
asked for that visual style. Pulled the reference project's key files, absorbed
the design language, and rebuilt: black bg, uppercase HUD, health/stamina/combo
triple-bar stack, red/blue color coding, hit-confirm (burst + expanding ring +
damage number), full-screen red hit flash, gray gridded ring floor with red
and blue corner pads, striped ropes at four heights, camera shake on hit,
title screen that fades on connect.

Kept the reference's `.game-active` body flag pattern — everything HUD-related
fades in when the wrist connects.

Dev shortcut: press `j` / `h` / `u` to fake a gesture and preview the FX
without the hardware — turned out to be very useful for iterating on visuals
while the sensor was being re-mounted.

### First classifier + verification via replay

Wrote a threshold classifier (state machine: IDLE → ACTIVE → COOLDOWN) that
consumed the same CSV lines the browser would receive over serial. Built a
`replay.mjs` harness that feeds recorded reps back into the classifier at fake
time — no hardware needed for regression testing. First result on real data:
**19/20 jab, 16/20 hook = 87.5%**. Tuned the hook vs jab discriminator to use
the gx/ax ratio (rotation dominance rather than a fixed gx threshold) → **18/20
jab, 18/20 hook = 90%**.

Also useful: the replay caught a classifier state-machine bug immediately —
first version double-fired on retraction. Increasing refractory time and
requiring a "quiet" plateau before classifying fixed it.

### The wrist-rotation problem

User rolled the sensor mid-play and everything broke. That's inherent to
sensor-frame classification: `ax` means "the IMU's own +X axis," and if the
chip rotates, the meaning of that axis changes with it.

**Approach the reference project uses:** iPhone CoreMotion gives them a fused
quaternion (accel + gyro + mag) → they get world-frame linear acceleration
with gravity subtracted for free. Rotating the phone doesn't affect the
detector because features are computed in a world-anchored frame.

**We can't do that directly** — MPU6500 has no magnetometer, so we can't
recover absolute yaw. But we don't need full world orientation for boxing.
Gravity gives us two axes for free, and boxing gestures are body-relative, not
compass-relative. So:

- Low-pass the accel to estimate gravity direction in the sensor frame.
- Decompose every sample into `a_up` (along gravity), `a_horiz` (magnitude in
  the horizontal plane), and gyro components `ω_yaw` (about gravity),
  `ω_horiz` (about horizontal). All four are invariant to wrist rotation
  about horizontal axes (supination/pronation), which is the dominant kind of
  wrist rotation a boxer does.

Yaw about gravity (arm sweep) is still unrecoverable — but for gesture
*magnitude* features we don't care about direction, just amount, so it doesn't
matter.

### The magnetometer question

User asked whether buying a mag would help. Answered no for this hackathon:

- The rotation flavor that breaks us (forearm supination/pronation) is already
  fixed by gravity alignment, mag adds nothing there.
- The rotation flavor a mag *does* fix (yaw about gravity) doesn't correspond
  to a real boxing problem — a jab thrown facing north and a jab thrown facing
  east are both "jabs," not "north-jabs."
- Magnetic environments at hackathon venues are hostile (laptops, motors,
  iron chair frames, nearby LiPo) — hard-iron / soft-iron calibration would
  need redoing every time we move the assembly.
- A BNO055 (which does 9-DOF fusion in hardware and outputs quaternions) is
  the buy if we ever do this properly. For tonight: gravity align + collect
  more data across mount orientations.

### Verifying gravity-aligned features on real data

Ported the classifier to gravity-aligned features. First replay result:
everything classified as `overhand` — LPF hadn't converged because the replay
warm-up fed fake `(0, 0, +g)` "quiet" samples, but the recorded reps' actual
gravity direction was different. Fed the rep's own first sample as warm-up
seed instead, and used **median accel** as the per-rep gravity reference (the
first-200 ms "pre-trigger" window turned out to still contain punch wind-up,
so a mean was contaminated, but the median rejects the transient spike).

With correct gravity, the gravity-aligned features gave weaker jab/hook
discrimination (~70%) than raw-axis (90%). That's the fundamental tradeoff:
the useful signal for jab-vs-hook lives in *forearm-frame* rotation (gx =
forearm long-axis roll), and forcing everything into gravity frame throws
some of that away.

### JAB-ONLY mode for the live demo

Sensor mount had drifted between old data collection and live test — old
thresholds no longer applied. User collected fresh jab reps. Instead of
guessing hook thresholds without hook data, short-circuited the classifier
to fire `jab` on any punch-like spike. Isolates trigger logic from
discrimination — the game reacts to a real punch every time.

### False positive on wrist twist alone

Even in JAB-ONLY mode: just rotating the wrist fast (no arm movement) fired
a jab. Cause: my sanity gate accepted `dynA >= 18 OR wmag >= 300`. A pure
wrist twist has high gyro and low translation, so `wmag` alone was enough.

Right answer, same one the reference project uses implicitly: **a jab requires
translational evidence, not just any motion.** Changed the condition to require
`horiz >= 15 AND dynA >= 18` — actual gravity-subtracted horizontal linear
accel. Pure rotation produces almost no horizontal accel (the IMU on the
forearm is near the axis of rotation during a wrist twist, so centripetal
accel is negligible), so it no longer fires.

Same principle will separate hook from jab when we get there: hook has both
translation (arm sweeps through an arc → centripetal accel ~40 m/s²) and
rotation, jab has translation without much rotation. The reference project
does the same distinction on their CoreMotion `userAcceleration` stream.

### False positive at rest

Also: the classifier was firing when the sensor sat still. Cause: the ARM
threshold was low enough that idle noise could briefly clear it, enter
ACTIVE, and produce a valid classify path if the ACTIVE window ever saw a
big-enough peak. Fix: added a peak-sanity gate (`MIN_PEAK_DYNA=18`) that
drops silently if the peak of the ACTIVE window never actually built to a
real punch magnitude.

---

## Things worth remembering for day 2

- **The bait-and-switch on IMU chips is a real thing.** Read WHO_AM_I first,
  don't trust the silkscreen. Rolling a minimal driver is cheaper than
  library-shopping.
- **`ARDUINO_USB_CDC_ON_BOOT=1` on S3, always.** No error, just silent.
- **`replay.mjs` earned its keep** — it caught the state-machine double-fire
  and the LPF warm-up bug without needing hardware. Any classifier tweak from
  here on should be verified against recorded reps first.
- **Sensor-frame features are fragile.** Gravity-aligned features are more
  robust but discriminate less cleanly. The right long-term answer is a
  learned classifier with reps collected across multiple mount orientations,
  not more threshold tuning.
- **The "big rotation but no translation" case tripped us twice** — first as
  the wrist-rotation robustness problem, then as the false-positive on twist
  alone. Both times the fix was to require *translational* evidence
  specifically. Anytime we add a new gesture, ask: what's the translational
  vs rotational signature, and does the trigger require the right kind?
- **Don't buy hardware to fix a data problem.** The mag question was the
  clearest example — but the same principle applies to a bigger LiPo, a
  fancier IMU, a BNO055, etc. Buy for real hardware limits, not to paper
  over a software gap.
- **Follow the "ugly but complete" plan.** The wrist → ESP-NOW → dongle →
  serial path is still not tested; that's the biggest lurking risk and
  should be next before more polish.

---

## Day 3+ — the pivot to Soup Sports

Day 3 opened with the "wireless + polish" plan and closed on a completely
different project. Documenting every wrong turn so future us doesn't retrace
them.

### The wireless cut worked

`day1/firmware/*` was tethered USB CSV. Ported into `day3/firmware/src/` with
Mark's `esp_now_broadcast` pattern, split into three PIO envs
(`wrist_right`, `wrist_left`, `dongle`) sharing one src tree via
`build_src_filter`. Broadcast (`FF:FF:FF:FF:FF:FF`) — no MAC configuration.
Wire format got a leading `arm,` field so both bands multiplex through one
dongle to one serial port. `ArmDispatcher` on the browser side routes
per-arm samples to per-arm `Classifier` instances. Backwards-compat: 9-field
day1 lines are treated as arm 0. Everything's still one line of ASCII CSV
so `pio device monitor` remains a useful diagnostic.

**Payoff:** the day1 browser code kept working unchanged. The classifier
tuning inherited from day1's replay harness. Cost: ~2 hours.

### The "add SpaceEngine gesture navigation" trap

Mark had a sibling project driving SpaceEngine via wrist gestures. Ostensibly
themed to the hackathon prompt ("world is ending → explore the universe").
The conversation this morning circled that direction for an embarrassing
number of hours. It failed for reasons worth remembering:

1. **SpaceEngine is paid, Steam-only, Windows-only, closed-source.** Every
   demo pivot became "and it also depends on this one specific software
   nobody on the team owns."
2. **Gesture-as-command feels gimmicky.** Sweep-left = "prev waypoint" is a
   worse keyboard, not a physical experience. VR feels immersive because
   your hand IS the thing; a gesture-remote is just a remote.
3. **The user correctly identified this each time.** I kept proposing
   variants — cinematic overlay, cockpit build, joystick emulation for
   free-fly mode, wristband-as-Wii-remote — and each got rejected for the
   same underlying reason: it's dressing on a fundamentally passive demo.

Also considered and rejected: **open-source SpaceEngine alternatives**
(Gaia Sky, OpenSpace, Celestia). Any of them are technically workable — Gaia
Sky in particular has documented gamepad + Python-scripting APIs — but the
core gesture-as-remote problem is unchanged by swapping the software behind
the visuals.

**Lesson: propose direction pivots, don't dress up an existing direction as
a new one.** Every SpaceEngine variant I proposed was the same demo with a
different wrapper. The user's frustration was warranted.

### The pivot that landed: Wii Sports (Soup Sports)

The correct pivot was to a demo where **movement IS the mechanic**, not the
control layer. Boxing was the anchor (already 80% done in `day1/`). Then
bowling, tennis, baseball — each with a distinct swing/timing gesture,
each fun in 30 seconds, each cardboard-cabinet-with-phone-mount ready.

The user rebranded it "**Soup Sports**" once he had a mascot design he
liked. The mascot is Soup — a chubby cream cat-shape built from stacked
spheres, based on an emoji he liked. Post-apocalyptic Wii Sports vibe.
Every character in every game is Soup: opponent boxer is Soup, bowling
pins are 10 tiny Soups, tennis CPU is Soup, baseball pitcher is Soup.

**Lesson: the mascot became the pitch.** Before Soup, this was "wristband
boxing." After Soup, it's a memorable brand judges will recognize on a
poster. The mascot itself was 90 minutes of work in `soup/` (OpenSCAD
first, then Python spheres+PBR materials via trimesh). Enormous ROI.

### Four minigames in one afternoon (parallel agents)

Once the direction was locked, delivery was fast. I spun up **three
parallel general-purpose agents** to finish bowling, build tennis, and
build baseball simultaneously. Each was scoped to a single HTML file so
no merge conflicts. Then a second parallel pass — **four agents at once** —
did the Soup Sports re-skin: cyan sky background, cream+ink HUD panels,
chunky pill buttons, and the mascot loaded via `GLTFLoader` per-game with
procedural per-frame animation.

**Lesson: parallel agents are worth it when the boundaries are file-level.**
Each agent had a clear "read A/B/C, write only D" contract. No shared
mutable state, no cross-agent merges. Both passes (game-build + Soup pass)
finished inside 15 minutes wall-clock.

### The "no undo undo WHAT HAVE YOU DONE" moment

A follow-up agent added tall bat ears, eye sparkles, blush cheeks, a smile,
and feet to the mascot. User said "no undo undo WHAT HAVE YOU DONE" and it
got reverted. Current sober Soup is intentional. **Do not add facial
detail or limbs to Soup unless explicitly asked.**

Also worth remembering: the user was told the game agents could use
animation clip names like `idle`, `hit_light`, `hit_heavy`, `ko`,
`cheer`, `wave`, `walk`, `bowling_pin_fall`. **None of these exist as
actual `AnimationClip`s in the GLB.** Soup has no rig. Every animation
is procedural per-frame math in the game files — position bobs,
rotation.z tweens, material color flashes. Cheaper than a rig and looks
fine on a limbless character. HANDOFF.md has the recipes.

### JAB-ONLY MODE and what's still open

The classifier was tuned on day1 data collected with a specific arm mount.
When the wireless firmware moved the sensor, thresholds drifted. Instead of
retuning discriminators without fresh data, I short-circuited `_classify()`
so any valid trigger fires `jab`. Bowling/tennis/baseball don't use the
Classifier (they consume raw samples), so this only affects boxing's hook
vs uppercut discrimination. To restore multi-class: collect fresh reps for
each label on the current mount, run `replay.mjs`, re-enable the multi-class
branch in `_classify()`.

### Things worth remembering from day 3

- **Direction pivots need to be real pivots, not resurfaced versions of
  the rejected direction.** Wristband-as-joystick was a resurface. Cardboard
  cabinet was a resurface. Cockpit was a resurface. Wii Sports was a real
  pivot.
- **Brand is the demo.** Soup Sports became memorable the moment the
  mascot showed up in every game with a consistent palette. Before that,
  it was four decent minigames with no through-line.
- **Parallel agents at file-level scope work.** ~15 min for four polish
  passes across four game files. Would have been ~2 hours sequentially.
- **The "cardboard cabinet with phone mount" hardware bit is still
  unbuilt.** All demo polish is web-side. The physical build (cabinet, CAD,
  wristband strap, LiPo, vibration motor) is the biggest remaining risk.
  Software floor is ready; hardware floor is not.
- **Repo hygiene:** committed via `.gitignore` early. `.pio/` and
  `managed_components/` never entered the tree; final push was 1.6MB / 40
  files. Mark's separate repo was `rm -rf`'d out of the tree with his
  training-tools sibling folder preserved separately.
