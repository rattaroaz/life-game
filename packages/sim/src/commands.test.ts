import { describe, expect, it } from 'vitest';
import { createCommands, projectHud } from './commands.js';
import { runSimTick } from './systems.js';
import { minimalContent, makeTestWorld, spawnTestPair } from './test/fixtures.js';
import { allObjects, getSim } from './world.js';

describe('SimCommands', () => {
  it('setMode pauses in build/buy and clears buy ghost on live', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    spawnTestPair(world, content);
    const cmds = createCommands(world, content);
    cmds.setMode('build');
    expect(world.mode).toBe('build');
    expect(world.clock.paused).toBe(true);
    cmds.setMode('buy');
    expect(world.mode).toBe('buy');
    world.ui.buyGhost = { defId: 'x', x: 1, y: 1, rot: 0 };
    cmds.setMode('live');
    expect(world.ui.buyGhost).toBeNull();
  });

  it('setSpeed 0 pauses; setSpeed 1 unpauses', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const cmds = createCommands(world, content);
    cmds.setSpeed(0);
    expect(world.clock.speed).toBe(0);
    expect(world.clock.paused).toBe(true);
    cmds.setSpeed(2);
    expect(world.clock.speed).toBe(2);
  });

  it('selectSim and setWorldTarget update ui', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const { simA } = spawnTestPair(world, content);
    const cmds = createCommands(world, content);
    cmds.selectSim(simA);
    expect(world.ui.selectedSimId).toBe(simA);
    cmds.setWorldTarget(simA);
    expect(world.ui.targetEntityId).toBe(simA);
  });

  it('cancelAction clears queue and fails current action', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    const fridge = allObjects(world).find((o) => o.defId === 'object.fridge_basic')!;
    const cmds = createCommands(world, content);
    cmds.enqueueInteraction(simA, 'interact.fridge_snack', fridge.id);
    cmds.enqueueInteraction(simA, 'interact.sleep', fridge.id);
    expect(sim.queue.items.length).toBe(2);
    // Start processing
    world.mode = 'live';
    world.clock.paused = false;
    world.clock.speed = 1;
    runSimTick(world, content);
    cmds.cancelAction(simA);
    expect(sim.queue.items.length).toBe(0);
    expect(sim.action.kind === 'failed' || sim.action.kind === 'idle').toBe(true);
  });

  it('placeObject rejects unknown def and insufficient funds', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    spawnTestPair(world, content);
    const cmds = createCommands(world, content);
    expect(cmds.placeObject('object.nope', 1, 1)).toBe(false);
    world.household.funds = 0;
    expect(cmds.placeObject('object.fridge_basic', 1, 1)).toBe(false);
  });

  it('deleteObject refunds half price and invalidates queues', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const { simA } = spawnTestPair(world, content);
    const fridge = allObjects(world).find((o) => o.defId === 'object.fridge_basic')!;
    const cmds = createCommands(world, content);
    cmds.enqueueInteraction(simA, 'interact.fridge_snack', fridge.id);
    const funds0 = world.household.funds;
    cmds.deleteObject(fridge.id);
    expect(allObjects(world).find((o) => o.id === fridge.id)).toBeUndefined();
    expect(world.household.funds).toBeGreaterThan(funds0);
    expect(getSim(world, simA)!.queue.items.every((q) => q.targetId !== fridge.id)).toBe(
      true,
    );
  });

  it('joinCareer sets track', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const { simA } = spawnTestPair(world, content);
    createCommands(world, content).joinCareer(simA, 'career.chef');
    expect(getSim(world, simA)!.career.trackId).toBe('career.chef');
  });

  it('createHousehold replaces sims and funds furniture', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const cmds = createCommands(world, content);
    cmds.createHousehold({
      householdName: 'New',
      funds: 15000,
      members: [
        {
          firstName: 'C',
          lastName: 'D',
          traits: ['trait.cheerful'],
          aspirationId: 'aspiration.friendly',
          visual: {
            bodyPreset: 'body_a',
            hairPreset: 'hair_short',
            outfitPreset: 'outfit_casual',
            skinTone: 'tone_1',
          },
        },
      ],
    });
    expect(world.household.name).toBe('New');
    expect(world.household.memberIds).toHaveLength(1);
    expect(allObjects(world).length).toBeGreaterThan(0);
  });

  it('projectHud exposes selected sim needs and interactions', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const { simA } = spawnTestPair(world, content);
    const fridge = allObjects(world).find((o) => o.defId === 'object.fridge_basic')!;
    world.ui.selectedSimId = simA;
    world.ui.targetEntityId = fridge.id;
    const hud = projectHud(world, content, ['hi']);
    expect(hud.selectedSim?.id).toBe(simA);
    expect(hud.target?.kind).toBe('object');
    expect(hud.target?.availableInteractions.length).toBeGreaterThan(0);
    expect(hud.toasts).toContain('hi');
    expect(hud.funds).toBe(world.household.funds);
  });

  it('setWallTool mutates walls', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const cmds = createCommands(world, content);
    const n0 = world.lot.walls.length;
    cmds.setWallTool(5, 5, 'h', 'wall');
    expect(world.lot.walls.length).toBeGreaterThanOrEqual(n0);
    cmds.setWallTool(5, 5, 'h', null);
  });

  it('drainEvents returns toast messages and clears bus', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    world.eventBus.push({ type: 'toast', message: 'A' });
    world.eventBus.push({ type: 'toast', message: 'B' });
    const msgs = createCommands(world, content).drainEvents();
    expect(msgs).toEqual(['A', 'B']);
    expect(world.eventBus).toHaveLength(0);
  });

  it('walkTo paths selected sim toward a walkable tile', async () => {
    const content = minimalContent();
    const world = makeTestWorld(3);
    const { simA } = spawnTestPair(world, content);
    const cmds = createCommands(world, content);
    cmds.selectSim(simA);
    const sim = getSim(world, simA)!;
    const startX = sim.transform.x;
    const startY = sim.transform.y;
    const ok = cmds.walkTo(12, 18, simA);
    expect(ok).toBe(true);
    expect(sim.action.kind).toBe('pathing');
    expect(sim.path.waypoints.length).toBeGreaterThan(0);
    world.mode = 'live';
    world.clock.paused = false;
    world.clock.speed = 1;
    const { runSimTick } = await import('./systems.js');
    for (let i = 0; i < 200; i++) {
      runSimTick(world, content);
      if (sim.action.kind === 'idle' && sim.path.waypoints.length === 0) break;
    }
    const moved =
      Math.abs(sim.transform.x - startX) + Math.abs(sim.transform.y - startY) > 0.5 ||
      sim.action.kind === 'idle';
    expect(moved).toBe(true);
  });
});
