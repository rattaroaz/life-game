import { describe, expect, it } from 'vitest';
import {
  advanceClock,
  BASE_TICKS_PER_REAL_SECOND,
  createClock,
  daylightFactor,
  formatClock,
  GAME_DAY_TICKS,
  isWeekend,
  TICK_GAME_MINUTES,
} from './clock.js';

describe('Clock Contract', () => {
  it('advances one game minute per tick', () => {
    const c = createClock(0);
    advanceClock(c, 1);
    expect(c.tick).toBe(1);
    expect(c.minuteOfDay).toBe(1);
    expect(TICK_GAME_MINUTES).toBe(1);
    // 1× is 6 game-min/s (2× the old 3× rate of 3/s)
    expect(BASE_TICKS_PER_REAL_SECOND).toBe(6);
  });

  it('rolls day at 1440 minutes', () => {
    const c = createClock(GAME_DAY_TICKS - 1);
    advanceClock(c, 1);
    expect(c.minuteOfDay).toBe(0);
    expect(c.dayNumber).toBe(1);
    expect(c.dayOfWeek).toBe(1);
  });

  it('rolls week after 7 days', () => {
    const c = createClock(0);
    advanceClock(c, GAME_DAY_TICKS * 7);
    expect(c.dayNumber).toBe(7);
    expect(c.dayOfWeek).toBe(0);
  });

  it('isWeekend for Sat/Sun', () => {
    const c = createClock(0);
    expect(isWeekend(c)).toBe(false); // Mon
    c.dayOfWeek = 5;
    expect(isWeekend(c)).toBe(true);
    c.dayOfWeek = 6;
    expect(isWeekend(c)).toBe(true);
  });

  it('formatClock is stable', () => {
    const c = createClock(8 * 60 + 5);
    expect(formatClock(c)).toMatch(/^Mon 08:05$/);
  });

  it('daylightFactor is low at night and higher midday', () => {
    const night = daylightFactor(2 * 60);
    const noon = daylightFactor(12 * 60);
    expect(noon).toBeGreaterThan(night);
    expect(night).toBeGreaterThan(0);
    expect(noon).toBeLessThanOrEqual(1);
  });

  it('createClock defaults to 8:00', () => {
    const c = createClock();
    expect(c.minuteOfDay).toBe(8 * 60);
    expect(c.speed).toBe(1);
    expect(c.paused).toBe(false);
  });
});
