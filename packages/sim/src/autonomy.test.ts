import { describe, expect, it } from 'vitest';
import { systemAutonomy } from './autonomy.js';
import { runSimTick } from './systems.js';
import { minimalContent, makeTestWorld, spawnTestPair } from './test/fixtures.js';
import { getSim } from './world.js';

describe('self-sufficient autonomy', () => {
  it('queues care actions when needy without player input', () => {
    const content = minimalContent();
    const world = makeTestWorld(42);
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.needs.hunger = 15;
    sim.needs.bladder = 80;
    sim.needs.energy = 80;
    sim.autonomy.nextPlanTick = 0;
    sim.autonomy.cooldownUntil = 0;
    sim.action = { kind: 'idle' };
    sim.queue.items = [];
    world.mode = 'live';
    world.clock.paused = false;
    world.clock.speed = 1;

    systemAutonomy(world, content);
    expect(sim.queue.items.length).toBeGreaterThan(0);
    // Should prefer hunger fix when critical
    expect(sim.queue.items[0]!.interactionId).toMatch(/fridge|snack|meal|cook|eat/i);
  });

  it('keeps average needs out of free-fall over a long hands-off run', () => {
    const content = minimalContent();
    const world = makeTestWorld(99);
    const { simA, simB } = spawnTestPair(world, content);
    // Start mid-needs so decay + AI both matter
    for (const id of [simA, simB]) {
      const s = getSim(world, id)!;
      s.needs = {
        hunger: 50,
        energy: 50,
        bladder: 50,
        hygiene: 50,
        fun: 50,
        social: 50,
      };
      s.autonomy.nextPlanTick = 0;
      s.career.trackId = 'career.office_worker';
    }

    world.mode = 'live';
    world.clock.paused = false;
    world.clock.speed = 1;

    let criticalTicks = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      runSimTick(world, content);
      for (const id of [simA, simB]) {
        const s = getSim(world, id)!;
        if (s.presence !== 'on_lot') continue;
        const avg =
          (s.needs.hunger +
            s.needs.energy +
            s.needs.bladder +
            s.needs.hygiene +
            s.needs.fun +
            s.needs.social) /
          6;
        if (avg < 15) criticalTicks++;
      }
    }

    // Should not spend most of the session in free-fall
    expect(criticalTicks).toBeLessThan(N * 0.35);

    // Still alive with finite needs
    for (const id of [simA, simB]) {
      const s = getSim(world, id)!;
      for (const v of Object.values(s.needs)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('auto-joins a career when unemployed after a short life', () => {
    const content = minimalContent();
    const world = makeTestWorld(7);
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.career.trackId = null;
    world.clock.tick = 40;
    sim.autonomy.nextPlanTick = 0;
    sim.action = { kind: 'idle' };
    sim.queue.items = [];
    world.mode = 'live';
    world.clock.paused = false;
    world.clock.speed = 1;
    systemAutonomy(world, content);
    expect(sim.career.trackId).not.toBeNull();
  });

  it('never passes out — seeks rest when energy collapses', () => {
    const content = minimalContent();
    const world = makeTestWorld(11);
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.needs.energy = 0;
    sim.needs.hunger = 70;
    sim.needs.bladder = 70;
    sim.action = { kind: 'idle' };
    sim.queue.items = [];
    sim.autonomy.nextPlanTick = 0;
    sim.autonomy.cooldownUntil = 0;
    world.mode = 'live';
    world.clock.paused = false;
    world.clock.speed = 1;

    for (let i = 0; i < 6; i++) runSimTick(world, content);

    expect(sim.anim.clip).not.toBe('pass_out');
    expect(sim.needs.energy).toBeGreaterThan(0);
    const resting =
      sim.queue.items.some((q) => /sleep|bed/i.test(q.interactionId)) ||
      (sim.action.kind === 'pathing' && /sleep/i.test(sim.action.interactionId)) ||
      (sim.action.kind === 'performing' && /sleep/i.test(sim.action.interactionId)) ||
      (sim.action.kind === 'pending' && /sleep/i.test(sim.action.interactionId));
    expect(resting).toBe(true);
  });
});
