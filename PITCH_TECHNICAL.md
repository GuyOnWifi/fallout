# Soup Sports: technical pitch

## The problem we set for ourselves

We wanted Wii Sports without the Wii. The Wii shipped in 2006 with a wired
sensor bar, a proprietary IR camera, and controllers that cost as much as a
console. Almost twenty years later a microcontroller with more compute than
the original Wiimote costs three dollars, a six-axis IMU costs one, and every
laptop in the room already has a display and a browser. The gap between
"Nintendo built a magical living-room sports arcade" and "a hackathon team
could build one over a weekend from parts in a drawer" is finally closed, and
we wanted to prove it. The stretch goal, and the demo gimmick, is a cardboard
arcade cabinet with a phone mount that turns the wristband into a full
standing-up minigame experience: cheap enough that you could deploy them at a
county fair, expressive enough to feel like a real toy.

## The architecture

```
   ┌──────────────┐        ESP-NOW          ┌──────────────┐   USB-CDC   ┌────────────┐
   │  Wristband   │  ─────  broadcast  ───► │  USB dongle  │  ────────►  │  Browser   │
   │  XIAO ESP32-S3│         @ 200 Hz       │  XIAO ESP32-S3│  CSV line   │  Three.js  │
   │  MPU6500 IMU │                         │  (channel 1) │             │  game      │
   └──────────────┘                         └──────────────┘             └────────────┘
          ▲                                                                    │
          │        (multiple wristbands broadcast concurrently;                │
          │         dongle forwards them all interleaved on one port)          │
          │                                                                    ▼
          └─────────── pairing.js maps arm_id → player slot A/B ──────────────┘
```

The wristband is a XIAO ESP32-S3 with a GY-521 breakout strapped to a velcro
band. It samples the IMU at 200 Hz, runs a complementary filter for roll and
pitch, formats each sample as a single CSV line, and shoves it into an
ESP-NOW broadcast. There is no pairing, no association, no TCP, and no
handshake. Every wristband in the room shouts on channel 1; the dongle
listens and forwards whatever it hears out over USB-CDC. The browser opens
that USB port through the Web Serial API, parses lines with a two-lane
dispatcher, and hands per-arm samples to either the classifier (boxing) or
directly into the Three.js scene (bowling, tennis).

The whole radio path is about eight lines of firmware. ESP-NOW does not need
IP, TLS, or authentication, and its broadcast latency measures in single-digit
milliseconds. For a 200 Hz sensor stream this is critical: the round-trip
from a punch peaking to the browser reacting is dominated by browser
rendering, not by radio. The dongle is deliberately dumb. It contains no
game logic, no classification, no state. It is a USB radio and nothing else,
which means we can swap games, retune classifiers, or rewire the whole
browser stack without ever reflashing a board.

## The signal-processing story

The classifier lives entirely in the browser and reads the raw 200 Hz stream.
Its job is to turn a continuous accelerometer and gyro feed into discrete
gesture events for jab, hook, and uppercut, with a confidence-weighted
"power" number attached to each. It runs as a three-state machine, IDLE to
ACTIVE to COOLDOWN, and never touches the sample outside a small fixed
window per gesture.

The interesting piece is that the classifier does not look at raw sensor
axes at all. If it did, a user who mounted the wristband rotated ninety
degrees relative to the training set would see hooks read as jabs and jabs
read as noise. Instead, on every sample we low-pass the accelerometer with
α equal to 0.995 to estimate the sensor-frame direction of gravity, then
project each new accel reading onto that axis and its orthogonal plane. The
result is three orientation-invariant features: `a_up`, the signed
acceleration along gravity; `a_horiz`, the magnitude of acceleration in the
horizontal plane; and `w_mag`, total gyro magnitude. An uppercut spikes
`a_up` positive regardless of wrist roll. A jab spikes `a_horiz` regardless
of yaw. A hook has both, plus rotation about gravity. Once we moved to
gravity-aligned features the classifier stopped caring how the strap sat.

The state machine itself is peak-tracking rather than window-classifying.
We arm on any sample where dynamic accel is above 25 m/s squared or gyro
magnitude is above 400 deg/s, but we do not commit to a classification
until we watch the peak drop below 55 percent of its maximum. That
"post-peak drop" trick lets us catch the extension of a punch (which is the
part of the motion that carries semantic content) while ignoring the
retraction (which happens with high accel but is mechanically the opposite
gesture). Refractory is 850 ms and requires a genuine quiet sample before
re-arming, so a slow hook cannot re-fire on its own snap-back.

Thresholds were not guessed. We built a Python collector that
auto-triggers on peak detection and asks the user for twenty reps per
label, then wrote a Node replay harness that streams those recordings back
through the classifier as if in real time. Every threshold in the file
carries a comment naming the percentile of the training set it clears.
When we retune, we do so against numbers, not vibes, and the replay
harness runs in under a second.

## The multi-controller story

Every wristband derives its `arm_id` at boot from the last two bytes of its
WiFi MAC. That is a single call to `esp_read_mac` in firmware and it means
one binary flashes onto any board without a per-device compile-time flag.
Chip identity is free on the ESP32; forcing developers to remember which
`-DARM_ID=` to pass at build time was a foot-gun that cost us a real hour
of demo-time before we ripped it out.

The browser side pairs arms to players by order-of-shake. When the game
loads, both player slots are empty. The first wristband whose non-gravity
acceleration crosses 12 m/s squared claims slot A. The next distinct
`arm_id` to shake claims slot B. Everything downstream, from the classifier
routing to the on-screen player labels, keys on the abstract player letter,
not on the underlying `arm_id`. This has two nice properties. First, the
pairing UI does not need to know about the hardware at all: it just watches
for two arms to wave, and the physical wristband a player happens to grab
becomes their controller. Second, we can persist the mapping in
`sessionStorage` so that clicking through from the menu to a game preserves
the pairing, but we key the storage under a schema version so that when
the wire format changes (as it did once, when we moved from 0/1 arm_ids to
16-bit MAC-derived ones), stale caches invalidate on the next page load
instead of stranding users on a broken slot.

## What surprised us

- The MPU6050 on our GY-521 breakouts is actually an MPU6500. WHO_AM_I
  reads 0x70, not 0x68. Adafruit's library refuses to talk to it. We
  wrote a forty-line hand-rolled I2C driver against the shared register
  map and it works on both chips.
- The ESP32-S3 will silently swallow every `Serial.println` unless you
  compile with `-DARDUINO_USB_MODE=1 -DARDUINO_USB_CDC_ON_BOOT=1`. There
  is no error, no warning, no log line: the CDC endpoint just does not
  exist. The C3 does not have this trap because it uses a USB-JTAG bridge
  instead of native USB.
- The S3's default WiFi modem-sleep drops about half of a sustained 200 Hz
  ESP-NOW stream. We now unconditionally `WiFi.setSleep(false)` and
  `esp_wifi_set_ps(WIFI_PS_NONE)` at boot. The C3 does not need this,
  which surprised us: its power-save timings evidently interact
  differently with ESP-NOW's peer schedule.
- A pure wrist twist looks like a jab if your trigger is `dynA OR wmag`.
  The wrist rotates fast (huge gyro) and the centripetal accel at the
  IMU is nontrivial. We had to change the trigger from OR to AND on
  horizontal accel, because a translational gesture requires evidence of
  translation, not just of "big motion."
- `sessionStorage` is a persistent lie waiting to happen when your data
  schema changes. Our old two-arm pairing stored `{A: 0, B: 1}`. The new
  scheme uses 16-bit ints. Old caches meant a shake on wristband #2
  fell through slot A (already assigned to 0, a value no live wristband
  produced) and slot B stayed permanently empty. We bumped the storage
  key from `v1` to `v2` and the bug disappeared.

## What's next

The cardboard arcade cabinet is the next physical build. A phone mount
inside a folded shroud gives the wristband experience a fixed camera and
a two-hand posture that reads as "arcade cabinet" instead of "person
staring at their phone." Cross-cabinet play is a small firmware change:
add a MAC filter in the dongle so it only forwards packets from the two
wristbands paired to that machine, and neighboring cabinets stop cross-
talking. Beyond that, the classifier has room for a four-player game (the
data plane already handles multiple `arm_id`s cleanly), and the natural
target is a mascot-based tennis doubles or a bowling relay. The wire
format, the pairing scheme, and the classifier all extend without a
rewrite. The only thing standing between us and that game is the cardboard.
