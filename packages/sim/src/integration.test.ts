import { describe, expect, it } from 'vitest';
import { loadBuiltinContent } from '@lifesim/content';
import { createCommands } from './commands.js';
import { deserializeWorld, serializeWorld } from './save.js';
import { runSimTick } from './systems.js';
import {
  allObjects,
  allSims,
  createEmptyWorld,
  debugSpawnHousehold,
  getSim,
} from './world.js';

/**
 * Integration tests against the full built-in catalog.
 */
describe('integration: builtin content', () => {
  it('catalog has required v1 surface area', () => {
    const c = loadBuiltinContent();
    expect(c.objects.length).toBeGreaterThanOrEqual(30);
    expect(c.interactions.length).toBeGreaterThanOrEqual(15);
    expect(c.careers.map((x) => x.id).sort()).toEqual(
      ['career.chef', 'career.office_worker'].sort(),
    );
    expect(c.traits.length).toBeGreaterThanOrEqual(5);
    expect(c.aspirations.length).toBeGreaterThanOrEqual(2);

    // every object interaction id resolves
    const iids = new Set(c.interactions.map((i) => i.id));
    for (const o of c.objects) {
      for (const iid of o.interactions) {
        expect(iids.has(iid)).toBe(true);
      }
    }
    // chain targets resolve
    for (const i of c.interactions) {
      if (i.chain) {
        expect(iids.has(i.chain.nextInteractionId)).toBe(true);
      }
    }
  });

  it('debugSpawnHousehold is stable for 500 ticks + save round-trip', () => {
    const content = loadBuiltinContent();
    const world = createEmptyWorld(2026);
    debugSpawnHousehold(world, content);
    expect(allSims(world).length).toBe(2);
    expect(allObjects(world).length).toBeGreaterThan(10);

    world.mode = 'live';
    world.clock.paused = false;
    world.clock.speed = 1;
    for (let i = 0; i < 500; i++) {
      runSimTick(world, content);
    }
    expect(world.clock.tick).toBe(500);
    for (const s of allSims(world)) {
      for (const v of Object.values(s.needs)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }

    const loaded = deserializeWorld(serializeWorld(world));
    expect(allSims(loaded).length).toBe(2);
    expect(loaded.clock.tick).toBe(500);
    expect(loaded.rng.state).toBe(world.rng.state);
  });

  it('player can join both careers without crash', () => {
    const content = loadBuiltinContent();
    const world = createEmptyWorld(1);
    debugSpawnHousehold(world, content);
    const cmds = createCommands(world, content);
    const [a, b] = world.household.memberIds;
    cmds.joinCareer(a!, 'career.office_worker');
    cmds.joinCareer(b!, 'career.chef');
    expect(getSim(world, a!)!.career.trackId).toBe('career.office_worker');
    expect(getSim(world, b!)!.career.trackId).toBe('career.chef');
  });
});
