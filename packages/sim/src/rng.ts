/** Mulberry32 PRNG — full state is persisted in saves. */

export type RngState = {
  seed: number;
  state: number;
};

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0, state: seed >>> 0 };
}

export function nextRng(rng: RngState): number {
  let t = (rng.state += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rngRange(rng: RngState, min: number, max: number): number {
  return min + nextRng(rng) * (max - min);
}

export function rngInt(rng: RngState, min: number, maxInclusive: number): number {
  return Math.floor(rngRange(rng, min, maxInclusive + 1));
}
