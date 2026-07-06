// Player-slot pairing for two wristbands.
//
// The firmware stamps each sample with an armId (0 or 1). We assign the first
// armId that shakes to slot A, the second to slot B. Games read the mapping
// (playerForArm / armForPlayer) so they can route input by player, not arm.
//
// State survives page navigation via sessionStorage, so the menu's pairing
// carries into each game without re-doing it.

// v2: arm_ids are now MAC-derived (any 16-bit int), not just 0/1. Bumping the
// key invalidates any cached slot assignments from the old scheme.
const STORE_KEY = 'soup-games-pairing-v2';

// A sample counts as "movement" once its non-gravity acceleration exceeds
// this. Idle noise is ~1-2 m/s²; a small wrist wave is well over 10.
const SHAKE_THRESHOLD = 12.0;
const G = 9.80665;

function loadPersisted() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return { A: null, B: null };
    const p = JSON.parse(raw);
    return {
      A: Number.isInteger(p.A) ? p.A : null,
      B: Number.isInteger(p.B) ? p.B : null,
    };
  } catch { return { A: null, B: null }; }
}

function persist(slots) {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(slots)); } catch {}
}

export class Pairing {
  constructor() {
    this.slots = loadPersisted();
    this.stats = new Map();   // armId -> { lastSeenMs, samples, lastPower, firstSeenMs }
    this.listeners = new Set();
  }

  /** Feed a raw serial line (already trimmed). Handles legacy 9-field lines too. */
  onLine(line) {
    if (!line || line[0] === '#' || line.startsWith('ERR')) return;
    const parts = line.split(',');
    let armId, ax, ay, az;
    if (parts.length === 10) {
      armId = +parts[0]; ax = +parts[2]; ay = +parts[3]; az = +parts[4];
    } else if (parts.length === 9) {
      armId = 0;         ax = +parts[1]; ay = +parts[2]; az = +parts[3];
    } else return;
    if (!Number.isFinite(armId) || !Number.isFinite(ax)) return;

    const nowMs = performance.now();
    const accMag = Math.hypot(ax, ay, az);
    const dynA = Math.abs(accMag - G);

    let st = this.stats.get(armId);
    if (!st) {
      st = { firstSeenMs: nowMs, lastSeenMs: nowMs, samples: 0, lastPower: 0, peakPower: 0 };
      this.stats.set(armId, st);
    }
    st.lastSeenMs = nowMs;
    st.samples++;
    st.lastPower = dynA;
    if (dynA > st.peakPower) st.peakPower = dynA;

    // Auto-assign: first arm to cross the shake threshold wins slot A, next
    // one to shake goes to slot B. Only fires when the target slot is empty.
    if (dynA >= SHAKE_THRESHOLD) {
      const already = this.playerForArm(armId);
      if (!already) {
        if (this.slots.A === null) this.slots.A = armId;
        else if (this.slots.B === null && armId !== this.slots.A) this.slots.B = armId;
        persist(this.slots);
      }
      this._emit();
    } else {
      // Still let listeners refresh activity indicators; they can throttle.
      this._emit();
    }
  }

  /** 'A' | 'B' | null */
  playerForArm(armId) {
    if (this.slots.A === armId) return 'A';
    if (this.slots.B === armId) return 'B';
    return null;
  }

  /** armId | null */
  armForPlayer(letter) {
    return this.slots[letter];
  }

  /** Any arm that has ever been seen but isn't slotted yet. */
  unassignedArms() {
    return [...this.stats.keys()].filter(id => !this.playerForArm(id));
  }

  isConnected(armId, staleMs = 500) {
    const st = this.stats.get(armId);
    return !!st && (performance.now() - st.lastSeenMs) < staleMs;
  }

  /** Called by the UI on user click. */
  swap() {
    const { A, B } = this.slots;
    this.slots.A = B; this.slots.B = A;
    persist(this.slots);
    this._emit();
  }

  reset() {
    this.slots = { A: null, B: null };
    persist(this.slots);
    this._emit();
  }

  /** Manually pin an armId to a slot (menu drag-and-drop style). */
  assign(letter, armId) {
    if (letter !== 'A' && letter !== 'B') return;
    // Kick the arm out of the other slot if it was there.
    const other = letter === 'A' ? 'B' : 'A';
    if (this.slots[other] === armId) this.slots[other] = null;
    this.slots[letter] = armId;
    persist(this.slots);
    this._emit();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) { try { fn(); } catch {} } }
}

// Singleton — one pairing state per page. Games import this same instance.
export const pairing = new Pairing();
