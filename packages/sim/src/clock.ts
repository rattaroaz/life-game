/**
 * Clock Contract (design doc):
 * - 1 tick = 1 game minute
 * - 1× speed = 1 tick per real second
 * - GAME_DAY_TICKS = 1440
 */

export const TICK_GAME_MINUTES = 1;
export const BASE_TICKS_PER_REAL_SECOND = 1;
export const GAME_DAY_TICKS = 1440;
export const GAME_WEEK_DAYS = 7;

export type ClockSpeed = 0 | 1 | 2 | 3;

export type ClockState = {
  /** Absolute sim ticks since new game */
  tick: number;
  /** 0..1439 within current day */
  minuteOfDay: number;
  /** 0=Mon … 6=Sun */
  dayOfWeek: number;
  /** Total game days elapsed */
  dayNumber: number;
  speed: ClockSpeed;
  paused: boolean;
};

export function createClock(startMinute = 8 * 60): ClockState {
  return {
    tick: 0,
    minuteOfDay: startMinute % GAME_DAY_TICKS,
    dayOfWeek: 0,
    dayNumber: 0,
    speed: 1,
    paused: false,
  };
}

export function advanceClock(clock: ClockState, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    clock.tick += 1;
    clock.minuteOfDay = (clock.minuteOfDay + TICK_GAME_MINUTES) % GAME_DAY_TICKS;
    if (clock.minuteOfDay === 0) {
      clock.dayNumber += 1;
      clock.dayOfWeek = (clock.dayOfWeek + 1) % GAME_WEEK_DAYS;
    }
  }
}

export function isWeekend(clock: ClockState): boolean {
  return clock.dayOfWeek >= 5;
}

export function formatClock(clock: ClockState): string {
  const h = Math.floor(clock.minuteOfDay / 60);
  const m = clock.minuteOfDay % 60;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return `${days[clock.dayOfWeek]} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Daylight factor 0..1 for lighting tint */
export function daylightFactor(minuteOfDay: number): number {
  // Night 0-6, dawn 6-8, day 8-18, dusk 18-20, night 20-24
  const h = minuteOfDay / 60;
  if (h < 5) return 0.15;
  if (h < 7) return 0.15 + ((h - 5) / 2) * 0.55;
  if (h < 18) return 0.7 + Math.sin(((h - 7) / 11) * Math.PI) * 0.3;
  if (h < 20) return 0.7 - ((h - 18) / 2) * 0.55;
  return 0.15;
}
