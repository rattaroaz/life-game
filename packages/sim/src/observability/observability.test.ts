import { describe, expect, it, beforeEach } from 'vitest';
import { initObs, resetObsForTests, getObs } from './hub.js';
import { RingBuffer } from './ringBuffer.js';
import { Histogram, MetricsRegistry } from './metrics.js';

describe('RingBuffer', () => {
  it('keeps newest items within capacity', () => {
    const b = new RingBuffer<number>(3);
    b.push(1);
    b.push(2);
    b.push(3);
    b.push(4);
    expect(b.toArray()).toEqual([2, 3, 4]);
    expect(b.recent(2)).toEqual([4, 3]);
  });
});

describe('Histogram', () => {
  it('computes percentiles', () => {
    const h = new Histogram('t');
    for (let i = 1; i <= 100; i++) h.observe(i);
    const s = h.snapshot();
    expect(s.count).toBe(100);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.p50).toBeGreaterThanOrEqual(50);
    expect(s.p95).toBeGreaterThanOrEqual(95);
  });
});

describe('MetricsRegistry', () => {
  it('tracks counters and gauges', () => {
    const m = new MetricsRegistry();
    m.inc('a', 2);
    m.inc('a', 3);
    m.set('g', 10);
    m.observe('h', 1);
    m.observe('h', 3);
    const snap = m.snapshot();
    expect(snap.find((x) => x.name === 'a')?.value).toBe(5);
    expect(snap.find((x) => x.name === 'g')?.value).toBe(10);
    expect(snap.find((x) => x.name === 'h')?.histogram?.avg).toBe(2);
  });
});

describe('ObservabilityHub', () => {
  beforeEach(() => {
    resetObsForTests();
    initObs({ console: false, minLevel: 'trace', traceSampleRate: 1 });
  });

  it('records logs, events, and tick timing', () => {
    const obs = getObs();
    obs.logger.info('sim', 'hello', { n: 1 });
    obs.event('test.event', 'sim', { ok: true });
    const span = obs.beginSimTick(42);
    obs.recordSystemTime('Mood', 0.5);
    obs.recordSystemTime('Path', 1.2);
    obs.endSimTick(span, { sims: 2, objects: 10, relationships: 1 });
    obs.notePathResult(true);
    obs.notePathResult(false);
    obs.noteActionResult(true);
    obs.noteAutonomyPick({ simId: 1 });

    const snap = obs.snapshot();
    expect(snap.sim.tick).toBe(42);
    expect(snap.sim.entityCounts.sims).toBe(2);
    expect(snap.sim.pathFails).toBe(1);
    expect(snap.sim.pathSuccess).toBe(1);
    expect(snap.sim.autonomyPicks).toBe(1);
    expect(snap.recentLogs.some((l) => l.message === 'hello')).toBe(true);
    expect(snap.recentEvents.some((e) => e.type === 'test.event')).toBe(true);
    expect(snap.sim.lastTickMs).toBeGreaterThanOrEqual(0);
    expect(obs.exportJson()).toContain(obs.sessionId);
  });

  it('respects min log level', () => {
    const obs = getObs();
    obs.setMinLevel('warn');
    const before = obs.logger.buffer.size;
    obs.logger.debug('sim', 'hidden');
    obs.logger.warn('sim', 'shown');
    const logs = obs.logger.buffer.toArray().slice(before);
    expect(logs.some((l) => l.message === 'hidden')).toBe(false);
    expect(logs.some((l) => l.message === 'shown')).toBe(true);
  });
});
