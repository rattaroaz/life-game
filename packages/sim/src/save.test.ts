import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCommands } from './commands.js';
import { nextRng } from './rng.js';
import {
  deserializeWorld,
  listLocalSaves,
  loadFromLocalStorage,
  saveToLocalStorage,
  serializeWorld,
} from './save.js';
import { runSimTick } from './systems.js';
import { minimalContent, makeTestWorld, spawnTestPair, tick } from './test/fixtures.js';
import { allObjects, allSims, getSim } from './world.js';

describe('serialize / deserialize', () => {
  it('round-trips household, entities, clock, and RNG stream state', () => {
    const content = minimalContent();
    const world = makeTestWorld(4242);
    spawnTestPair(world, content);
    tick(world, content, 50, runSimTick);
    nextRng(world.rng);
    nextRng(world.rng);
    const stateAfter = world.rng.state;
    const tickAfter = world.clock.tick;

    const bytes = serializeWorld(world);
    expect(bytes.byteLength).toBeGreaterThan(100);

    const loaded = deserializeWorld(bytes);
    expect(allSims(loaded)).toHaveLength(2);
    expect(allObjects(loaded).length).toBeGreaterThan(0);
    expect(loaded.clock.tick).toBe(tickAfter);
    expect(loaded.rng.seed).toBe(world.rng.seed);
    expect(loaded.rng.state).toBe(stateAfter);
    expect(loaded.household.name).toBe(world.household.name);

    const nextLoaded = nextRng(loaded.rng);
    const clone = { seed: world.rng.seed, state: stateAfter };
    expect(nextRng(clone)).toBe(nextLoaded);
  });

  it('rebuilds walkable caches after load', () => {
    const content = minimalContent();
    const world = makeTestWorld(1);
    spawnTestPair(world, content);
    const before = Array.from(world.lot.walkable);
    const loaded = deserializeWorld(serializeWorld(world));
    expect(Array.from(loaded.lot.walkable)).toEqual(before);
  });

  it('preserves sim needs and skills', () => {
    const content = minimalContent();
    const world = makeTestWorld(2);
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.needs.hunger = 33;
    sim.skills.cooking = 4.5;
    sim.career = {
      trackId: 'career.chef',
      level: 1,
      performance: 60,
      daysWorked: 3,
    };
    const loaded = deserializeWorld(serializeWorld(world));
    const s2 = getSim(loaded, simA)!;
    expect(s2.needs.hunger).toBe(33);
    expect(s2.skills.cooking).toBe(4.5);
    expect(s2.career.trackId).toBe('career.chef');
    expect(s2.career.level).toBe(1);
  });

  it('preserves relationships', () => {
    const content = minimalContent();
    const world = makeTestWorld(3);
    const { simA, simB } = spawnTestPair(world, content);
    world.relationships.push({
      a: Math.min(simA, simB),
      b: Math.max(simA, simB),
      friendship: 42,
      romance: 7,
      flags: ['met'],
    });
    const loaded = deserializeWorld(serializeWorld(world));
    expect(loaded.relationships).toHaveLength(1);
    expect(loaded.relationships[0]!.friendship).toBe(42);
  });

  it('clears UI selection on load', () => {
    const content = minimalContent();
    const world = makeTestWorld(4);
    spawnTestPair(world, content);
    world.ui.targetEntityId = 99;
    world.ui.hoverEntityId = 98;
    const loaded = deserializeWorld(serializeWorld(world));
    expect(loaded.ui.targetEntityId).toBeNull();
    expect(loaded.ui.hoverEntityId).toBeNull();
  });
});

describe('localStorage save API', () => {
  const mem = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prev: any;

  beforeEach(() => {
    mem.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    prev = g.localStorage;
    g.localStorage = {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => {
        mem.set(k, String(v));
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
      clear: () => mem.clear(),
    };
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = prev;
  });

  it('save and load via localStorage helpers', () => {
    const content = minimalContent();
    const world = makeTestWorld(9);
    spawnTestPair(world, content);
    world.household.name = 'Storage Test';
    saveToLocalStorage('t1', world, 'Storage Test');
    const list = listLocalSaves();
    expect(list.some((s) => s.id === 't1')).toBe(true);
    const loaded = loadFromLocalStorage('t1');
    expect(loaded).not.toBeNull();
    expect(loaded!.household.name).toBe('Storage Test');
    expect(allSims(loaded!)).toHaveLength(2);
  });

  it('loadFromLocalStorage returns null for missing slot', () => {
    expect(loadFromLocalStorage('nope')).toBeNull();
  });
});

describe('commands + save interplay', () => {
  it('placeObject reduces funds and survives serialize', () => {
    const content = minimalContent();
    const world = makeTestWorld(12);
    spawnTestPair(world, content);
    const cmds = createCommands(world, content);
    const funds0 = world.household.funds;
    const ok = cmds.placeObject('object.open_tile', 20, 20);
    expect(ok).toBe(true);
    expect(world.household.funds).toBe(funds0 - 10);
    const loaded = deserializeWorld(serializeWorld(world));
    expect(loaded.household.funds).toBe(world.household.funds);
    expect(allObjects(loaded).some((o) => o.defId === 'object.open_tile')).toBe(true);
  });
});
