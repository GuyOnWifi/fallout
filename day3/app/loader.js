// loader.js — Soup Sports 3-card tutorial slideshow overlay.
//
// Dimmed scrim over the game + a fixed cream card frame that slides through
// three tutorial cards before play starts:
//   Card 1 — HOW TO PAIR   (blue wristband A / red wristband B wave + lock in)
//   Card 2 — HOW TO PLAY   (per-game gesture demo, same scenes as before)
//   Card 3 — HOW TO WIN    (two mascots, blue/red scores ticking up)
//
// Call showLoader({ game, tips }) once at module-init time.
//   game — 'boxing' | 'bowling' | 'tennis' | 'ninja' | 'badminton' | 'pingpong'
//          (anything else / omitted → generic wristband-wave scene on Card 2)
//   tips — ACCEPTED BUT IGNORED. Kept so existing call sites don't break;
//          the structured cards replaced the rotating tip strings.
//
// Timing: cards auto-advance every DWELL_MS (wrapping 3 → 1 if the game is
// slow to load). The overlay holds for at least MIN_MS (one full pass of the
// deck); after that it hides as soon as <body> has class `game-active`, and
// always hides by MAX_MS. The #skip-loader pill hides it immediately.
//
// Player color code (Switch-joycon palette, used across all cards):
//   Player A = blue #0088cc     Player B = red #e60012
//
// Self-contained: injects its own styles, inline SVG only, no external assets.

const DWELL_MS = 2500;               // per-card dwell
const CARDS    = 2;                  // pair-up card dropped; keep how-to-play + how-to-win
const MIN_MS   = DWELL_MS * CARDS;   // 5000 — one full pass of the deck
const MAX_MS   = 10000;

const INK  = 'var(--ink, #1c2a3a)';
const BLUE = '#0088cc';              // Player A
const RED  = '#e60012';              // Player B

// ── shared SVG bits ─────────────────────────────────────────────────────────
// Classes (defined in CSS below): lc cream-fill, li ink-fill, lg gold-fill,
// lh hot-fill, ln no-fill, si ink-stroke 3px round.

// Small side-view soup mascot, feet on the ground line, gentle bob + blink.
const soup = (x, y) => `
  <g class="ss-l-bob">
    <circle class="lc si" cx="${x - 16}" cy="${y - 26}" r="9"/>
    <circle class="lc si" cx="${x + 16}" cy="${y - 26}" r="9"/>
    <ellipse class="lc si" cx="${x}" cy="${y + 8}" rx="30" ry="28"/>
    <g class="ss-l-eyes" style="transform-origin:${x}px ${y + 4}px">
      <ellipse class="li" cx="${x - 9}" cy="${y + 4}" rx="3" ry="4"/>
      <ellipse class="li" cx="${x + 9}" cy="${y + 4}" rx="3" ry="4"/>
    </g>
  </g>`;

// Every scene shares the sky backdrop (hard ink drop-shadow rect underneath),
// a faint ground line, and floor shadows under whoever is standing in it.
// Contents are clipped to the backdrop so tall swings can't poke onto the
// cream card. `uid` keeps gradient/clip ids unique — three SVGs coexist now.
const scene = (label, uid, shadowXs, inner) => `
<svg class="ss-loader-demo" viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg"
     role="img" aria-label="${label}">
  <defs>
    <linearGradient id="ss-l-sky-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7bd3ee"/>
      <stop offset="1" stop-color="#37a7d0"/>
    </linearGradient>
    <clipPath id="ss-l-clip-${uid}">
      <rect x="10" y="10" width="220" height="130" rx="14"/>
    </clipPath>
  </defs>
  <rect x="10" y="15" width="220" height="130" rx="14" class="li"/>
  <rect x="10" y="10" width="220" height="130" rx="14" fill="url(#ss-l-sky-${uid})"
        stroke="${INK}" stroke-width="3"/>
  <g clip-path="url(#ss-l-clip-${uid})">
  <line class="si ln" x1="28" y1="122" x2="212" y2="122" opacity=".25"/>
  ${shadowXs.map(x => `<ellipse class="li" cx="${x}" cy="122" rx="26" ry="5" opacity=".16"/>`).join('')}
  ${inner}
  </g>
</svg>`;

// ── Card 1: pairing scene ───────────────────────────────────────────────────
// Two wristbands — blue A left, red B right. Blue waves then locks in
// (colored check badge pops above it), then red does the same. 3.2s loop.

const wrist = (x, color, letter, cls) => `
  <g class="${cls}" style="transform-origin:${x}px 106px">
    <rect class="lc si" x="${x - 5.5}" y="62" width="11" height="44" rx="5.5"/>
    <circle class="lc si" cx="${x}" cy="56" r="8"/>
    <rect class="si" fill="${color}" x="${x - 10}" y="76" width="20" height="13" rx="4"/>
    <text x="${x}" y="86" text-anchor="middle" font-size="10" fill="#fffdf5">${letter}</text>
  </g>`;

const lockBadge = (x, color, cls) => `
  <g class="${cls}" style="transform-origin:${x}px 36px">
    <circle cx="${x}" cy="36" r="10" fill="${color}" stroke="${INK}" stroke-width="3"/>
    <path class="ln" d="M ${x - 4.5},36 l 3.5,3.5 l 6,-6.5" stroke="#fffdf5"
          stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

const PAIR_INNER =
  wrist(78, BLUE, 'A', 'ss-l-bandA') + lockBadge(78, BLUE, 'ss-l-lockA') +
  wrist(162, RED, 'B', 'ss-l-bandB') + lockBadge(162, RED, 'ss-l-lockB');

// ── Card 3: scoring scene ───────────────────────────────────────────────────
// Two mascots face off; blue A score left, red B score right, ticking up in
// alternation (A, B, A) over a 4s loop. Digits are stacked <text> layers
// toggled by opacity keyframes.

const digit = (x, n, color, cls) => `
  <text class="${cls}" x="${x}" y="50" text-anchor="middle" font-size="34"
        fill="${color}" stroke="${INK}" stroke-width="1" paint-order="stroke">${n}</text>`;

const WIN_INNER =
  soup(70, 88) + soup(170, 88) +
  `<text x="120" y="46" text-anchor="middle" font-size="18" fill="${INK}" opacity=".55">–</text>` +
  digit(52, 0, BLUE, 'ss-l-sA0') + digit(52, 1, BLUE, 'ss-l-sA1') + digit(52, 2, BLUE, 'ss-l-sA2') +
  digit(188, 0, RED, 'ss-l-sB0') + digit(188, 1, RED, 'ss-l-sB1');

// ── Card 2: per-game gesture demo scenes ────────────────────────────────────
// All animated groups use absolute view-box coordinates + CSS keyframes
// (transform-box defaults to view-box, so px transform-origins are exact).
// Each loop is 1.6 s.

const SCENES = {
  // Arm snaps forward-and-down (jab), speed-line "→" trail flashes.
  boxing: `
    ${soup(64, 80)}
    <g class="ss-l-jab" style="transform-origin:90px 80px">
      <rect class="lc si" x="84" y="74" width="38" height="13" rx="6.5"/>
      <circle class="lc si" cx="126" cy="80" r="10"/>
    </g>
    <g class="ss-l-jab-trail ln si" stroke="#fffdf5" stroke-width="3.5">
      <path d="M 148,86 h 34 m -10,-8 l 10,8 l -10,8"/>
      <path d="M 144,68 h 18" opacity=".55"/>
      <path d="M 144,104 h 18" opacity=".55"/>
    </g>`,

  // Arm winds behind the body (drawn under the mascot, so the wind-up is
  // occluded), swings underhand through; gold ball releases at the bottom of
  // the arc and rolls off toward the ground.
  bowling: `
    <g class="ss-l-bowl-arm" style="transform-origin:88px 74px">
      <rect class="lc si" x="82.5" y="74" width="11" height="30" rx="5.5"/>
      <circle class="ss-l-bowl-held lg si" cx="88" cy="110" r="8"/>
    </g>
    ${soup(64, 80)}
    <circle class="ss-l-bowl-ball lg si" cx="116" cy="94" r="8"/>`,

  // Racket sweeps across the body (forehand); cream trail arc on the head.
  // Racket group drawn under the mascot so the wind-up sits behind the head.
  tennis: `
    <path class="ss-l-swing-trail ln" d="M 38,59 A 52,52 0 0 1 135,50"
          stroke="#fffdf5" stroke-width="5" stroke-linecap="round"/>
    <g class="ss-l-tennis" style="transform-origin:88px 72px">
      <rect class="lc si" x="83" y="42" width="10" height="34" rx="5"/>
      <line class="si" x1="88" y1="44" x2="88" y2="36"/>
      <ellipse class="lc si" cx="88" cy="23" rx="11" ry="14"/>
      <path class="ln" d="M 80,18 h 16 M 80,28 h 16 M 88,10 v 26"
            stroke="${INK}" stroke-width="1.5" opacity=".4"/>
    </g>
    ${soup(64, 80)}`,

  // Taller arc than tennis (long-shaft racket, small head); shuttlecock cone
  // floats to a peak then drops sharply.
  badminton: `
    <path class="ss-l-swing-trail ln" d="M 31,82 A 58,58 0 1 1 146,67"
          stroke="#fffdf5" stroke-width="5" stroke-linecap="round"/>
    <g class="ss-l-badminton" style="transform-origin:88px 72px">
      <rect class="lc si" x="83" y="44" width="10" height="32" rx="5"/>
      <line class="si" x1="88" y1="46" x2="88" y2="30"/>
      <ellipse class="lc si" cx="88" cy="20" rx="8" ry="11"/>
    </g>
    ${soup(64, 80)}
    <g class="ss-l-shuttle">
      <path class="lc si" d="M 128,40 L 121,27 L 135,27 Z"/>
      <circle class="lg si" cx="128" cy="42" r="4"/>
    </g>`,

  // Quick short paddle flick (forward-biased so the paddle stays in front of
  // the face), two snaps per loop, flash speed lines.
  pingpong: `
    ${soup(64, 80)}
    <g class="ss-l-pp" style="transform-origin:92px 84px">
      <rect class="lc si" x="87" y="58" width="10" height="28" rx="5"/>
      <rect class="lc si" x="88.5" y="48" width="7" height="12" rx="3"/>
      <ellipse class="lh si" cx="92" cy="38" rx="11" ry="13"/>
    </g>
    <g class="ss-l-pp-lines ln si" stroke="#fffdf5" stroke-width="3.5">
      <path d="M 148,58 h 14"/>
      <path d="M 146,70 h 10" opacity=".6"/>
    </g>`,

  // Wrist vertical, blade slashes left-to-right, curved cream trail. Blade
  // drawn under the mascot so the wind-up sits behind the head.
  ninja: `
    <path class="ss-l-slash-trail ln" d="M 41,42 A 60,60 0 0 1 139,42"
          stroke="#fffdf5" stroke-width="5" stroke-linecap="round"/>
    <g class="ss-l-ninja" style="transform-origin:90px 76px">
      <rect class="lc si" x="85" y="52" width="10" height="26" rx="5"/>
      <circle class="lc si" cx="90" cy="48" r="7"/>
      <path class="si" fill="#fffdf5" d="M 86,42 L 86,18 Q 90,10 94,18 L 94,42 Z"/>
      <rect class="li" x="83" y="40" width="14" height="5" rx="2.5"/>
    </g>
    ${soup(64, 80)}`,

  // Fallback: friendly wristband wave with radio-signal arcs.
  generic: `
    ${soup(64, 80)}
    <g class="ss-l-wave" style="transform-origin:90px 78px">
      <rect class="lc si" x="85" y="50" width="10" height="30" rx="5"/>
      <rect class="li" x="82" y="58" width="16" height="7" rx="3.5"/>
      <circle class="lc si" cx="90" cy="44" r="8"/>
    </g>
    <g class="ss-l-signal ln si" stroke="#fffdf5" stroke-width="3">
      <path d="M 106,54 a 10,10 0 0 1 0,16"/>
      <path d="M 113,48 a 19,19 0 0 1 0,28"/>
    </g>`,
};

// ── body copy ───────────────────────────────────────────────────────────────

const PAIR_COPY =
  `shake your wristband to claim a slot. <span class="ss-pa">blue is player A</span>, ` +
  `<span class="ss-pb">red is player B</span>.`;

const PLAY_COPY = {
  boxing:    'jab to attack. raise your arm up to block — a well-timed block stuns your opponent.',
  bowling:   'swing underhand and let go at the low point.',
  tennis:    'swing forehand or backhand when the ball is near.',
  badminton: 'light flicks for the shuttle, wait for it to drop.',
  pingpong:  'short snappy paddle taps, the ball is quick.',
  ninja:     'slash any direction, avoid the bombs.',
  generic:   'wave your wristband to make moves.',
};

const WIN_COPY = {
  boxing:    'first to KO wins. blocking stuns your opponent.',
  bowling:   '10 frames, most pins wins. strikes and spares stack.',
  tennis:    'first to 6 games, must win by 2. deuce breaks at advantage.',
  badminton: 'first to 21 points, win by 2.',
  pingpong:  'first to 11 points, win by 2.',
  ninja:     'slice the fruit, avoid bombs. highest score in 60s wins.',
  generic:   'score more than your rival before time runs out.',
};

const CSS = `
#ss-loader {
  position: fixed; inset: 0; z-index: 99999;
  display: flex; align-items: center; justify-content: center;
  background: rgba(28, 42, 58, 0.72);
  font-family: Fredoka, Nunito, 'Segoe UI', system-ui, sans-serif;
  color: var(--ink, #1c2a3a);
  opacity: 1; transition: opacity .35s ease;
}
#ss-loader.ss-hide { opacity: 0; pointer-events: none; }

/* Fixed card frame — the slideshow slides inside it, the frame never resizes
   between cards (copy rows reserve two lines via min-height). */
.ss-loader-frame {
  position: relative;
  width: min(560px, 92vw);
  padding: 26px 0 16px;
  background: var(--cream, #fbf3e0);
  border: 3px solid var(--ink, #1c2a3a); border-radius: 22px;
  box-shadow: 0 4px 0 var(--ink, #1c2a3a);
  overflow: hidden;
}

.ss-loader-track {
  display: flex; align-items: stretch;
  transition: transform .45s cubic-bezier(.25, .8, .3, 1);
}
.ss-loader-slide {
  flex: 0 0 100%; min-width: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; gap: 13px;
  padding: 0 34px;
  opacity: 0; transition: opacity .45s ease;   /* slide + fade */
}
.ss-loader-slide.ss-cur { opacity: 1; }

.ss-loader-head {
  font-size: 17px; font-weight: 800; letter-spacing: .05em;
  color: var(--ink, #1c2a3a);
}

.ss-loader-demo { width: min(320px, 70vw); height: auto; display: block; }
#ss-loader svg text { font-family: inherit; font-weight: 800; }

.ss-loader-copy {
  font-size: 13.5px; font-weight: 600; line-height: 1.4;
  color: var(--ink-soft, #476278);
  text-align: center; max-width: 40ch; min-height: 2.8em;
}
.ss-pa { color: ${BLUE}; font-weight: 800; }   /* player A / blue */
.ss-pb { color: ${RED}; font-weight: 800; }    /* player B / red  */

/* skip pill, top-right of the card */
#skip-loader {
  position: absolute; top: 12px; right: 12px; z-index: 5;
  font-family: inherit; font-size: 12px; font-weight: 800; letter-spacing: .04em;
  padding: 5px 14px; border-radius: 999px; cursor: pointer;
  color: var(--ink, #1c2a3a); background: var(--cream, #fbf3e0);
  border: 3px solid var(--ink, #1c2a3a);
  box-shadow: 0 3px 0 var(--ink, #1c2a3a);
}
#skip-loader:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--ink, #1c2a3a); }

/* dot indicator */
.ss-loader-dots { display: flex; gap: 9px; justify-content: center; padding-top: 14px; }
.ss-loader-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--cream-deep, #ecdcb1);
  border: 2px solid var(--ink, #1c2a3a);
  transition: background .25s ease, transform .25s ease;
}
.ss-loader-dot.ss-cur { background: var(--hot, #ee7b52); transform: scale(1.2); }

/* responsive re-layout: phone / laptop / big screen */
@media (max-width: 430px) {
  .ss-loader-frame { width: 94vw; padding: 20px 0 12px; }
  .ss-loader-slide { padding: 0 18px; gap: 10px; }
  .ss-loader-head  { font-size: 15px; }
  .ss-loader-copy  { font-size: 12.5px; }
  #skip-loader     { top: 8px; right: 8px; font-size: 11px; padding: 4px 11px; }
}
@media (min-width: 1800px) {
  .ss-loader-frame { width: 640px; }
  .ss-loader-demo  { width: 380px; }
  .ss-loader-head  { font-size: 19px; }
  .ss-loader-copy  { font-size: 15px; }
}

/* palette classes for the SVG scenes */
#ss-loader .lc { fill: var(--cream, #fbf3e0); }
#ss-loader .li { fill: var(--ink, #1c2a3a); }
#ss-loader .lg { fill: var(--gold, #f4c95d); }
#ss-loader .lh { fill: var(--hot, #ff9663); }
#ss-loader .ln { fill: none; }
#ss-loader .si { stroke: var(--ink, #1c2a3a); stroke-width: 3; stroke-linecap: round; }
#ss-loader .ss-l-jab-trail, #ss-loader .ss-l-pp-lines,
#ss-loader .ss-l-signal, #ss-loader .ss-l-swing-trail,
#ss-loader .ss-l-slash-trail { stroke: #fffdf5; }

/* mascot idle: gentle bob + blink */
.ss-l-bob { animation: ss-l-bob 1.6s ease-in-out infinite alternate; }
@keyframes ss-l-bob { from { transform: translateY(1.5px); } to { transform: translateY(-1.5px); } }
.ss-l-eyes { animation: ss-l-blink 3.2s linear infinite; }
@keyframes ss-l-blink {
  0%, 91%, 100% { transform: scaleY(1); }
  94%, 97%      { transform: scaleY(0.08); }
}

/* card 1 — pairing: blue A waves + locks, then red B waves + locks (3.2s) */
.ss-l-bandA { animation: ss-l-bandA 3.2s ease-in-out infinite; }
@keyframes ss-l-bandA {
  0%, 3%    { transform: rotate(0deg); }
  8%        { transform: rotate(-14deg); }
  13%       { transform: rotate(14deg); }
  18%       { transform: rotate(-14deg); }
  23%       { transform: rotate(10deg); }
  28%, 100% { transform: rotate(0deg); }
}
.ss-l-lockA { animation: ss-l-lockA 3.2s ease-out infinite; }
@keyframes ss-l-lockA {
  0%, 28%  { opacity: 0; transform: scale(.4); }
  33%      { opacity: 1; transform: scale(1.18); }
  37%      { transform: scale(1); }
  94%      { opacity: 1; transform: scale(1); }
  100%     { opacity: 0; transform: scale(1); }
}
.ss-l-bandB { animation: ss-l-bandB 3.2s ease-in-out infinite; }
@keyframes ss-l-bandB {
  0%, 42%   { transform: rotate(0deg); }
  47%       { transform: rotate(-14deg); }
  52%       { transform: rotate(14deg); }
  57%       { transform: rotate(-14deg); }
  62%       { transform: rotate(10deg); }
  67%, 100% { transform: rotate(0deg); }
}
.ss-l-lockB { animation: ss-l-lockB 3.2s ease-out infinite; }
@keyframes ss-l-lockB {
  0%, 67%  { opacity: 0; transform: scale(.4); }
  72%      { opacity: 1; transform: scale(1.18); }
  76%      { transform: scale(1); }
  94%      { opacity: 1; transform: scale(1); }
  100%     { opacity: 0; transform: scale(1); }
}

/* card 3 — scores tick up in alternation: A, B, A (4s loop) */
.ss-l-sA0 { animation: ss-l-sA0 4s linear infinite; }
@keyframes ss-l-sA0 { 0%, 24% { opacity: 1; } 25%, 100% { opacity: 0; } }
.ss-l-sA1 { animation: ss-l-sA1 4s linear infinite; }
@keyframes ss-l-sA1 { 0%, 24% { opacity: 0; } 25%, 74% { opacity: 1; } 75%, 100% { opacity: 0; } }
.ss-l-sA2 { animation: ss-l-sA2 4s linear infinite; }
@keyframes ss-l-sA2 { 0%, 74% { opacity: 0; } 75%, 100% { opacity: 1; } }
.ss-l-sB0 { animation: ss-l-sB0 4s linear infinite; }
@keyframes ss-l-sB0 { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.ss-l-sB1 { animation: ss-l-sB1 4s linear infinite; }
@keyframes ss-l-sB1 { 0%, 49% { opacity: 0; } 50%, 100% { opacity: 1; } }

/* boxing: jab forward-and-down, snap back */
.ss-l-jab { animation: ss-l-jab 1.6s ease-in-out infinite; }
@keyframes ss-l-jab {
  0%, 8%    { transform: translate(0,0) rotate(0deg); }
  20%, 34%  { transform: translate(30px,8px) rotate(10deg); }
  52%, 100% { transform: translate(0,0) rotate(0deg); }
}
.ss-l-jab-trail { animation: ss-l-jab-trail 1.6s ease-out infinite; }
@keyframes ss-l-jab-trail {
  0%, 12%   { opacity: 0; transform: translateX(-8px); }
  22%, 36%  { opacity: 1; transform: translateX(6px); }
  50%, 100% { opacity: 0; transform: translateX(10px); }
}

/* bowling: wind back, underhand swing, release */
.ss-l-bowl-arm { animation: ss-l-bowl-arm 1.6s ease-in-out infinite; }
@keyframes ss-l-bowl-arm {
  0%, 12%   { transform: rotate(58deg); }
  34%, 58%  { transform: rotate(-52deg); }
  82%, 100% { transform: rotate(58deg); }
}
.ss-l-bowl-held { animation: ss-l-bowl-held 1.6s linear infinite; }
@keyframes ss-l-bowl-held {
  0%, 32%  { opacity: 1; }
  34%, 82% { opacity: 0; }
  84%, 100% { opacity: 1; }
}
.ss-l-bowl-ball { animation: ss-l-bowl-ball 1.6s linear infinite; }
@keyframes ss-l-bowl-ball {
  0%, 32%    { opacity: 0; transform: translate(0,0); }
  36%        { opacity: 1; }
  56%        { opacity: 1; transform: translate(72px,20px); }
  62%, 100%  { opacity: 0; transform: translate(72px,20px); }
}

/* tennis: forehand sweep across the body */
.ss-l-tennis { animation: ss-l-tennis 1.6s ease-in-out infinite; }
@keyframes ss-l-tennis {
  0%, 12%   { transform: rotate(-72deg); }
  30%, 46%  { transform: rotate(62deg); }
  70%, 100% { transform: rotate(-72deg); }
}
.ss-l-swing-trail { animation: ss-l-trail 1.6s ease-out infinite; }
@keyframes ss-l-trail {
  0%, 12%   { opacity: 0; }
  20%, 34%  { opacity: .9; }
  48%, 100% { opacity: 0; }
}

/* badminton: same sweep, taller arc */
.ss-l-badminton { animation: ss-l-badminton 1.6s ease-in-out infinite; }
@keyframes ss-l-badminton {
  0%, 10%   { transform: rotate(-96deg); }
  28%, 42%  { transform: rotate(80deg); }
  68%, 100% { transform: rotate(-96deg); }
}
.ss-l-shuttle { animation: ss-l-shuttle 1.6s linear infinite; }
@keyframes ss-l-shuttle {
  0%, 26%   { opacity: 0; transform: translate(0,0); }
  32%       { opacity: 1; transform: translate(10px,-6px); }
  52%       { transform: translate(46px,-22px); }   /* glide to peak */
  58%       { transform: translate(52px,-18px); }
  74%       { transform: translate(62px,72px); }    /* sharp drop */
  76%, 100% { opacity: 0; transform: translate(62px,72px); }
}

/* pingpong: two quick flicks per loop */
.ss-l-pp { animation: ss-l-pp 1.6s ease-in-out infinite; }
@keyframes ss-l-pp {
  0%, 4%   { transform: rotate(10deg); }
  14%      { transform: rotate(64deg); }
  30%      { transform: rotate(10deg); }
  50%, 54% { transform: rotate(10deg); }
  64%      { transform: rotate(64deg); }
  80%, 100%{ transform: rotate(10deg); }
}
.ss-l-pp-lines { animation: ss-l-pp-lines 1.6s linear infinite; }
@keyframes ss-l-pp-lines {
  0%, 10%   { opacity: 0; }
  14%, 20%  { opacity: 1; }
  28%, 60%  { opacity: 0; }
  64%, 70%  { opacity: 1; }
  78%, 100% { opacity: 0; }
}

/* ninja: vertical blade slash, left-to-right */
.ss-l-ninja { animation: ss-l-ninja 1.6s ease-in-out infinite; }
@keyframes ss-l-ninja {
  0%, 14%   { transform: rotate(-52deg); }
  30%, 48%  { transform: rotate(52deg); }
  72%, 100% { transform: rotate(-52deg); }
}
.ss-l-slash-trail { animation: ss-l-slash-trail 1.6s ease-out infinite; }
@keyframes ss-l-slash-trail {
  0%, 14%   { opacity: 0; }
  20%, 36%  { opacity: .95; }
  52%, 100% { opacity: 0; }
}

/* generic: friendly wristband wave + radio arcs */
.ss-l-wave { animation: ss-l-wave 1.6s ease-in-out infinite; }
@keyframes ss-l-wave {
  0%, 100% { transform: rotate(4deg); }
  50%      { transform: rotate(40deg); }
}
.ss-l-signal { animation: ss-l-signal 1.6s linear infinite; }
@keyframes ss-l-signal {
  0%, 20%   { opacity: 0; }
  35%, 65%  { opacity: .9; }
  80%, 100% { opacity: 0; }
}`;

export function showLoader({ game, tips = [] } = {}) {
  void tips; // legacy param — accepted but ignored (structured cards now)
  if (document.getElementById('ss-loader')) return;

  const key = SCENES[game] ? game : 'generic';

  const style = document.createElement('style');
  style.id = 'ss-loader-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const slides = [
    { head: 'how to play',
      svg:  scene(`${key} gesture demo`, 'play', [64], SCENES[key]),
      copy: PLAY_COPY[key] },
    { head: 'how to win',
      svg:  scene('scoring demo — blue A vs red B', 'win', [70, 170], WIN_INNER),
      copy: WIN_COPY[key] },
  ];

  const el = document.createElement('div');
  el.id = 'ss-loader';
  el.innerHTML = `
    <div class="ss-loader-frame">
      <button id="skip-loader" type="button">skip →</button>
      <div class="ss-loader-track">
        ${slides.map(s => `
        <div class="ss-loader-slide">
          <div class="ss-loader-head">${s.head}</div>
          ${s.svg}
          <div class="ss-loader-copy">${s.copy}</div>
        </div>`).join('')}
      </div>
      <div class="ss-loader-dots">
        ${slides.map(() => `<span class="ss-loader-dot"></span>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(el);

  const track    = el.querySelector('.ss-loader-track');
  const slideEls = [...el.querySelectorAll('.ss-loader-slide')];
  const dotEls   = [...el.querySelectorAll('.ss-loader-dot')];

  let idx = 0;
  const setCard = (i) => {
    idx = i;
    // Percentage translate — re-layout on window resize is automatic.
    track.style.transform = `translateX(${-100 * i}%)`;
    slideEls.forEach((s, j) => s.classList.toggle('ss-cur', j === i));
    dotEls.forEach((d, j) => d.classList.toggle('ss-cur', j === i));
  };
  setCard(0);

  // Auto-advance every DWELL_MS; modulo wrap loops the deck back to Card 1
  // if the game still isn't ready after a full pass.
  const advTimer = setInterval(() => setCard((idx + 1) % CARDS), DWELL_MS);

  // Hold at least MIN_MS (one full pass). After that, hide as soon as
  // body.game-active is set (or immediately if it already was). Hard cap at
  // MAX_MS. Skip pill hides immediately, never blocking gameplay.
  let hidden = false;
  let minDone = false;
  let ready = document.body.classList.contains('game-active');

  const hide = () => {
    if (hidden) return;
    hidden = true;
    clearInterval(advTimer);
    clearTimeout(minTimer);
    clearTimeout(maxTimer);
    obs.disconnect();
    el.classList.add('ss-hide');
    setTimeout(() => { el.remove(); style.remove(); }, 400);
  };
  const tryHide = () => { if (minDone && ready) hide(); };

  el.querySelector('#skip-loader').addEventListener('click', hide);

  const obs = new MutationObserver(() => {
    if (document.body.classList.contains('game-active')) { ready = true; tryHide(); }
  });
  obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  const minTimer = setTimeout(() => { minDone = true; tryHide(); }, MIN_MS);
  const maxTimer = setTimeout(hide, MAX_MS);
}
