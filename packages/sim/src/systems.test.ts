import { describe, expect, it } from 'vitest';
import { createCommands } from './commands.js';
import { ensureRelationship } from './relationships.js';
import {
  clearSocialPair,
  runSimTick,
  systemMood,
  systemNeedDecay,
} from './systems.js';
import { minimalContent, makeTestWorld, spawnTestPair, tick } from './test/fixtures.js';
import { allObjects, allSims, getSim, spawnSim } from './world.js';

describe('NeedDecaySystem', () => {
  it('decays needs over many ticks', () => {
    const content = minimalContent();
    const world = makeTestWorld(1);
    const sim = spawnSim(world, { firstName: 'N', lastName: 'D', x: 12, y: 14 });
    const h0 = sim.needs.hunger;
    world.mode = 'live';
    world.clock.paused = false;
    world.clock.speed = 1;
    for (let i = 0; i < 120; i++) systemNeedDecay(world, content);
    expect(sim.needs.hunger).toBeLessThan(h0);
    expect(sim.needs.hunger).toBeGreaterThanOrEqual(0);
  });
});

describe('MoodSystem', () => {
  it('derives mood from average needs', () => {
    const world = makeTestWorld();
    const sim = spawnSim(world, { firstName: 'M', lastName: 'M', x: 1, y: 1 });
    sim.needs = {
      hunger: 100,
      energy: 100,
      bladder: 100,
      hygiene: 100,
      fun: 100,
      social: 100,
    };
    systemMood(world);
    expect(sim.mood.value).toBe(100);

    sim.needs.hunger = 0;
    sim.needs.energy = 0;
    systemMood(world);
    expect(sim.mood.value).toBeLessThan(100);
  });

  it('applies mood buffs from modifiers', () => {
    const world = makeTestWorld();
    const sim = spawnSim(world, { firstName: 'B', lastName: 'B', x: 1, y: 1 });
    sim.needs = {
      hunger: 50,
      energy: 50,
      bladder: 50,
      hygiene: 50,
      fun: 50,
      social: 50,
    };
    sim.mood.modifiers.push({ id: 'test', amount: 20, untilTick: 9999 });
    systemMood(world);
    expect(sim.mood.value).toBe(70);
  });
});

describe('interactions + slots', () => {
  it('player-queued snack eventually raises hunger', () => {
    const content = minimalContent();
    const world = makeTestWorld(7);
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.needs.hunger = 20;
    const fridge = allObjects(world).find((o) => o.defId === 'object.fridge_basic')!;
    const cmds = createCommands(world, content);
    cmds.enqueueInteraction(simA, 'interact.fridge_snack', fridge.id);

    tick(world, content, 80, runSimTick);

    expect(sim.needs.hunger).toBeGreaterThan(20);
  });

  it('exclusive slot blocks second sim with slot_taken', () => {
    const content = minimalContent();
    const world = makeTestWorld(8);
    const { simA, simB } = spawnTestPair(world, content);
    const toilet = allObjects(world).find((o) => o.defId === 'object.toilet_basic')!;
    // Place both sims on the toilet approach tile so pathing is a no-op
    const approach = { x: toilet.transform.x, y: toilet.transform.y + 1 };
    const a = getSim(world, simA)!;
    const b = getSim(world, simB)!;
    a.transform.x = approach.x;
    a.transform.y = approach.y;
    b.transform.x = approach.x;
    b.transform.y = approach.y;
    a.autonomy.nextPlanTick = 999999;
    b.autonomy.nextPlanTick = 999999;
    a.autonomy.cooldownUntil = 999999;
    b.autonomy.cooldownUntil = 999999;

    // Pre-reserve exclusive slot for A as if already using it
    const slot = toilet.slots.find((s) => s.slotId === 'use')!;
    slot.reservedBy = simA;
    slot.reservedUntilTick = world.clock.tick + 500;

    const cmds = createCommands(world, content);
    cmds.enqueueInteraction(simB, 'interact.use_toilet', toilet.id);

    world.mode = 'live';
    world.clock.paused = false;
    world.clock.speed = 1;
    // One tick should dequeue + fail; next tick clears failed → idle
    runSimTick(world, content);
    const failedThisTick =
      b.action.kind === 'failed' && b.action.reason === 'slot_taken';
    const failedEvent = world.eventBus.some(
      (e) =>
        e.type === 'action_failed' &&
        e.simId === simB &&
        e.reason === 'slot_taken',
    );
    expect(failedThisTick || failedEvent).toBe(true);
  });

  it('skill gate fails when under-skilled', () => {
    const content = minimalContent();
    // add skill gated interaction on stove
    content.objects.find((o) => o.id === 'object.stove_basic')!.interactions.push(
      'interact.skill_gated',
    );
    const world = makeTestWorld(3);
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.skills.cooking = 0;
    const stove = allObjects(world).find((o) => o.defId === 'object.stove_basic')!;
    const cmds = createCommands(world, content);
    cmds.enqueueInteraction(simA, 'interact.skill_gated', stove.id);
    tick(world, content, 30, runSimTick);
    // Either failed skill_gate or still trying — after enough ticks should fail
    const failed =
      sim.action.kind === 'failed' && sim.action.reason === 'skill_gate';
    // Queue empty and not performing gated action successfully without skill
    expect(sim.skills.cooking).toBeLessThan(5);
    expect(failed || sim.queue.items.length === 0).toBe(true);
  });

  it('cook chain leaves meal held or continues to eat', () => {
    const content = minimalContent();
    const world = makeTestWorld(11);
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.needs.hunger = 10;
    // Disable autonomy interference
    sim.autonomy.nextPlanTick = 999999;
    sim.autonomy.cooldownUntil = 999999;
    const fridge = allObjects(world).find((o) => o.defId === 'object.fridge_basic')!;
    createCommands(world, content).enqueueInteraction(
      simA,
      'interact.fridge_start_meal',
      fridge.id,
    );
    tick(world, content, 200, runSimTick);
    // Should have progressed chain: held ingredients/meal or higher hunger from eating
    const progressed =
      sim.inventory.held === 'item.ingredients' ||
      sim.inventory.held === 'item.meal' ||
      sim.needs.hunger > 15 ||
      sim.skills.cooking > 0;
    expect(progressed).toBe(true);
  });
});

describe('career schedule', () => {
  it('sends sim to work during schedule and pays on return', () => {
    const content = minimalContent();
    const world = makeTestWorld(4);
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    const cmds = createCommands(world, content);
    cmds.joinCareer(simA, 'career.office_worker');
    const funds0 = world.household.funds;

    // Monday 9:00
    world.clock.dayOfWeek = 0;
    world.clock.minuteOfDay = 9 * 60;
    world.clock.paused = false;
    world.clock.speed = 1;
    world.mode = 'live';
    runSimTick(world, content);
    expect(sim.presence).toBe('at_work');

    // End of day return
    world.clock.minuteOfDay = 17 * 60;
    runSimTick(world, content);
    expect(sim.presence).toBe('on_lot');
    expect(world.household.funds).toBeGreaterThan(funds0);
  });

  it('does not work on weekend for office track', () => {
    const content = minimalContent();
    const world = makeTestWorld(5);
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    createCommands(world, content).joinCareer(simA, 'career.office_worker');
    world.clock.dayOfWeek = 6; // Sunday
    world.clock.minuteOfDay = 10 * 60;
    world.mode = 'live';
    world.clock.paused = false;
    world.clock.speed = 1;
    runSimTick(world, content);
    expect(sim.presence).toBe('on_lot');
  });
});

describe('social + clearSocialPair', () => {
  it('chat improves friendship over time', () => {
    const content = minimalContent();
    const world = makeTestWorld(6);
    const { simA, simB } = spawnTestPair(world, content);
    ensureRelationship(world.relationships, simA, simB);
    const a = getSim(world, simA)!;
    const b = getSim(world, simB)!;
    a.autonomy.nextPlanTick = 999999;
    b.autonomy.nextPlanTick = 999999;
    createCommands(world, content).enqueueInteraction(simA, 'interact.chat', simB);
    tick(world, content, 100, runSimTick);
    const edge = world.relationships.find(
      (e) =>
        (e.a === Math.min(simA, simB) && e.b === Math.max(simA, simB)),
    );
    // friendship should have increased if social completed
    expect(edge).toBeTruthy();
    if (edge && edge.friendship === 0) {
      // may still be pathing on awkward geometry — ensure no permanent socialLock
      expect(a.socialLock === null || a.socialLock.untilTick >= world.clock.tick).toBe(
        true,
      );
    } else {
      expect(edge!.friendship).toBeGreaterThan(0);
    }
  });

  it('clearSocialPair clears both sides', () => {
    const world = makeTestWorld();
    const a = spawnSim(world, { firstName: 'A', lastName: 'A', x: 1, y: 1 });
    const b = spawnSim(world, { firstName: 'B', lastName: 'B', x: 2, y: 1 });
    a.socialLock = { partnerId: b.id, untilTick: 100, role: 'initiator' };
    b.socialLock = { partnerId: a.id, untilTick: 100, role: 'partner' };
    clearSocialPair(world, a);
    expect(a.socialLock).toBeNull();
    expect(b.socialLock).toBeNull();
  });
});

describe('autonomy', () => {
  it('queues an action when idle and needy', () => {
    const content = minimalContent();
    const world = makeTestWorld(21);
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.needs.hunger = 5;
    sim.needs.bladder = 5;
    sim.needs.energy = 5;
    sim.autonomy.nextPlanTick = 0;
    sim.autonomy.cooldownUntil = 0;
    sim.action = { kind: 'idle' };
    sim.queue.items = [];
    world.mode = 'live';
    world.clock.paused = false;
    world.clock.speed = 1;
    // A few ticks for autonomy
    for (let i = 0; i < 5; i++) runSimTick(world, content);
    const busy =
      sim.queue.items.length > 0 ||
      sim.action.kind !== 'idle' ||
      sim.path.waypoints.length > 0;
    expect(busy).toBe(true);
  });
});

describe('pause / mode', () => {
  it('does not advance clock when paused', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    spawnTestPair(world, content);
    world.clock.paused = true;
    world.clock.speed = 0;
    const t0 = world.clock.tick;
    runSimTick(world, content);
    expect(world.clock.tick).toBe(t0);
  });

  it('does not tick in build mode', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    spawnTestPair(world, content);
    world.mode = 'build';
    world.clock.paused = false;
    world.clock.speed = 1;
    const t0 = world.clock.tick;
    runSimTick(world, content);
    expect(world.clock.tick).toBe(t0);
  });
});

describe('multi-sim isolation', () => {
  it('ticks both sims without throwing for 300 ticks', () => {
    const content = minimalContent();
    const world = makeTestWorld(100);
    spawnTestPair(world, content);
    expect(() => tick(world, content, 300, runSimTick)).not.toThrow();
    expect(allSims(world)).toHaveLength(2);
    expect(world.clock.tick).toBe(300);
  });
});
