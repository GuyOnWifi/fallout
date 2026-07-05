# CLAUDE.md — Orientation for future sessions

You're inside a hackathon repo for a **wireless wristband boxing game**, Wii-Sports-style. IMU on the forearm, ESP-NOW to a USB dongle, Three.js scene in the browser. The gimmick sold to judges is "cardboard arcade cabinets with a phone mount for a VR-ish shroud, boxing (and maybe more Wii minigames) as the game."

## Repo layout

```
.
├── JOURNEY.md              Devlog of decisions + gotchas — read this before you start.
├── IDEA.md                 Original project brief (project spec pre-hackathon).
├── CLAUDE.md               This file.
│
├── blink/                  Old ESP-IDF blink test — unrelated starter, ignore.
├── soup/                   OpenSCAD source + STL/GLB for a 3D-printed enclosure.
├── eim_config.toml         Edge Impulse config file, unused so far.
│
├── day1/                   FIRST-DAY SNAPSHOT — DO NOT EDIT
│   ├── firmware/           Wired USB-CSV firmware (200Hz MPU6500 + complementary filter)
│   ├── app/                Three.js boxing scene, Web Serial, streaming CSV classifier
│   ├── tools/              Python auto-trigger collector + JS replay harness
│   └── README.md
│
├── day2/                   Empty — was skipped.
│
└── day3/                   ⭐ THIS IS WHERE ACTIVE WORK LIVES
    ├── firmware/           WIRELESS build. Three envs share one src/ tree.
    ├── app/                Same scene as day1 + ArmDispatcher for 2 arms.
    └── tools/              Same collector as day1 with arm filtering + expanded gesture menu.
```

**Rule of thumb: work in `day3/`. `day1/` is a historical snapshot the user wants preserved.**

## The one-line theory of operation

Two XIAO ESP32-S3 boards on your arms (`wrist_right`, `wrist_left`) broadcast IMU
samples over ESP-NOW → a third XIAO acting as USB dongle receives everything on
channel 1 → prints newline-delimited CSV to `/dev/ttyACM*` → browser opens the
port via Web Serial → an `ArmDispatcher` routes per-arm samples to per-arm
classifiers → gestures fire the boxing game logic.

## Wire format (single source of truth)

Line format, ASCII, newline-terminated:

```
arm,t_us,ax,ay,az,gx,gy,gz,roll,pitch
```

- `arm` — 0 = right, 1 = left (compile-time `-DARM_ID=N` on the wrist firmware).
- `t_us` — device micros() timestamp.
- `ax..az` — m/s².
- `gx..gz` — deg/s.
- `roll,pitch` — degrees, from complementary filter (α=0.98).

Lines starting with `#` are status/heartbeat and must be filtered before parsing.

**Legacy (day1) format**, still consumed by dispatcher for backward compat: same
line without the leading `arm,` (9 fields). Dispatcher treats these as arm 0.

## Hardware you should assume

- **XIAO ESP32-S3** boards, plural. The user has ≥6.
- **GY-521 MPU-something breakout** — silkscreen says MPU6050 but WHO_AM_I reads `0x70` = MPU6500. Register-compatible for accel+gyro. Custom `mpu.h` driver at `day3/firmware/src/mpu.h`.
- Wiring: SDA→D4/GPIO5, SCL→D5/GPIO6, VCC→3V3, GND→GND, AD0 float → I²C addr `0x68`.
- LiPo soldered to XIAO's BAT pad for portable wristbands (planned).
- Vibration motor + DRV8833 for haptics (planned). Solenoid possibly later.

## Firmware (day3)

**PlatformIO project at `day3/firmware/`.** Three build envs sharing `src/`:

| Env | ARM_ID | src filter | Purpose |
|---|---|---|---|
| `wrist_right` | 0 | `wrist.cpp` | Right-hand band |
| `wrist_left`  | 1 | `wrist.cpp` | Left-hand band |
| `dongle`      | — | `dongle.cpp` | Plugs into laptop, receives ESP-NOW, forwards to USB |

Both wrist envs + dongle must agree on **ESPNOW_WIFI_CHANNEL** (currently 1).
Broadcast MAC — no MAC configuration needed.

Flash from `day3/firmware/`:
```bash
pio run -e dongle       -t upload --upload-port /dev/ttyACM0
pio run -e wrist_right  -t upload --upload-port /dev/ttyACM0
pio run -e wrist_left   -t upload --upload-port /dev/ttyACM0
```

**Non-negotiable build flags:** `-DARDUINO_USB_MODE=1 -DARDUINO_USB_CDC_ON_BOOT=1`.
Without them, `Serial` prints silently nothing over USB-C on the S3. Already
in `platformio.ini`, do not remove.

Sanity-check the dongle: `pio device monitor -e dongle` should show
`# dongle ready, listening on channel 1` and a 2-second heartbeat.

## Browser app (day3/app)

Static HTML/JS, no build step. Served with `python -m http.server 8123` from
`day3/app/`.

- **`index.html`** — the whole scene, HUD, hit-confirm animation, game state.
- **`serial.js`** — Web Serial line reader. Chromium-only (Chrome/Edge/Brave).
- **`dispatch.js`** — `ArmDispatcher`: parses arm prefix, maintains one
  `Classifier` per arm, routes gesture events with the arm ID attached.
- **`classifier.js`** — streaming threshold classifier, gravity-aligned features.
  Currently in JAB-ONLY mode after wireless tuning; hook/uppercut/etc gated by
  `MIN_PEAK_*` thresholds until re-trained. Re-enable other gestures by
  restoring the multi-gesture block in `_classify()` once fresh reps land.

Dev keyboard shortcuts (built into `index.html`):
- `j` / `h` / `u` → simulate right-arm jab / hook / uppercut
- `J` / `H` / `U` (shift) → simulate left-arm equivalents

Connect to real hardware: click "Connect wrist" → pick the DONGLE's ttyACM
port. Both arms multiplex through one serial connection.

## Training pipeline (day3/tools)

**Auto-triggered capture:** `python collect.py`. Countdown → 6-second arm window
→ auto-fires on motion spike → snapshots ±200/400ms around peak → repeats.
Hold-mode path for `idle` and `block` (records 1s of still pose, rejects wobble).

CLI flags:
- `--port /dev/ttyACM0` (auto-detected otherwise)
- `--arm 0|1` — filter to a single wristband when both are streaming
- `--data-dir data` — output directory (default: `data`)
- `--reps 20` — default rep count per gesture

Gesture menu is the **Wii-boxing reference set** mirrored from
`kevinyhe/eureka-hacks-2026`:
- **Dynamic**: `jab`, `hook`, `uppercut`, `dodge_left`, `dodge_right`, `dodge_back`
- **Hold**: `idle`, `block`

Data lands at `day3/tools/data/<label>.csv` with columns:
`rep, label, t_us, ax..gz, roll, pitch`.

**Regression test:** `node replay.mjs` — feeds recorded reps back through
`classifier.js` at fake time; prints per-label accuracy. Runs offline, no
hardware needed. Rerun after every classifier tweak.

## Classifier design (short version, longer in JOURNEY.md)

1. Streaming state machine: `IDLE → ACTIVE → COOLDOWN`.
2. Features are **gravity-aligned**, not raw sensor axes — the accelerometer's
   LPF gives us "which way is up" in the sensor frame, so wrist rotation
   between reps and play doesn't shift features around. We can't recover
   world-yaw without a magnetometer, and don't need to for boxing.
3. Trigger requires **translational** evidence (`horiz ≥ 15 && dynA ≥ 18`).
   Otherwise a pure wrist twist fires false-positive jabs.
4. Refractory time = 500ms after each classification; blocks the
   follow-through/retraction from double-firing.
5. **JAB-ONLY MODE is currently active** — everything that trips the trigger
   fires `jab`. Restore multi-class discrimination in `_classify()` when
   fresh reps of hook/uppercut/etc land on the current sensor mount.

## Gotchas that will cost an hour if you skip

- **`ARDUINO_USB_CDC_ON_BOOT=1`** on the S3, always. Silent otherwise, no error.
- **WHO_AM_I=0x70** on the "MPU6050" breakout means MPU6500 clone. Don't reach
  for Adafruit's library — it rejects any WHO_AM_I ≠ 0x68. We hand-drive the
  register map in `mpu.h`. Works with either chip.
- **`±16g saturation`** on hard punches. Treat saturated samples as max power.
- **XIAO C3 cannot do USB-HID** (no native OTG). If a XIAO won't do gamepad
  emulation for you, it's a C3, not an S3. Not currently used but noted.
- **Serial port is single-consumer**: `pio device monitor`, `collect.py`, and
  the browser cannot hold `/dev/ttyACM0` simultaneously. Close one before
  running another.
- **ESP-NOW broadcast** = any dongle on channel 1 in the room sees any
  wristband on channel 1. For 1v1 demos, fine. For multi-team demos, add a
  per-team MAC filter in `dongle.cpp`. Not implemented.
- **`.pio/` and `managed_components/` are gitignored** — build artefacts and
  vendored ESP-IDF components (hundreds of MB each). Never commit them.
- **`day2/` is empty.** Not a bug.

## What NOT to do without explicit permission

- Don't rewrite the classifier from scratch. It has real thresholds tuned to
  real data — the JOURNEY.md documents why each is set where it is.
- Don't move code out of `day3/`. The day1/day3 split is intentional — day1
  is a snapshot of the wired build so old training data can still be replayed
  with the classifier that generated it.
- Don't add SpaceEngine, gesture-navigation, or any "explore the universe"
  scaffolding. That path was killed. The demo is a **Wii-boxing minigame**.
  Read JOURNEY.md if you're curious why.
- Don't push to `main` without asking — hackathon repo, human wants to keep
  the history clean.

## Common workflows

**Rebuild + reflash a wristband:**
```bash
cd day3/firmware
pio run -e wrist_right -t upload --upload-port /dev/ttyACM0
```

**Start the dev server:**
```bash
cd day3/app && python -m http.server 8123
# then open http://localhost:8123 in Chromium
```

**Train new gestures + regression-test:**
```bash
cd day3/tools
python collect.py --arm 0             # capture right-arm reps
python collect.py --arm 1             # ...then left
node replay.mjs                        # verify accuracy
```

**Bring up a fresh dongle + wristband + browser stack:**
1. Flash `dongle` env to XIAO #1, leave it plugged in.
2. Flash `wrist_right` env to XIAO #2, unplug it.
3. `cd day3/app && python -m http.server 8123`
4. Open http://localhost:8123 in Chrome. Click "Connect wrist," pick the
   dongle's `/dev/ttyACM*`.
5. Power the wristband (USB or LiPo). Punch.

## Reference project

`kevinyhe/eureka-hacks-2026` — the smartphone-based Wii-boxing sibling project
whose UI design and gesture set we're mirroring. Look there for HUD reference
(black bg, uppercase HUD, red/blue player colors, hit-confirm burst).

## Related people

- **Guy (repo owner)** — main developer, hardware + firmware + browser + UX.
- **Mark** — teammate, was building the SpaceEngine-nav sibling project in the
  now-deleted `mark/` folder. His code has since been dropped from this repo
  after the pivot to boxing. His work lives in his own repo.
