import { describe, expect, it } from 'vitest';
import { createClock } from './clock.js';
import { minimalContent, makeTestWorld, spawnTestPair } from './test/fixtures.js';
import {
  allObjects,
  allSims,
  createEmptyWorld,
  getObject,
  getSim,
  refreshLotCaches,
  spawnObject,
  spawnSim,
} from './world.js';

describe('world / ECS', () => {
  it('createEmptyWorld initializes defaults', () => {
    const w = createEmptyWorld(99);
    expect(w.nextId).toBe(1);
    expect(w.entities.size).toBe(0);
    expect(w.mode).toBe('live');
    expect(w.household.funds).toBe(20000);
    expect(w.rng.seed).toBe(99);
    expect(w.clock.minuteOfDay).toBe(8 * 60);
  });

  it('spawnSim allocates ids and household membership', () => {
    const w = makeTestWorld();
    const s = spawnSim(w, { firstName: 'X', lastName: 'Y', x: 5, y: 5 });
    expect(s.id).toBe(1);
    expect(w.household.memberIds).toContain(s.id);
    expect(getSim(w, s.id)?.identity.firstName).toBe('X');
    expect(w.ui.selectedSimId).toBe(s.id);
    expect(s.needs.hunger).toBeGreaterThan(0);
    expect(s.skills.cooking).toBe(0);
  });

  it('spawnObject places footprint and refreshes nav', () => {
    const w = makeTestWorld();
    const content = minimalContent();
    const def = content.objects.find((o) => o.id === 'object.fridge_basic')!;
    const o = spawnObject(w, def, 10, 10)!;
    expect(getObject(w, o.id)?.defId).toBe('object.fridge_basic');
    expect(allObjects(w)).toHaveLength(1);
    // blocking footprint at (x=10,y=10) => index y*width+x
    const cell = 10 * w.lot.width + 10;
    expect(w.lot.walkable[cell]).toBe(0);
  });

  it('allSims / allObjects are sorted by id', () => {
    const w = makeTestWorld();
    const content = minimalContent();
    spawnTestPair(w, content);
    const sims = allSims(w);
    const objs = allObjects(w);
    for (let i = 1; i < sims.length; i++) {
      expect(sims[i]!.id).toBeGreaterThan(sims[i - 1]!.id);
    }
    for (let i = 1; i < objs.length; i++) {
      expect(objs[i]!.id).toBeGreaterThan(objs[i - 1]!.id);
    }
  });

  it('getSim/getObject return null for wrong kind or missing', () => {
    const w = makeTestWorld();
    const content = minimalContent();
    const s = spawnSim(w, { firstName: 'A', lastName: 'B', x: 1, y: 1 });
    const o = spawnObject(w, content.objects[0]!, 2, 2)!;
    expect(getSim(w, o.id)).toBeNull();
    expect(getObject(w, s.id)).toBeNull();
    expect(getSim(w, 999)).toBeNull();
  });

  it('refreshLotCaches is idempotent', () => {
    const w = makeTestWorld();
    const content = minimalContent();
    spawnTestPair(w, content);
    const before = Uint8Array.from(w.lot.walkable);
    refreshLotCaches(w);
    expect(Array.from(w.lot.walkable)).toEqual(Array.from(before));
  });

  it('createClock helper still works via re-export path', () => {
    const c = createClock(0);
    expect(c.tick).toBe(0);
  });
});
