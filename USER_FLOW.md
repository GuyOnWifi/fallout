# Soup Games — user flow wireframes

Cold-start to first-punch, PvP session, and recovery paths.
Text wireframes so we can iterate on the flow independently of visual fidelity.

---

## Flow 1: Cold-open to first game (one player)

```
┌──────────────────────────────┐
│ landing page                 │
│                              │
│  SOUP GAMES                  │
│  wristband sports arcade     │
│                              │
│  ┌──────┐   ⇄   ┌──────┐    │  slot A + B, empty
│  │  A   │       │  B   │    │  "waiting for a wave"
│  │ ...  │       │ ...  │    │
│  └──────┘       └──────┘    │
│      [ connect hub ]         │  primary CTA
│                              │
│  ┌───┐┌───┐┌───┐┌───┐        │  game grid — clickable but
│  │Box││Bwl││Tns││Fsh│        │  greyed / soft until a slot
│  └───┘└───┘└───┘└───┘        │  is claimed
└──────────────────────────────┘
      │
      │  user clicks [ connect hub ]
      ▼
┌──────────────────────────────┐
│ browser port picker (Chrome) │
│  > /dev/ttyACM0              │
│  > /dev/ttyACM1              │
└──────────────────────────────┘
      │
      │  user picks the dongle
      ▼
┌──────────────────────────────┐
│ landing — hub connected      │
│                              │
│  slot A: waiting for wave    │  ← dot pulses gold
│  slot B: waiting for wave    │  ← dot pulses gold
│                              │
│  waiting on wristband        │  small helper text
└──────────────────────────────┘
      │
      │  user waves wristband
      ▼
┌──────────────────────────────┐
│ landing — slot A claimed     │
│                              │
│  slot A: wristband 17812     │  ← letter BLOB shakes
│         · connected          │     with wristband
│  slot B: waiting for wave    │
└──────────────────────────────┘
      │
      │  user clicks a game card
      ▼
┌──────────────────────────────┐
│ game (e.g. bowling)          │
│                              │
│  fallback: "single-player    │
│   mode — pair a second       │
│   wristband on the menu      │
│   for versus"                │
└──────────────────────────────┘
```

## Flow 2: Two-player pair-up

```
LANDING → both slots empty
        ↓  player A waves
LANDING → slot A claimed (letter shakes)
        ↓  player B waves
LANDING → slot B claimed (letter shakes)
        ↓  either player clicks a game card
GAME    → PvP mode automatically active

     if the user wants to swap sides
        ↓  click ⇄ button between the cards
LANDING → A and B swap arm_ids
        ↓  persists across game switches (sessionStorage)
```

## Flow 3: PvP boxing round

```
BOXING game-active

┌───────────────────────────────────────┐
│ HUD-p1 (player A) │ HUD-p2 (player B) │  HP + stamina + combo bars
│ ▮▮▮▮▮▮▮▮▮▮ 100    │    100 ▮▮▮▮▮▮▮▮▮▮ │
├───────────────────┼───────────────────┤
│                   │                   │
│    soup A         │    soup B         │  facing each other
│    (attacks →)    │    (← attacks)    │  fixed camera
│                   │                   │
└───────────────────┴───────────────────┘
        │
        │  A throws a jab
        ▼
    Player A's mascot animates jab, ~105ms later
    the impact fires:
      · Player B's HP -= dmg
      · Player B's mascot plays hit_jab reaction
      · Screen shakes, sparks, hit-flash
      · Combo counter for A ticks up

        │  either player's HP hits 0
        ▼
    KO fires. Camera pushes in on the loser
    (state.koLoser = whichever fighter's HP <= 0)
    Banner announces "player A wins" or B.
    Game freezes.
        │
        │  reload the page
        ▼
    Fresh match. Pairing persists via sessionStorage.
```

## Flow 4: Wristband disconnection recovery

```
GAME running, both slots live
        ↓  a wristband loses power (LiPo dies, brownout, out of range)
GAME → last-seen timer for that arm_id passes 500ms
        ↓
GAME → HUD's slot pill goes back to "idle"
        ↓  wristband comes back (LiPo swap, replug)
GAME → next sample lands under old arm_id → slot resumes "connected"
        ↓
GAME resumes without re-pairing (sessionStorage still holds the assignment)
```

## Flow 5: Session reset (used rarely, e.g. after a hard flash)

```
LANDING
        ↓  click [ reset pairing ] (planned button)
LANDING → sessionStorage cleared, both slots wiped
        ↓  wave a wristband
LANDING → first shake claims A again
```

## Cross-flow: what breaks and how the UI shows it

| Failure mode                     | Where user sees it                                                                                                          |
|----------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| Dongle unplugged                 | "connect hub" pill reappears with "hub disconnected" text.                                                                  |
| Dongle plugged but no traffic    | Slots stay on "waiting for a wave" indefinitely — no progress.                                                              |
| One wristband broadcasts, other silent | One slot claims, other keeps pulsing gold. Games hint "pair both bands for versus."                                   |
| Both wristbands broadcast but same arm_id | Only slot A claims. Slot B never fills. (Only possible if MAC collision — astronomically unlikely.)              |
| WebSerial not available (Firefox)| Landing shows a hard error: "Web Serial not available. Use Chromium." Everything else is inert.                             |

## Copy inventory (for consistency)

| Screen state             | Text                                                     |
|--------------------------|----------------------------------------------------------|
| slot empty, no hub       | waiting for a wave                                       |
| slot empty, hub live     | waiting for a wave                                       |
| slot filled, sample fresh| wristband N · connected                                  |
| slot filled, sample stale| wristband N · idle                                       |
| both slots filled        | (swap button enabled — no explicit label needed)         |
| KO fired in boxing       | KO — player A wins  /  KO — player B wins                |
| game won in tennis       | game A  /  game B  /  set A  /  set B                    |
| 10th frame closed        | player A total: 132 · player B total: 118 · player A wins|

## Open UX questions we haven't resolved yet

- Between games: do you go back to the menu to switch, or is there an in-game shortcut? (currently: back button to menu — one extra click)
- Rematch: after a KO or game-end, do you get a "play again?" pill or hard-reload the page? (currently: hard reload)
- Names beyond A / B: do the players want to type real names, or is A / B enough? (leaning: A / B, keep it fast)
- Winning ceremony: does the winning mascot cheer? Does the loser stay crumpled? (boxing does the crumple; tennis and bowling don't celebrate yet)
