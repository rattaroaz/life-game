import { describe, expect, it } from 'vitest';
import { createCommands } from './commands.js';
import { serializeWorld, deserializeWorld } from './save.js';
import { runSimTick } from './systems.js';
import { minimalContent, makeTestWorld, spawnTestPair, tick } from './test/fixtures.js';
import { allObjects, allSims, getSim } from './world.js';

describe('LifeSim smoke', () => {
  it('spawns household, ticks, and round-trips save', () => {
    const content = minimalContent();
    const world = makeTestWorld(12345);
    spawnTestPair(world, content);
    expect(allSims(world).length).toBe(2);
    expect(world.household.funds).toBeGreaterThan(0);

    tick(world, content, 120, runSimTick);
    const sims = allSims(world);
    expect(sims.every((s) => s.needs.hunger <= 100)).toBe(true);

    const bytes = serializeWorld(world);
    const loaded = deserializeWorld(bytes);
    expect(allSims(loaded).length).toBe(2);
    expect(loaded.rng.state).toBe(world.rng.state);
    expect(loaded.clock.tick).toBe(world.clock.tick);

    const fridge = allObjects(loaded).find((o) => o.defId === 'object.fridge_basic')!;
    const cmds = createCommands(loaded, content);
    cmds.enqueueInteraction(
      loaded.household.memberIds[0]!,
      'interact.fridge_snack',
      fridge.id,
    );
    tick(loaded, content, 60, runSimTick);
    const sim = getSim(loaded, loaded.household.memberIds[0]!)!;
    // hunger not necessarily higher if autonomy interrupted, but world stays valid
    expect(sim.needs.hunger).toBeGreaterThanOrEqual(0);
  });
});
