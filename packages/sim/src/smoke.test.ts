import { describe, expect, it } from 'vitest';
import { loadBuiltinContent } from '../../content/src/catalog.ts';
import { createCommands } from './commands.js';
import { serializeWorld, deserializeWorld } from './save.js';
import { runSimTick } from './systems.js';
import { createEmptyWorld, debugSpawnHousehold, allSims } from './world.js';

describe('LifeSim smoke', () => {
  it('spawns household, ticks, and round-trips save', () => {
    const content = loadBuiltinContent();
    const world = createEmptyWorld(12345);
    debugSpawnHousehold(world, content);
    expect(allSims(world).length).toBe(2);
    expect(world.household.funds).toBeGreaterThan(0);

    for (let i = 0; i < 120; i++) {
      runSimTick(world, content);
    }
    const sims = allSims(world);
    expect(sims.every((s) => s.needs.hunger <= 100)).toBe(true);

    const bytes = serializeWorld(world);
    const loaded = deserializeWorld(bytes);
    expect(allSims(loaded).length).toBe(2);
    expect(loaded.rng.state).toBe(world.rng.state);
    expect(loaded.clock.tick).toBe(world.clock.tick);

    const cmds = createCommands(loaded, content);
    cmds.enqueueInteraction(
      loaded.household.memberIds[0]!,
      'interact.fridge_snack',
      [...loaded.entities.values()].find((e) => e.kind === 'object' && e.defId === 'object.fridge_basic')!
        .id,
    );
    for (let i = 0; i < 60; i++) runSimTick(loaded, content);
  });
});
