// Deterministic PRNG (mulberry32). The state lives in SimState.rng so a cloned
// state replays exactly the same way.

export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function seeded(seed: number) {
  const s = { rng: seed | 0 };
  return {
    next: () => nextRandom(s),
    range: (a: number, b: number) => a + (b - a) * nextRandom(s),
    int: (a: number, b: number) => Math.floor(a + (b - a + 1) * nextRandom(s)),
    pick: <T,>(arr: T[]) => arr[Math.floor(nextRandom(s) * arr.length)],
    chance: (p: number) => nextRandom(s) < p,
  };
}

const PLATE_LETTERS = "ABCDEFGHJKLMNPRSTVWXYZ";

/** Synthetic test plates: always prefixed with "T" (test series) so they cannot match a real record format. */
export function syntheticPlate(r: () => number): string {
  const l = () => PLATE_LETTERS[Math.floor(r() * PLATE_LETTERS.length)];
  const d = () => Math.floor(r() * 10);
  return `T${l()}${l()} ${d()}${d()}${d()}`;
}
