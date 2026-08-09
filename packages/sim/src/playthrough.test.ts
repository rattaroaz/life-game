/**
 * Automated "play the game" session — drives demo household through real systems.
 */
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

describe('automated playthrough', () => {
  it('plays a 1-game-hour session with player actions, work, and save', () => {
    const content = loadBuiltinContent();
    const world = createEmptyWorld(20260809);
    debugSpawnHousehold(world, content);
    const cmds = createCommands(world, content);
    const sims = allSims(world);
    expect(sims.length).toBe(2);
    const [alex, jordan] = sims;
    cmds.selectSim(alex!.id);
    cmds.joinCareer(alex!.id, 'career.office_worker');
    cmds.joinCareer(jordan!.id, 'career.chef');

    const fridge = allObjects(world).find((o) => o.defId === 'object.fridge_basic')!;
    const bed = allObjects(world).find((o) => o.defId === 'object.bed_double')!;
    const tv = allObjects(world).find((o) => o.defId === 'object.tv_basic');

    // Morning snack for Alex
    cmds.enqueueInteraction(alex!.id, 'interact.fridge_snack', fridge.id);
    // Jordan starts cook chain
    cmds.enqueueInteraction(jordan!.id, 'interact.fridge_start_meal', fridge.id);

    world.mode = 'live';
    world.clock.paused = false;
    world.clock.speed = 1;

    const log: string[] = [];
    const startFunds = world.household.funds;

    // ~60 game minutes of free play (with autonomy)
    for (let i = 0; i < 60; i++) {
      runSimTick(world, content);
    }
    log.push(
      `t+60min: ${alex!.identity.firstName} hunger=${alex!.needs.hunger.toFixed(0)} action=${alex!.action.kind}`,
    );
    log.push(
      `t+60min: ${jordan!.identity.firstName} hunger=${jordan!.needs.hunger.toFixed(0)} held=${jordan!.inventory.held}`,
    );

    // Watch TV if present
    if (tv) {
      cmds.enqueueInteraction(alex!.id, 'interact.watch_tv', tv.id);
    }
    cmds.enqueueInteraction(jordan!.id, 'interact.sleep', bed.id);

    for (let i = 0; i < 120; i++) {
      runSimTick(world, content);
    }

    // Social
    cmds.cancelAction(alex!.id);
    cmds.enqueueInteraction(alex!.id, 'interact.chat', jordan!.id);
    for (let i = 0; i < 80; i++) {
      runSimTick(world, content);
    }

    // Advance to work day Monday 9:00
    world.clock.dayOfWeek = 0;
    world.clock.minuteOfDay = 9 * 60;
    runSimTick(world, content);
    log.push(`work start: alex presence=${getSim(world, alex!.id)!.presence}`);

    // Work day end
    world.clock.minuteOfDay = 17 * 60;
    runSimTick(world, content);
    log.push(
      `work end: funds=${world.household.funds} (was ${startFunds}) alex=${getSim(world, alex!.id)!.presence}`,
    );

    // Save / load mid-session
    const bytes = serializeWorld(world);
    const loaded = deserializeWorld(bytes);
    expect(allSims(loaded).length).toBe(2);
    expect(loaded.household.funds).toBe(world.household.funds);

    // Needs stay in bounds after full session
    for (const s of allSims(world)) {
      for (const [k, v] of Object.entries(s.needs)) {
        expect(v, `${s.identity.firstName}.${k}`).toBeGreaterThanOrEqual(0);
        expect(v, `${s.identity.firstName}.${k}`).toBeLessThanOrEqual(100);
      }
    }

    // Paid for office work
    expect(world.household.funds).toBeGreaterThanOrEqual(startFunds);

    // eslint-disable-next-line no-console
    console.log('[playthrough]\n' + log.join('\n'));
  });
});
