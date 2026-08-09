import { describe, expect, it } from 'vitest';
import { createRng, nextRng, rngInt, rngRange } from './rng.js';

describe('mulberry32 RNG', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 20 }, () => nextRng(a));
    const seqB = Array.from({ length: 20 }, () => nextRng(b));
    expect(seqA).toEqual(seqB);
  });

  it('diverges for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(nextRng(a)).not.toBe(nextRng(b));
  });

  it('produces values in [0, 1)', () => {
    const r = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = nextRng(r);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('rngRange stays within bounds', () => {
    const r = createRng(7);
    for (let i = 0; i < 200; i++) {
      const v = rngRange(r, 10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  it('rngInt is inclusive on both ends', () => {
    const r = createRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = rngInt(r, 1, 3);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen.has(1) && seen.has(2) && seen.has(3)).toBe(true);
  });

  it('advances state so mid-stream resume needs state not just seed', () => {
    const r = createRng(50);
    nextRng(r);
    nextRng(r);
    const mid = { ...r };
    const next = nextRng(r);
    const resumed = { seed: mid.seed, state: mid.state };
    expect(nextRng(resumed)).toBe(next);
  });
});
