import { describe, expect, it } from 'vitest';
import { createCommands, WORK_SKIP_FIRE_COUNT } from './commands.js';
import { minimalContent, makeTestWorld, spawnTestPair } from './test/fixtures.js';
import { getSim } from './world.js';

describe('player interrupt / work skips', () => {
  it('reports busy while performing an action', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.action = {
      kind: 'performing',
      interactionId: 'interact.watch_tv',
      targetId: null,
      ticksLeft: 5,
      slotId: null,
    };
    const cmds = createCommands(world, content);
    const busy = cmds.getBusyInfo(simA);
    expect(busy.busy).toBe(true);
    expect(busy.activityLabel.toLowerCase()).toMatch(/watch|doing|tv/i);
  });

  it('does not treat walking / pathing as a busy activity', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    const cmds = createCommands(world, content);

    sim.presence = 'on_lot';
    sim.action = {
      kind: 'pathing',
      interactionId: '__walk__',
      targetId: null,
      fails: 0,
    };
    expect(cmds.getBusyInfo(simA).busy).toBe(false);

    // En route to an object interaction — still not "at" the activity
    sim.action = {
      kind: 'pathing',
      interactionId: 'interact.watch_tv',
      targetId: null,
      fails: 0,
    };
    expect(cmds.getBusyInfo(simA).busy).toBe(false);

    // Heading toward work but not clocked in yet
    sim.career.trackId = 'career.office_worker';
    sim.action = {
      kind: 'pathing',
      interactionId: '__travel__:office',
      targetId: null,
      fails: 0,
    };
    expect(cmds.getBusyInfo(simA).busy).toBe(false);
    expect(cmds.getBusyInfo(simA).atWork).toBe(false);
  });

  it('interrupt clears action and leaves work with warnings then fires', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.career = {
      trackId: 'career.office_worker',
      level: 0,
      performance: 60,
      daysWorked: 2,
      skipCount: 0,
    };
    sim.presence = 'at_work';
    sim.action = { kind: 'idle' };
    const cmds = createCommands(world, content);

    expect(cmds.getBusyInfo(simA).atWork).toBe(true);

    for (let i = 0; i < WORK_SKIP_FIRE_COUNT - 1; i++) {
      sim.presence = 'at_work';
      const r = cmds.interruptForPlayer(simA);
      expect(r.leftWork).toBe(true);
      expect(r.fired).toBe(false);
      expect(sim.presence).toBe('on_lot');
      expect(sim.career.trackId).toBe('career.office_worker');
    }

    sim.presence = 'at_work';
    const last = cmds.interruptForPlayer(simA);
    expect(last.fired).toBe(true);
    expect(sim.career.trackId).toBeNull();
    const msgs = cmds.drainEvents();
    expect(msgs.some((m) => m.toLowerCase().includes('fired'))).toBe(true);
  });
});
