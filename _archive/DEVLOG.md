# DEVLOG.md — technical war stories from the Soup Sports build

Running devlog of bugs hit, root causes found, dead ends, and clever fixes.
Written to double as a technical presentation for the hackathon demo — each
entry stands alone as a 30-second story you could tell on stage.

**Format:** every entry has *The Symptom*, *The Debug*, *The Fix*,
*The Lesson*. Append new entries at the top so the timeline reads
newest-first when scrolling.

---

## §16. The block gesture and the phantom Soup Bomb turn skip

**The symptom.** Soup Bomb sometimes ended a player's turn immediately —
one small motion after the "you're up" banner and the game would jump
straight to the next player. It felt like the classifier was making up
punches.

**The debug.** Added a per-event log in punch_bomb.html and confirmed
`punchesThisTurn` was jumping to 3+ within milliseconds of the round
starting. Correlated with wristband dynA — the phantom punches happened
during arm *raise*, not arm *thrust*. That's the shape of a block.

**The fix.** Two lines in punch_bomb.html — `if (g.gesture !== 'jab') return;`
in the dispatcher's classifier-event handler. Blocks now silently no-op
in Soup Bomb (it doesn't have a defensive gesture concept). Punches count
as before.

**The lesson.** When a shared module (classifier) grows new event types,
every downstream consumer has to be audited. A block was a *gesture*
and the dispatcher forwarded it dutifully; punch_bomb assumed all
gesture events meant "punch." The right fix wasn't in the classifier
(where blocks are legitimate) but in the consumer that couldn't
distinguish them.

---

## §15. Simplifying the boxing classifier to jab + block

**The symptom.** Live-tuning the 3-way jab/hook/uppercut classifier kept
hitting the same wall — the user's live motion produced feature clusters
that overlapped between hook and uppercut. A wrist rotation during a
"hook" made features look uppercut-shaped; an upward drive on an
"uppercut" made features look like a jab. Sample logs showed 50–70%
accuracy under 3-way discrimination and no single feature axis that
could reliably split them.

**The debug.** Three separate live-tuning sessions collected batches
of jab/hook/uppercut with the ask "these were all X" and each time the
features overlapped enough that any rule tuned for one batch broke the
others. The gravity-aligned features assume rotation-invariance to first
order, but during a swing the wrist rotates 30–90° — Mahony-style
attitude fusion would fix it, but that's not a demo-day project.

**The fix.** Collapse to two gestures: `jab` (any peak-detected swing
that doesn't look like a guard) and `block` (any peak-detected swing
with big `up` peak and near-zero `down` peak — an upward guard motion).
`up ≥ 22 AND down ≤ 15 → block`, else → jab. Boxing repurposes hook
and uppercut animations as visual variety on jabs; damage tables kept
for legacy dev shortcuts. The refractory dropped from 850 ms → 450 ms
so back-to-back jabs stop getting swallowed.

**The lesson.** Sometimes the fix is to remove a class, not to tune
a threshold. The 3-way problem was fundamentally under-observed —
we only had translational accel and gyro, and the three punches share
a lot of the same signal. Two classes with genuinely different feature
signatures (attack vs. guard) is a completely different problem than
three attacks with overlapping signatures. Trade: lost animation
richness on the input side, gained reliability that survives a demo.

---

## §14. Tennis: ballistic net-clearance iterator and the let-cord bounce

**The symptom.** Every rally return in tennis hit the net. The serve
worked because the ball starts at ~2.3 m (above the mascot's head), so
the ballistic arc naturally cleared the 0.914 m net. Returns started
from `ball.position` — which was ~3 cm off the ground after a bounce —
and the ballistic solver's `minT = 0.55 s` gave a low, fast arc that
peaked at ~0.4 m. The net top is at 0.914 m. Every return smacked
straight into it.

**The debug.** Symbolically computed the ball's y-height at the z=0
crossing: `y_net = from.y + vy·t_net − 0.5·g·t_net²`, where
`t_net = |from.z| / |vz|`. Plugged in the actual numbers and got 0.4 m.
Net is 0.914. Zero clearance, always.

**The fix.** Two-part.

1. **Iterate the arc.** `ballisticVelocity` now checks the linear-interp
   height at z=0 crossing and, if it's under `NET_H_CENTER + 0.35`,
   stretches `t` by 18% and recomputes. Up to 6 iterations, capped at
   `maxT = 1.6 s`. Returns naturally get taller arcs when they need
   them; serves that already clear the net don't waste time.
2. **Net-cord bounce instead of point-loss.** Even with the iterator,
   the ball can theoretically still clip the top of the net (rare
   edge case). Instead of ending the point, the ball now deflects off
   the net cord back to the hitter — `vy → |vy|·0.6 + 1.2` upward,
   `vx → 0.6·vx`, `vz → −0.35·vz`. Play continues. Real tennis calls
   this a "let cord;" here it's a demo-day fairness knob.

Trade-offs, honestly: the iterator makes returns look a bit floaty
compared to real tennis (max arc time bumped from 1.2 s → 1.6 s), but
the alternative was a game that felt unwinnable.

**The lesson.** Physics simulation constants that work for one initial
condition (serve from high) can silently fail for another (return from
low) even when the code is identical. When you add a new call site to
a shared solver, walk the physics in both regimes on paper before
trusting it.

---

## §13. Universal wristband firmware — MAC-derived arm_id

**The symptom.** With two wristbands live at the same time, the browser's
pairing menu would only ever fill slot A. Slot B stayed empty. The user
also had to remember which env to flash (`wrist_a` vs `wrist_b`), and any
mismatched flash silently produced a "phantom" arm ID that no browser
game would route correctly.

**The debug.** Two compounding problems.
1. ARM_ID was a compile-time constant (`-DARM_ID=0/1`) baked in per env.
   Flash the wrong env and you got two wristbands claiming arm 0. The
   dongle happily forwards both streams — they interleave into arm 0's
   classifier state machine and neither works.
2. Even after fixing #1, sessionStorage in pairing.js had a stale
   `{ A: 0, B: 1 }` from the old two-arm world. New MAC-derived arm_ids
   (5-digit ints like 33221) never matched, so slot A appeared "already
   assigned" and the first shake fell through to slot B, leaving the
   second wristband with nowhere to go.

**The fix.** Two moves.
1. In `wrist.cpp`, replace the `#define ARM_ID` with a runtime derivation:
   `esp_read_mac(mac, ESP_MAC_WIFI_STA); arm_id = (mac[4]<<8) | mac[5];`
   The last 2 bytes of the WiFi MAC are chip-unique (collisions at ~1 in
   65k, comfortably below hackathon demo scale). One binary flashes any
   wristband. Deleted the `wrist_a` / `wrist_b` envs from platformio.ini.
2. In `pairing.js`, bump `STORE_KEY` from `v1` to `v2`. Old cached
   assignments get invalidated the moment the page loads.

Nothing on the browser side needed changes — `dispatch.js` and
`pairing.js` already keyed on `armId` as an opaque integer, so the
transition from 0/1 to 5-digit MAC ints was zero-refactor.

**The lesson.** Compile-time device identity is a foot-gun for
multi-device setups. Chip-unique identity (MAC, efuse) is free on ESP32
and eliminates a whole class of "did I flash the right env" bugs. Persist
state with a version key so schema changes don't strand users on stale
caches.

---

## §12. The §11 bug was hiding in three more files — full-UI design audit findings

**The symptom.** A design audit pass over all six pages started from
screenshots and immediately found three missing mascots that nobody had
reported: the landing-page hero Soup (menu), the bowler Soup (bowling), and
the pitcher Soup (baseball) all rendered zero pixels. Each page logged
"mascot loaded" happily. On top of that, the UI itself read as
machine-generated: every game had invented its own button styles and corner
positions, two games drew raw debug logs on screen ("[12:52:25] mascot
loaded"), bowling and tennis showed two competing instruction banners at
once, and the copy was full of ALL-CAPS imperatives, em dashes, and
exclamation points.

**The debug.** All three invisible mascots shared the same line:
`soup.rotation.y = Math.PI` after the canonical `rotation.x = -Math.PI/2`
flip — the exact bug documented in §11 for tennis. Setting both angles on
one Euler does not compose the way the comment claims ("face -Z"): with
three.js's default XYZ order the pair lands the mascot upside down /
inverted, so he ends up below the floor or showing no lit pixels. §11
documented the fix but only fixed tennis; the same copy-pasted line
survived in index.html, bowling.html, and baseball.html. Notably the
baseball comment even said "face -Z (toward home plate)" — but home plate
is in +Z from the mound, so the flip was wrong twice.

**The fix.** Delete the y-flip in all three files (after the x-flip the
mascot already faces +Z, which is toward the camera/plate in every one of
these scenes). The menu hero, bowling sideline Soup, and pitcher all render
now. The rest of the audit unified the chrome across all six pages: one
`.ss-btn` pill treatment, menu pill top-left, a single hub pill top-right
that doubles as the connect button *and* the status indicator (the separate
status pill is gone — one element fewer per page, and the connect button no
longer disappears when dev keys fire `game-active`), score HUD top-center
(dropping to `top: 64px` under 640px so nothing collides on the phone),
prompts as lowercase cream pills bottom-center, dev-key hints as faint
bottom-right text hidden on phones, debug `#log` display:none. Copy
rewritten throughout (no em dashes, no exclamation-point design, lowercase
voice; "Punch Bomb" renamed to its real name Soup Bomb). Emoji-as-icons
(🥊🎾💨🔥 etc.) replaced with small inline SVGs. Boxing and Soup Bomb got
aspect-aware FOV (55° landscape → ~70° portrait) so Soup doesn't swallow
the phone frame in the cardboard shroud.

**The lesson.** When a bug is documented as fixed, grep for the offending
line across the whole repo before closing it — §11's line was copy-pasted
into four files and only one got fixed. `grep -rn "rotation.y = Math.PI"
day3/app/` would have caught all of them in one shot months of demo-time
earlier. And for UI: screenshots at both 1280×800 *and* 390×844 are the
audit tool — every mobile overlap found in this pass was invisible at
desktop size.

---

## §11. "The CPU was there but invisible" — tennis mascot backface bug

**The symptom.** After the tennis polish pass integrated the Soup mascot as
the CPU opponent, the placeholder sphere rendered fine but the loaded GLB
rendered as literally zero pixels. Verified in Puppeteer screenshots: net
visible, court visible, no soup across the net. Console showed the model
loaded successfully. Placeholder swap logic ran. Where was he?

**The debug.** The obvious "he's off-camera" hypothesis was checked first —
scaled to 5m tall to overwhelm any framing issue. Still nothing on screen.
Bounding-box print from Three.js showed the mesh existed at
`(0, 0..2.4, ~far-baseline)` — well within camera view. That ruled out
transform, scale, and position.

Attention turned to material state. Rendering with `MeshBasicMaterial` red
override worked — every polygon on screen. Rendering with the loaded PBR
material didn't. **The problem was in the transform chain, not the material.**

Look at the load code:
```js
soup.rotation.x = -Math.PI / 2;   // z-up model → y-up scene
soup.rotation.y = Math.PI;        // "face -Z toward the player"
```

Two rotations in Euler XYZ compose. The first flip is canonical (from
`soup/HANDOFF.md`). The second rotation was added "to face the player" —
but after the -π/2 X-flip, the mascot's face is already pointing +Z toward
the camera. The extra Y-flip rotated the world such that **all polygons
were oriented away from the camera**. Three.js's default backface culling
skipped every triangle. Present but invisible.

**The fix.** Delete the `soup.rotation.y = Math.PI` line. Trust the HANDOFF
doc.

**The lesson.** Two rotations that "should" compose intuitively actually
combine into something that inverts winding order. When a mesh loads,
renders, has correct transform state, but shows no pixels — think about
face orientation before you think about anything else. Also: when a HANDOFF
doc says "after the flip, the face already points +Z," believe it.

---

## §10. Bowling camera framing: pins as horizon dust

**The symptom.** First bowling screenshot: pins were 2-pixel specks at the
top of the frame, ball was invisible, tutorial overlays visible but the
actual game was unreadable. Judge would look at this and go "where's the
game?"

**The debug.** Three separate camera-vs-scene bugs stacked:

1. Camera at `(0, 1.7, 2.5)`, ball at `z = 1` — ball is *behind* the camera
   at z=2.5 looking down the -z axis to the pins.
2. Pins at `z = -25`, camera at 55° FOV. At that distance a pin is
   ~0.35m tall, subtending under 1° of the frame.
3. Fog `(8, 30)` hazed the pins even more.

Three bugs, one visible outcome ("nothing to see").

**The fix.** Reframe: camera → `(0, 2.2, 4.5)`, look at `(0, 1.0, -6)`. Pins
moved to `z = -9`. Pin scale 0.0025 → 0.0075 (3x). Backstop wall added
behind the pins so they read against a solid surface, not sky. Fog pushed
to `(16, 45)`. Now pins fill ~15% of the frame — legible and inviting.

**The lesson.** "Nothing on screen" almost always means multiple small
things combining. Debug one axis at a time: put a giant red sphere at
`z = 0` to prove camera framing; then add scale; then add fog. Camera bugs
compound with scale bugs and both compound with fog. Isolate.

---

## §9. Four polish agents in parallel finished faster than one would

**The situation.** Needed four games (boxing, bowling, tennis, baseball)
each polished to the Soup Sports brand. Sequentially: ~2 hours. In parallel
with clean file-level scope: **~15 minutes wall-clock, all four**.

**The recipe that worked.** Each agent got:
- A **before-screenshot** in the prompt so they could see the current state.
- A **single-file write scope** (`bowling.html` only, etc.) — no shared
  state to merge, no diffs to reconcile.
- **Explicit "do not touch" list** naming the shared JS modules and other
  games so nobody stomped on parallel work.
- A **detailed spec** with pixel-level palette + specific animation recipes.
- A **verification handle** (curl + Puppeteer screenshot path) so they
  could self-verify before returning.

**The failure mode that could have happened.** If two agents had needed to
touch `dispatch.js` or `classifier.js`, the last one to write would clobber
the first. Would have wasted an agent-hour. Avoided by carefully scoping.

**The lesson.** Parallel agents work when: (1) file-level ownership is
clean, (2) each has a self-verification path, (3) each has a "don't touch"
list explicitly naming the shared code. The 15-minute run cost per game
compounds into massive wins if you have real parallelism.

---

## §8. The MPU6050 that wasn't (WHO_AM_I = 0x70)

**The symptom.** Wired up a GY-521 "MPU6050" board. Adafruit's `mpu.begin()`
returned false. I²C bus scan said something was answering at address `0x68`.
The chip existed. Adafruit refused to talk to it.

**The debug.** Read the WHO_AM_I register directly (`0x75`). Expected
`0x68`. Got **`0x70`**. That's the identifier for an **MPU6500** — the
successor chip. The board silkscreen said "MPU6050" but the actual silicon
was different. Adafruit's library strictly checks WHO_AM_I and refuses
anything that doesn't match.

**The fix.** Ditched the library. Wrote a hand-rolled I²C driver
(`day3/firmware/src/mpu.h`, ~40 lines) that just knows the shared register
map. MPU6050 and MPU6500 use identical registers for basic accel + gyro —
different WHO_AM_I values, same functionality. Works with either chip. Now
the firmware is *more portable* than the library version, not less.

**The lesson.** Cheap Chinese IMU breakouts are a **silicon lottery**.
Never trust the silkscreen. If your vendor library rejects the chip, don't
switch libraries — read the datasheet and just write the four register
writes yourself. Faster and more permanent than fighting library ecosystems.

Also: **the WHO_AM_I byte should be the first thing you print from any
firmware bring-up.** Diagnostic gold, five lines to add, saves hours
downstream.

---

## §7. Silent USB CDC on the S3

**The symptom.** Flashed a fresh sketch onto XIAO ESP32-S3. Serial monitor:
completely blank. No boot text. No `#`. Nothing. Board was clearly running
(LED blinked, reset behavior worked), but `Serial.println("hello world")`
produced zero output over USB-C.

**The debug.** Chased the wrong things first: baud rate mismatch, wrong
port, cable damage. Reflashed twice. Swapped USB cables. Swapped ports.
Same silence.

Actual root cause: the ESP32-S3 has native USB, and the Arduino core needs
a **compile-time flag** to enable Serial-over-USB-CDC on boot. Without it,
the default USB stack doesn't expose a CDC endpoint and every `Serial.write`
goes into the void with **no error, no warning, no log**.

**The fix.** Add to every PIO env:
```
build_flags =
  -DARDUINO_USB_MODE=1
  -DARDUINO_USB_CDC_ON_BOOT=1
```

Silent output → verbose output. Cost: two lines. Time spent finding: one
hour.

**The lesson.** ESP-S3 quirks are unforgiving because they fail silently.
Any board with native USB (as opposed to USB-UART bridge chips like CP210x)
has this kind of trap. Set the two USB flags in every PIO template before
you write a line of firmware.

---

## §6. The wrist-rotation problem: sensor frame vs body frame

**The symptom.** Trained the classifier on labeled reps collected with the
band mounted a specific way. Live testing worked. Then someone put the band
on their other arm — or same arm, different rotation — and the classifier
started firing wrong gestures. Hooks read as jabs. Jabs read as garbage.

**The debug.** The features the classifier used — `ax`, `gx`, `gz` — are
axes in the **IMU chip's own reference frame**. Rotate the chip 90° and
"forward" (+X in training) is now "sideways" (+Z or +Y). The classifier
is looking at the same physical motion through a rotated lens and
correctly reporting a rotated pattern. It's not confused; it's giving
you exactly what you asked for.

**The fix.** Move to **gravity-aligned features**. Low-pass the accel to
estimate the sensor-frame direction of gravity. Decompose every sample
into:
- `a_up` (component along gravity) — invariant to wrist rotation about
  horizontal axes (supination/pronation).
- `a_horiz` (magnitude in horizontal plane) — invariant to yaw around
  vertical.
- `ω_mag` (total gyro magnitude) — orientation-invariant by construction.

Now "punch forward" = `a_horiz` spikes regardless of how the wrist is
rolled. Uppercut = `a_up` positive spike, always. Hook vs jab = discriminate
on `ω_mag`.

**The interesting nuance.** We can't recover absolute *yaw* around gravity
without a magnetometer. But for boxing, the *magnitude* of forward motion
matters, not the compass direction of that motion. A jab thrown facing
north and a jab thrown facing east are both jabs. Gravity gives us enough.

**The lesson.** Sensor-frame features are fragile the moment the sensor
moves relative to the body. If your problem is body-relative (boxing:
"forward relative to me"), you need body-anchored features. Gravity is a
free body-anchor for two axes. The third axis (yaw around gravity) usually
doesn't matter for gestural input.

---

## §5. False positive: wrist twist reads as jab

**The symptom.** After moving to gravity-aligned features, the classifier
still fired jabs when the user rotated their wrist rapidly without moving
their arm at all. Twist your palm from down to up — jab. Not what we want.

**The debug.** The trigger was checking `dynA >= threshold OR wmag >=
threshold`. A pure wrist twist has huge gyro (fast rotation) and moderate
accel (centripetal at the wrist). The `OR` fired on gyro alone. Peak
sanity gate `MIN_PEAK_DYNA` was satisfied by the centripetal accel from
fast rotation.

**The realization.** A jab is fundamentally a **translational** gesture —
the hand goes from A to B in space. A wrist twist is a **rotational**
gesture — the hand stays in place, just rotates. The classifier needed to
distinguish these categories, not just detect "big motion."

**The fix.** Change the trigger from OR to AND on horizontal accel:
```js
if (p.horiz >= JAB_HORIZ_MIN && p.dynA >= MIN_PEAK_DYNA)
```

`horiz` is the gravity-aligned horizontal accel magnitude — invariant
to orientation, tracks actual translational motion. A wrist twist has
low `horiz` (the hand doesn't translate), so it can't fire.

**The lesson.** Every gesture has a "signature category" — translational,
rotational, sustained-still. Your trigger should require **evidence in the
right category**, not just "any big number." Otherwise you'll get
false-positives from motions in the wrong category with big magnitudes.

---

## §4. Puppeteer wanted a specific Chrome binary

**The symptom.** Tried to use the Playwright MCP for visual verification.
It refused with `Chromium distribution 'chrome' is not found at
/opt/google/chrome/chrome`. Suggested `npx playwright install chrome`.
That invocation wanted sudo password. No good.

**The debug.** Discovered we had:
- `/usr/sbin/chromium` (system chromium — works but MCP won't use it)
- `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` (Playwright's
  own bundle — from the earlier `npx playwright install chromium` run)
- No `/opt/google/chrome/chrome` (what MCP wanted)

**The fix.** Bypass the MCP entirely. Install `playwright-core` in a temp
node project. Write a small screenshot script that points explicitly at
the playwright chromium binary:

```js
const browser = await chromium.launch({
  executablePath: '/home/guyonwifi/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
  headless: true,
});
```

Works reliably. `NEXT_STEPS.md` has the full recipe.

**The lesson.** MCP browsers assume production-managed installs; local
dev doesn't fit their assumptions. Falling back to `playwright-core` +
explicit `executablePath` is a permanent solution and simpler than fighting
the MCP path expectations.

---

## §3. Menu backdrop reads as "AI-generated"

**The symptom.** After the first Soup Sports pass, the landing menu had a
custom SVG backdrop I'd hand-authored: two clusters of stacked cyan-blue
building rectangles with vine drapes, chrome highway arcs, and a crosswalk-
like water pattern at the bottom. User feedback: **"looks less AI. make it
more unique."**

**The debug.** Compared side-by-side against the reference the user
liked. My scene had:
- Grid-perfect stacked rectangles (AI vibe)
- Repeated identical windows in perfectly regular patterns (AI vibe)
- Zebra-crossing water polygons (dead giveaway — this is what generative
  models over-render)
- Radial gradients doing the work of "buildings"

The reference had:
- Hand-drawn organic shapes with wobbly edges
- Chunky tree stumps as pedestals
- Wildflowers and mushrooms scattered
- No perfect rectangles anywhere

**The fix.** Replace the entire backdrop. Use an `feTurbulence`+
`feDisplacementMap` SVG wobble filter to jitter every filled shape so
edges look hand-drawn. Compose with tree stumps (concentric wood rings),
mushrooms, wildflowers, grass tufts, and two bird silhouettes. Soft
mint-sage grass gradient instead of harsh water blue.

**The lesson.** "AI-generated aesthetic" is real and specific: perfect
geometry, obsessive symmetry, gradient-heavy fills, repeated motifs at
metronomic intervals. To dodge it: **introduce controlled imperfection**
(SVG wobble filter is a cheap way), break symmetry, replace geometric
primitives with organic silhouettes (tree stumps > rectangular buildings),
and add lived-in clutter (flowers, mushrooms, grass).

---

## §2. The mascot cuteness overshoot ("NO UNDO UNDO WHAT HAVE YOU DONE")

**The symptom.** After the first pass of the mascot, a follow-up agent
added tall bat ears, eye sparkles, blush cheeks, a smile, and little feet.
Objectively "cuter." User's reaction was immediate and unambiguous:
**"no undo undo WHAT HAVE YOU DONE."** Reverted.

**The debug.** Not a bug per se — a taste failure. The mascot's design
constraint was "two balls, keep the head good, be simple to make less
fuck-ups." Adding limbs, sparkles, and expressions violated the constraint
without being asked to.

**The fix.** Revert to the sober two-ball design. Add a rule to
`soup/HANDOFF.md` and `CLAUDE.md` documenting the forbidden additions:
**do not add ears, sparkles, feet, smile, blush, eye highlights** unless
explicitly asked.

**The lesson.** Constraint violations that "make things nicer" still lose
if they weren't asked for. When someone gives you a design constraint,
enshrine it in a spec doc so future agents don't re-violate it. Prior
sessions' aesthetic aggression is exactly the kind of thing that gets
enshrined in `CLAUDE.md`'s "what NOT to do" section.

---

## §1. The invisible mascot on the boxing ring (title overlay bug)

**The symptom.** After the boxing polish pass claimed to have integrated
the Soup mascot as the opponent, a Puppeteer screenshot showed the ring
floor, the ropes, and the "SOUP BOXING" title — but no Soup. Where was he?

**The debug.** Bounding-box print showed the mesh existed in world at
`y = 0..2.44m`, `z = -0.80..+0.96` — squarely in front of the camera.
Backface culling ruled out (this bug is described in §11 — Soup was
correctly oriented in the boxing scene, unlike the tennis pass).

Then it clicked: the title overlay covering the ring on load had a
z-index of 70 and a background overlay. It was **supposed to fade out
when the game becomes active**, but "game-active" only got set on connect,
and there was no way to connect during a Puppeteer screenshot. Title
lingered forever, hiding the whole ring, including Soup.

**The fix.** Two changes:
1. Auto-fade the title 2.4s after page load whether or not you connect.
2. `markGestured()` also fades the title on any input, real or dev-key.

Now the title functions as an intro splash, not a permanent occlusion.

**The lesson.** UI states that "should never linger" often do linger in
tests that don't exercise the state transitions. If your screenshot rig
doesn't fire the events that dismiss overlays, the overlays cover the
screenshot. **Test the visible state, not the code path.**

Also: for demo software, prefer auto-fade timers on intro splashes.
Judges pass hardware around, wristbands connect and disconnect, the
"game not connected yet" state should never block them from *seeing*
what the game looks like.

---

## Ongoing: things to add as they come up

- Latency numbers (ESP-NOW round-trip) once measured
- Bomb-detection tuning notes once played with real hardware
- 2-player mode implementation notes (in-flight decision)
- Training data collection quirks from the buddy's session
- Physical cabinet build notes

Every new bug fixed = new §. Every clever solution = worth writing down.
