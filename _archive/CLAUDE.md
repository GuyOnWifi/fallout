# CLAUDE.md — Orientation for future sessions

You're inside a hackathon repo for **Soup Sports** — a wireless-wristband
Wii-Sports-style minigame arcade. IMU on the forearm, ESP-NOW to a USB dongle,
Three.js browser games driven by IMU-detected gestures. The demo gimmick sold
to judges: **cardboard arcade cabinets with a phone mount** (VR-lite shroud)
housing a **soup mascot** as the star of every game — post-apocalyptic
cuteness, sky-cyan palette.

The project has been through several pivots (see JOURNEY.md). The **final and
locked** direction is Soup Sports minigames. Do not re-propose SpaceEngine,
gesture-driven flight controllers, cockpit rigs, or "explore the universe"
narratives — all considered and rejected. See "What NOT to do" below.

## Repo layout

```
.
├── CLAUDE.md               This file.
├── JOURNEY.md              Devlog of every pivot + gotcha — read before any big change.
├── IDEA.md                 Original pre-hackathon brief.
│
├── blink/                  Old ESP-IDF blink starter — unrelated, ignore.
├── soup/                   Mascot workshop (see below).
├── eim_config.toml         Edge Impulse config, unused so far.
│
├── day1/                   FIRST-DAY SNAPSHOT — DO NOT EDIT
│   ├── firmware/           Wired USB-CSV firmware (200Hz MPU6500)
│   ├── app/                Original single boxing scene
│   └── tools/              Python auto-trigger collector + JS replay harness
│
├── day2/                   Empty — skipped.
│
└── day3/                   ⭐ ACTIVE WORK LIVES HERE
    ├── firmware/           WIRELESS build (ESP-NOW). Three PIO envs share one src/.
    ├── app/                Four Soup Sports minigames + shared classifier stack.
    ├── tools/              Same collector/replay as day1 with arm filtering + Wii-boxing gesture set.
    └── GESTURES.md         What each game needs from the wristband. Read before adding a new game.
```

**Rule of thumb: work in `day3/`. `day1/` is a historical snapshot preserved
so old training data still replays cleanly against the classifier that
generated it.**

## `day3/app/` — the four-game arcade

```
day3/app/
├── index.html              Soup Sports LANDING MENU (Wii Sports channel-selector vibe)
├── boxing.html             Punch an opponent mascot; jab/hook/uppercut classified gestures.
├── bowling.html            Underhand swing → release; 10-frame scoring; mascots as pins.
├── tennis.html             Timed swings vs AI mascot across a net; first to 5 rallies.
├── baseball.html           Home-run derby vs pitcher mascot; peak accel = exit velocity.
│
├── serial.js               Shared: Web Serial line reader. Chromium-only.
├── dispatch.js             Shared: ArmDispatcher — parses arm prefix, routes per-arm.
├── classifier.js           Shared: streaming threshold classifier for boxing gestures.
│
└── assets/
    └── mascot.glb          Soup mascot 3D model — see soup/HANDOFF.md for details.
```

Games are **standalone HTML files** — one per game, all share the three JS
modules. No SPA router, no build step, no framework. New game = copy any
existing `.html`, swap the scene + input handler. Detailed pattern in
"Adding a new game" below.

## Soup Sports design language (locked)

Reference poster: user's promo art — cream mascot on white pathway across
turquoise flooded ruins under a bright cyan sky. Serene post-apocalypse.

**Palette (identical CSS variables across every page):**

```
--sky-top:    #7bd3ee     --cream:      #fbf3e0     --ink:        #1c2a3a
--sky-mid:    #4fc0e3     --cream-warm: #f6e9c9     --ink-soft:   #476278
--sky-deep:   #2a95c4     --cream-deep: #ecdcb1     --hot:        #ff9663
--water:      #37a7d0     --ruin-blue:  #37628a     --gold:       #f4c95d
                          --ruin-teal:  #2f8fa3     --vine:       #6cb85a
                                                    --vine-deep:  #4a9440
```

**Look:**
- Sky-cyan → water gradient background (never black).
- Cream HUD panels with **3px ink borders** and **hard "0 4px 0 var(--ink)" drop shadows** — flat-illustration aesthetic, no soft blur shadows.
- Chunky rounded typography (Fredoka / Nunito / SF Pro Rounded fallback chain).
- Buttons are cream pills with ink borders + hard drop shadow. See `.ss-btn` in `boxing.html`.
- Status pill: cream bg, gold pulse dot disconnected → green connected.
- Big transient banners use `--cream` text with an ink drop-shadow for the "outlined cartoon lettering" feel.

**Rebranding checklist** for any new file: title text is `Soup Sports — <Game>`,
menu link is `← menu` styled with `.ss-btn`, connect button is "Connect hub"
styled with `.ss-btn`, background gradient is sky-top → water.

## Mascot loading pattern (`assets/mascot.glb`)

The soup mascot is one static glTF file — no rig, no animation clips.
Everything (fighter, pin, CPU, pitcher) is the same asset retinted per role
and animated procedurally.

**Facts** (source: `soup/HANDOFF.md`):
- **Location:** `day3/app/assets/mascot.glb`.
- **Node names:** `body`, `ears`, `face_patch`, `eyes_nose`, `paws`, `tail`.
- **Material names:** match node names.
- **Model space:** z-up, mm units, feet at z=0, height ~122mm.
- **To place at ~1m tall in Three.js:** `soup.scale.setScalar(0.008)`.
- **Y-up flip on load:** `soup.rotation.x = -Math.PI / 2`.
- **Facing after flip:** +Z (toward camera). Add `soup.rotation.y = Math.PI`
  if you need him to face −Z.

**Loading + retint recipe:**
```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const loader = new GLTFLoader();
const gltf = await loader.loadAsync('assets/mascot.glb');
const soup = gltf.scene;

// Clone materials before mutating — otherwise every instance shares state.
soup.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });

// Retint per role
soup.getObjectByName('body').material.color.setHex(0xff8888);
soup.getObjectByName('paws').material.color.setHex(0xff8888);
// Leave face_patch + eyes_nose alone unless doing a themed variant.

soup.rotation.x = -Math.PI / 2;
soup.scale.setScalar(0.008);
scene.add(soup);
```

**Multiple instances** (e.g. 10 bowling pins): load the GLB ONCE at startup,
then `soup.clone(true)` per instance, then clone materials on each clone.

**Procedural animation recipes** (no clips exist in the GLB — see
`soup/HANDOFF.md` for the full list):
- `idle` — gentle bob + squish: `pos.y = base + sin(t*2)*0.02; scale.y = 1 + sin(t*2)*0.03;`
- `hit` — shake `pos.x` ±0.05 for 120ms, flash `body.material.color` red for 100ms.
- `ko` — tween `rotation.z` to ±π/2 over 400ms, drop `pos.y` to floor.
- `cheer` — two vertical hops + small `rotation.z` wiggle.
- `wave` — rotate `paws` ±0.3 rad @ ~4Hz for 800ms.
- `bowling_pin_fall` — angular velocity around a horizontal axis perpendicular
  to the impact direction, integrate to floor.

## `soup/` — the mascot workshop

Not to be confused with a print-enclosure folder (that's what it used to be).
It's now the **mascot 3D model source**:

- `build_soup.py` — Python source of truth. Builds the mascot from spheres,
  exports GLB + STL.
- `render_soup.py` — matplotlib preview renderer.
- `HANDOFF.md` — full mascot spec (READ THIS before you touch the model).
- `soup.glb` — current export (mirrored to `day3/app/assets/mascot.glb`).

To modify the mascot: edit `build_soup.py` → `python3 build_soup.py` →
`cp soup.glb ../day3/app/assets/mascot.glb`. Tunables at top of the Python file.

**Don't add limbs, ears, sparkles, blushing, feet, smiles, or facial detail
unless the user explicitly asks.** Prior sessions overshot and got told to
"undo undo WHAT HAVE YOU DONE". Current sober design is intentional.

## The one-line theory of operation

Two XIAO ESP32-S3 boards on your arms (`wrist_right`, `wrist_left`) broadcast
IMU samples over ESP-NOW → a third XIAO acting as USB hub receives everything
on channel 1 → prints newline-delimited CSV to `/dev/ttyACM*` → browser opens
the port via Web Serial → `ArmDispatcher` routes per-arm samples → each game
either consumes discrete classified gestures (boxing) OR raw per-sample stream
(bowling/tennis/baseball).

## Wire format (single source of truth)

Line format, ASCII, newline-terminated:

```
arm,t_us,ax,ay,az,gx,gy,gz,roll,pitch
```

- `arm` — 0 = right, 1 = left (compile-time `-DARM_ID=N` on wrist firmware).
- `t_us` — device micros() timestamp.
- `ax..az` — m/s².
- `gx..gz` — deg/s.
- `roll,pitch` — degrees, from complementary filter (α=0.98).

Lines starting with `#` are status/heartbeat — filter before parsing.

**Legacy (day1) format**, still handled by the dispatcher: same line without
the leading `arm,` (9 fields). Dispatcher treats these as arm 0. Backwards-compat.

## Hardware

- **XIAO ESP32-S3** boards, plural. User has ≥6.
- **GY-521 breakout** — silkscreen says MPU6050, WHO_AM_I reads `0x70` =
  **MPU6500**. Register-compatible. Custom `mpu.h` driver at
  `day3/firmware/src/mpu.h`.
- Wiring: SDA→D4/GPIO5, SCL→D5/GPIO6, VCC→3V3, GND→GND, AD0 float → addr `0x68`.
- LiPo → BAT pad for portable wristbands (planned).
- Vibration motor + DRV8833 for haptics (planned).

## Firmware (`day3/firmware/`)

PlatformIO project, three envs sharing `src/`:

| Env | ARM_ID | src filter | Purpose |
|---|---|---|---|
| `wrist_right` | 0 | `wrist.cpp` | Right-hand band |
| `wrist_left`  | 1 | `wrist.cpp` | Left-hand band |
| `dongle`      | — | `dongle.cpp` | Plugs into laptop, receives ESP-NOW, forwards to USB |

Both wrist envs + dongle must agree on **ESPNOW_WIFI_CHANNEL** (currently 1).
Broadcast MAC, no MAC configuration needed.

```bash
cd day3/firmware
pio run -e dongle       -t upload --upload-port /dev/ttyACM0
pio run -e wrist_right  -t upload --upload-port /dev/ttyACM0
pio run -e wrist_left   -t upload --upload-port /dev/ttyACM0
```

**Non-negotiable build flags:** `-DARDUINO_USB_MODE=1 -DARDUINO_USB_CDC_ON_BOOT=1`.
Without them, `Serial` prints silently nothing over USB-C on the S3. Already
in `platformio.ini` — do not remove.

Dongle sanity check: `pio device monitor -e dongle` prints
`# dongle ready, listening on channel 1` + a 2-second heartbeat.

## Training pipeline (`day3/tools/`)

**Auto-triggered capture:** `python collect.py`.
- 3-2-1 countdown → arms detector → user swings → auto-fires on peak.
- CSV per label at `data/<label>.csv`.
- Args: `--port /dev/ttyACM0`, `--arm 0|1`, `--data-dir data`, `--reps 20`.
- Gesture menu mirrors the reference Wii-boxing set: `jab, hook, uppercut,
  block, dodge_left, dodge_right, dodge_back, idle`. See `day3/GESTURES.md`
  for what each game needs.

**Regression test:** `node replay.mjs`. Feeds recorded reps back through
`classifier.js` at fake time. Prints per-label accuracy. Rerun after every
classifier tweak.

## Classifier design (short — full story in JOURNEY.md)

1. Streaming state machine: `IDLE → ACTIVE → COOLDOWN`.
2. Features are **gravity-aligned**, not raw sensor axes — LPF of accel
   gives us "which way is up" in sensor frame. Boxing gestures stay
   invariant to how the wrist rolled between capture and play.
3. Trigger requires **translational** evidence (`horiz ≥ 15 && dynA ≥ 18`).
   A pure wrist twist would otherwise falsely fire jab.
4. Refractory = 500ms after each classification.
5. **JAB-ONLY MODE is currently active** — every valid trigger fires `jab`.
   Restore multi-class discrimination in `_classify()` once fresh reps of
   hook/uppercut/etc land on the current sensor mount. Bowling/tennis/baseball
   are unaffected — they consume raw samples, not classifier output.

## Adding a new game

1. **Copy** an existing standalone HTML — `bowling.html` is the best template
   because it uses the raw-sample tap; `boxing.html` uses classifier events.
2. **Import** the three shared modules:
   ```js
   import { openSerial } from './serial.js';
   import { ArmDispatcher } from './dispatch.js';
   // optional: import { Classifier } from './classifier.js';
   ```
3. **Load the mascot** using the recipe above.
4. **Style** with the Soup Sports palette + `.ss-btn` treatment.
5. **Register** in `index.html` — add a card in the `.games` grid.
6. **Add a section** in `GESTURES.md` describing what input you need.
7. **Dev keyboard shortcut** for testing without hardware (e.g. SPACE = fake
   swing) — every game has this.

## Gotchas that cost an hour if you skip them

- **`ARDUINO_USB_CDC_ON_BOOT=1`** on the S3, always. Silent otherwise, no error.
- **WHO_AM_I=0x70** on the "MPU6050" breakout means MPU6500 clone. Don't
  reach for Adafruit's library — hand-driven in `mpu.h`.
- **±16g saturation** on hard punches. Treat saturated samples as max power.
- **XIAO C3 cannot do USB-HID** (no native OTG). Not currently used but noted.
- **Serial port is single-consumer.** `pio device monitor`, `collect.py`,
  and the browser can't hold `/dev/ttyACM0` simultaneously.
- **ESP-NOW broadcast** = any dongle on channel 1 in the room sees any
  wristband. Fine for one team. Multi-team → add MAC filter in `dongle.cpp`.
- **`.pio/` and `managed_components/` are gitignored.** Never commit them.
- **`day2/` is empty.** Not a bug.
- **Mascot has no rig, no animation clips.** All animations are procedural
  (see recipes above). Don't try `AnimationMixer` — there are no clips.
- **Mascot materials are shared by default.** Clone before mutating or
  every instance changes color together.

## What NOT to do without explicit permission

- **Do not re-propose SpaceEngine.** Rejected: paid closed-source software,
  Windows-only, requires runtime licence, doesn't feel like a hackathon
  project. Full arc in JOURNEY.md.
- **Do not propose flight-controller / cockpit / Wii-Remote-for-the-universe
  variants.** All considered, all rejected. Locked direction is Wii Sports.
- **Do not rewrite the classifier from scratch.** Real thresholds tuned to
  real data. JOURNEY.md documents each choice.
- **Do not move code out of `day3/`.** day1/day3 split is intentional.
- **Do not add limbs, ears, sparkles, blushing, feet, smiles, or eye
  highlights to the soup mascot** unless the user explicitly asks. Prior
  sessions overshot cuteness and got reverted. Current design is sober by
  choice.
- **Do not push to `main` without asking.** Hackathon repo, human wants
  clean history.
- **Do not delete `day1/` even though it's a snapshot.** It's the ground
  truth for the original training data.

## Common workflows

**Rebuild + reflash a wristband:**
```bash
cd day3/firmware
pio run -e wrist_right -t upload --upload-port /dev/ttyACM0
```

**Start the dev server:**
```bash
cd day3/app && python -m http.server 8123
# open http://localhost:8123 in Chromium
```

**Train new gestures + regression-test:**
```bash
cd day3/tools
python collect.py --arm 0             # capture right-arm reps
python collect.py --arm 1             # ...then left
node replay.mjs                        # verify accuracy
```

**Bring up a fresh dongle + wristband + browser stack:**
1. Flash `dongle` env to XIAO #1, leave it plugged into laptop.
2. Flash `wrist_right` env to XIAO #2, unplug it.
3. `cd day3/app && python -m http.server 8123`
4. Open http://localhost:8123 in Chrome, pick a game, click "Connect hub,"
   pick the dongle's `/dev/ttyACM*` port.
5. Power the wristband (USB or LiPo). Play.

## Reference material

- **`kevinyhe/eureka-hacks-2026`** — smartphone-based Wii-boxing sibling
  project. Our HUD design language partly inherited from theirs (though
  we've since diverged to Soup Sports).
- **User's promo art** — the "flooded ruins with mascot" poster is the
  brand reference. Palette + cloud/water motifs come from it.

## People

- **Guy (repo owner)** — main developer.
- **Mark** — teammate on the sibling project (his repo, not here). His folder
  was deleted from this repo after the pivot away from SpaceEngine.

## When in doubt

Read `JOURNEY.md` for pivot decisions and `DEVLOG.md` for technical war
stories (bug fixes, root causes, lessons). Both are living documents;
`DEVLOG.md` in particular is append-only newest-first — if you fix a real
bug, add a § at the top in the Symptom / Debug / Fix / Lesson format. It
doubles as the demo-day technical talk.
