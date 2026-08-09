import { describe, expect, it } from 'vitest';
import { advanceClock, createClock, GAME_DAY_TICKS } from './clock.js';

describe('Clock Contract', () => {
  it('advances one game minute per tick', () => {
    const c = createClock(0);
    advanceClock(c, 1);
    expect(c.tick).toBe(1);
    expect(c.minuteOfDay).toBe(1);
  });

  it('rolls day at 1440 minutes', () => {
    const c = createClock(GAME_DAY_TICKS - 1);
    advanceClock(c, 1);
    expect(c.minuteOfDay).toBe(0);
    expect(c.dayNumber).toBe(1);
    expect(c.dayOfWeek).toBe(1);
  });
});
