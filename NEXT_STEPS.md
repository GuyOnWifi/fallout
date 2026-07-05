# NEXT_STEPS.md — pick up here

**Read `CLAUDE.md` first for permanent orientation.** This file is the "what
was just decided and what's in flight" companion — everything the previous
session ran through that isn't obvious from the code alone.

Last update: post-menu-redesign, ~1 hr after commit `d60d7c1`.

---

## Where the project is right now (60-second summary)

**Soup Sports** — a wireless-wristband arcade with 5 playable Wii-Sports-style
minigames. The repo has been through significant pivots (SpaceEngine →
Wii-Sports → Soup Sports rebrand — see `JOURNEY.md`). The direction is
**locked**. Do not re-propose SpaceEngine, gesture-driven flight, or
cockpit/joystick variants.

### What's built + shipped to `main`

- **5 games all playable and polished** at `day3/app/`:
  1. `boxing.html` — jab/hook/uppercut vs Soup opponent, first-person gloves, KO celebration with 90-piece confetti
  2. `bowling.html` — 10 tiny Soups as pins with hue jitter, chain-reaction knockdown, real 10-frame scoring, strike/spare/gutter banners
  3. `tennis.html` — swing timing vs CPU Soup across the net, rally streak with flame emoji, first to 5 rallies
  4. `baseball.html` — home-run derby vs pitcher Soup, HR distance callouts, incoming ball trail
  5. `punch_bomb.html` — **the party game.** Push-your-luck, punch Soup, hold-still-to-bank, hidden bomb count. 2-4 players.
- **Menu at `index.html`** — hand-drawn cozy meadow backdrop (tree stumps,
  wildflowers, birds), 5 cards, live 3D Soup mascot with wave.
- **Wireless firmware** in `day3/firmware/`: three PIO envs
  (`wrist_right`, `wrist_left`, `dongle`) sharing one `src/`. Broadcasts on
  ESP-NOW channel 1. Wire format is `arm,t_us,ax,ay,az,gx,gy,gz,roll,pitch`.
- **Training pipeline** in `day3/tools/`: auto-trigger `collect.py` +
  `replay.mjs` regression harness. Consumes both day1 and day3 wire formats.
- **Docs**: `CLAUDE.md`, `JOURNEY.md`, `day3/GESTURES.md`,
  `soup/HANDOFF.md`, this file.
- **Repo hygiene**: `.pio/` and `managed_components/` gitignored. 
  Pushed to `git@github.com:GuyOnWifi/fallout.git`, branch `main`.

### What's live on localhost right now

`python -m http.server 8123` is running from `day3/app/`. All 5 games plus
menu are accessible at http://localhost:8123.

---

## In-flight work + open questions

### 1. Two-player modes (asked, not yet built)

**The user just asked whether 2P should be one-hand-per-player or
two-hands-per-player.** My recommendation (agreed by the direction of the
conversation but not confirmed):

- **Solo (1 wristband) — default for bowling/tennis/baseball/bomb.** One
  hand controls everything.
- **Solo (2 wristbands) — default for boxing only.** Dual-wield gloves.
  Most iconic Wii Sports feel.
- **VS (2 wristbands, one per player)** — 1v1 mode for boxing, bowling,
  tennis, baseball. Arm 0 → P1, arm 1 → P2. `ArmDispatcher` already routes
  per-arm; just add a per-player game state.

**To build:** each game needs a mode toggle in a small pre-game screen
(or on the menu card). Modest per-game work; recommend spinning up 3-4
parallel agents when the user greenlights.

### 2. Classifier is in JAB-ONLY mode

`day3/app/classifier.js` was tuned on day1 data with a specific arm mount.
When the wireless firmware moved the sensor, thresholds drifted. Instead of
retuning without fresh data, `_classify()` was short-circuited so any valid
trigger fires `jab`.

- **Bowling/tennis/baseball/punch_bomb DO NOT USE the classifier** — they
  consume raw samples via a `dispatcher.onLine` monkey-patch (pattern from
  `bowling.html`). Not affected.
- **Boxing needs the multi-class classifier restored** to discriminate
  jab/hook/uppercut. Blocked on training data.

**Buddy is doing training** — see `day3/GESTURES.md` for the priority list
(jab, hook, uppercut, block, idle × ~20 reps per arm minimum). When those
CSVs land in `day3/tools/data/`, restore the multi-class branch in
`_classify()` and run `node replay.mjs` to verify.

### 3. Menu overflow (just fixed, worth re-verifying)

The user reported the home page overflowed without scroll. Just addressed
in commit `d60d7c1` — tighter padding, smaller hero, smaller cards. **Take
a fresh screenshot to confirm it fits at 1280×800 and typical phone
viewports.**

### 4. Hardware side is still untouched

All demo polish so far has been web. The physical build (cardboard
cabinet with phone mount, wristband strap + LiPo + vibration motor, 3D
print jobs) is the biggest remaining risk. Software floor is ready.
Hardware floor is not.

---

## Design language quick-reference (Soup Sports)

**Palette (locked):**
```
--sky-top     #d3ecf7    --grass-lite  #c5e0a6    --wood-lite   #b98b6a
--sky-mid     #b6dff2    --grass       #a8ce85    --wood        #8f5f42
--sky-deep    #94cfe8    --grass-deep  #7fb060    --wood-deep   #5f3d28
--cream       #fbf3e0    --grass-tuft  #5a8f4a    --wood-ring   #6f4630
--cream-warm  #f6e9c9    --vine        #6cb85a    --ink         #2b1e14
--cream-deep  #ecdcb1    --vine-deep   #4a9440    --ink-soft    #5a4a3d
--hot         #ee7b52    --gold        #f2c14d    --petal-pink  #f7b8c4
```
(Older `--ruin-*` and `--water` tokens still exist for legacy HUD refs.)

**Look:**
- Cream HUD panels with 3px ink borders + hard `0 4px 0 var(--ink)` drop shadows.
- Chunky rounded typography (Fredoka / Nunito / SF Pro Rounded).
- `.ss-btn` treatment: cream pill, ink border, hard drop shadow, hover-lift.
- Status pill: cream bg, gold pulse dot when disconnected → vine-green when connected.

**Menu backdrop specifically:**
- Hand-drawn meadow: sky-cyan-to-grass gradient, wobble-filter-jittered hill silhouettes, chunky tree stumps with wood rings + ivy, wildflower + mushroom accents, two bird silhouettes.
- NO grid-perfect rectangles, no gradient-heavy buildings, no crosswalks
  — those read as AI-generated.

---

## Mascot (Soup)

- File: `day3/app/assets/mascot.glb` (mirrored from `soup/soup.glb`).
- Node names: `body, ears, face_patch, eyes_nose, paws, tail`.
- Load: `soup.rotation.x = -Math.PI/2; soup.scale.setScalar(0.008)` for ~1m.
- **Do not add a second `soup.rotation.y = Math.PI`** — this bug hid the
  tennis CPU due to backface culling. See tennis polish agent report.
- Materials must be cloned before per-instance tinting.
- **No rig, no animation clips.** All animations are procedural (idle bob,
  hit shake, KO tween, bowling_pin_fall). Recipes in `soup/HANDOFF.md`.
- **Do NOT add facial detail, sparkles, ears, feet, blush, smile** — prior
  session overshot cuteness and got "no undo undo WHAT HAVE YOU DONE"'d.

---

## Puppeteer verification pattern (works reliably)

```bash
# Playwright chromium is at /home/guyonwifi/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome
# playwright-core installed at /tmp/ss-node/node_modules/playwright-core
# The script:
cat > /tmp/ss-screens/shoot.mjs <<'EOF'
import pkg from '/tmp/ss-node/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const pages = ['index','boxing','bowling','tennis','baseball','punch_bomb'];
const browser = await chromium.launch({
  executablePath: '/home/guyonwifi/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
for (const p of pages) {
  const page = await ctx.newPage();
  await page.goto(`http://localhost:8123/${p === 'index' ? '' : p + '.html'}`,
                  { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(2500);   // GLB load buffer
  await page.screenshot({ path: `/tmp/ss-screens/${p}.png` });
  await page.close();
}
await browser.close();
EOF
node /tmp/ss-screens/shoot.mjs
```

Screenshots at `/tmp/ss-screens/*.png`. Historical
`day3/_screens_before/`, `day3/_screens_after/` folders track visual
progress across commits.

---

## Recent commit history (reverse chronological, last 6)

```
d60d7c1  Menu: hand-drawn meadow backdrop + compact layout
e17d948  5th game + tennis + boxing polish + fresh screenshot pass
014e505  Painterly ruin backdrop + polish landings + Soup Bomb slot
9642deb  Real 3D Soup on the landing page
005c128  Soup Sports — four-game arcade with mascot integration
552acc8  day3 wireless boxing prototype + CLAUDE.md orientation
```

---

## Rules of engagement for the next session

Repeat of `CLAUDE.md`'s "What NOT to do" section, with extras:

- Do NOT re-propose SpaceEngine, gesture-flight, cockpit, joystick, or
  "explore the universe" variants. See `JOURNEY.md` for the full graveyard.
- Do NOT add facial detail, sparkles, ears, feet, blush, smile, or eye
  highlights to the Soup mascot unless the user explicitly asks.
- Do NOT rewrite the classifier from scratch — real thresholds tuned to
  real data.
- Do NOT touch `day1/` — historical snapshot.
- Do NOT push to `main` without asking (this session pushed a lot, but each
  push was explicitly requested — read the request pattern).
- **Do use parallel general-purpose agents for polish work at file-level
  scope.** Both major sprints in this session used them successfully
  (4 games polished in ~15 min wall-clock).
- **Do use puppeteer to verify UI/UX before claiming success** — the earlier
  session claimed things worked visually without checking and got called
  out. The screenshot pattern above is proven working.

---

## Immediate priority queue (best-guess for next session)

1. **Verify menu overflow is fixed** (fresh screenshot at 1280×800).
2. **Answer the 2P mode question and spin up agents to implement** if the
   user confirms.
3. **Restore multi-class classifier** once training data arrives (buddy's
   working on it).
4. **Hardware CAD + cabinet build** — biggest lurking risk. Not software.
5. **Optional audio pass** — one whoosh + one hit + one crowd loop per game.
   30 min each, doubles perceived polish.

## Files a new session should read in this order

1. **`CLAUDE.md`** — evergreen orientation, palette, mascot, rules.
2. **`NEXT_STEPS.md`** (this file) — recent activity, in-flight.
3. **`DEVLOG.md`** — technical war stories, presentation-ready. **Append new
   bug-fix stories at the top** as they happen. Format: "Symptom → Debug →
   Fix → Lesson." Doubles as demo-day talk material.
4. **`JOURNEY.md`** — pivot history so mistakes don't repeat.
5. **`day3/GESTURES.md`** — what each game consumes from the wristband.
6. **`soup/HANDOFF.md`** — mascot 3D details.

That's ~1700 lines total. Reasonable startup cost for a fresh session.

## Docs discipline for this repo

- `CLAUDE.md` — **evergreen.** Rewrite in place; older sections should stay
  true forever.
- `NEXT_STEPS.md` — **rolling.** Update as work state shifts. Don't append,
  rewrite in place.
- `DEVLOG.md` — **append-only, newest-first.** Every new bug fixed = new §
  at the top. Every clever solution = story worth writing down. This is
  where the demo-day talk lives.
- `JOURNEY.md` — **append-only.** Records completed pivots and their
  rationales. Don't edit prior entries.
- `day3/GESTURES.md` — **spec.** Update when adding new games / gestures.
- `soup/HANDOFF.md` — **spec.** Update when the mascot model changes.

Any session that fixes a real bug **should add a new § at the top of
DEVLOG.md** with the Symptom/Debug/Fix/Lesson format. Users have explicitly
asked for this pattern to be maintained.
