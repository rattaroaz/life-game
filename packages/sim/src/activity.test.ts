import { describe, expect, it } from 'vitest';
import { describeSimActivity } from './activity.js';
import { WALK_INTERACTION_ID } from './commands.js';
import { minimalContent, makeTestWorld, spawnTestPair } from './test/fixtures.js';
import { getSim } from './world.js';

describe('describeSimActivity', () => {
  it('reports Idle when standing around', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    const a = describeSimActivity(sim, content, world);
    expect(a.label).toBe('Idle');
    expect(a.phase).toBe('idle');
  });

  it('reports Walking for player walk-to', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.action = {
      kind: 'pathing',
      interactionId: WALK_INTERACTION_ID,
      targetId: null,
      fails: 0,
    };
    const a = describeSimActivity(sim, content, world);
    expect(a.label).toBe('Walking');
    expect(a.phase).toBe('moving');
  });

  it('reports performing interactions with readable labels', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.action = {
      kind: 'performing',
      interactionId: 'interact.eat_meal',
      targetId: null,
      ticksLeft: 5,
      slotId: null,
    };
    const a = describeSimActivity(sim, content, world);
    expect(a.label.toLowerCase()).toContain('eat');
    expect(a.phase).toBe('doing');
  });

  it('reports Working when at work', () => {
    const content = minimalContent();
    const world = makeTestWorld();
    const { simA } = spawnTestPair(world, content);
    const sim = getSim(world, simA)!;
    sim.presence = 'at_work';
    sim.career.trackId = content.careers[0]?.id ?? null;
    const a = describeSimActivity(sim, content, world);
    expect(a.label).toBe('Working');
    expect(a.phase).toBe('work');
  });
});
