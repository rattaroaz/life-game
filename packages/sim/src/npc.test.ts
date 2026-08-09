import { describe, expect, it } from 'vitest';
import { createCommands, projectHud } from './commands.js';
import { createNeighborhood, furnishNeighborhood } from './neighborhood.js';
import { ensureNpcsSpawned, isHouseholdSim, isNpc } from './npc.js';
import { addRelationshipDelta, getRelationship } from './relationships.js';
import { minimalContent, makeTestWorld, spawnTestPair } from './test/fixtures.js';
import type { ContentPack, NpcDef } from './types.js';
import { allSims, getSim } from './world.js';

function contentWithNpcs(): ContentPack {
  const base = minimalContent();
  const npcs: NpcDef[] = [
    {
      id: 'npc.test_a',
      firstName: 'Nora',
      lastName: 'Test',
      bio: 'Test barista',
      traits: [],
      aspirationId: 'aspiration.friendly',
      visual: {
        bodyPreset: 'body_a',
        hairPreset: 'hair_short',
        outfitPreset: 'outfit_casual',
        skinTone: 'tone_1',
      },
      homePlaceId: 'home',
      startPlaceId: 'home',
      spawnOffset: { x: 2, y: 0 },
    },
    {
      id: 'npc.test_b',
      firstName: 'Theo',
      lastName: 'Test',
      bio: 'Test librarian',
      traits: [],
      aspirationId: 'aspiration.friendly',
      visual: {
        bodyPreset: 'body_b',
        hairPreset: 'hair_long',
        outfitPreset: 'outfit_pro',
        skinTone: 'tone_2',
      },
      homePlaceId: 'home',
      startPlaceId: 'home',
      spawnOffset: { x: -2, y: 0 },
    },
  ];
  return { ...base, npcs };
}

function prepWorld(content: ContentPack) {
  const world = makeTestWorld();
  const built = createNeighborhood();
  world.lots = built.lots;
  world.neighborhood = built.neighborhood;
  world.lot = built.lots.home!;
  furnishNeighborhood(world, content);
  return world;
}

describe('NPC system', () => {
  it('spawns NPCs outside the household', () => {
    const content = contentWithNpcs();
    const world = prepWorld(content);
    const { simA } = spawnTestPair(world, content);
    const ids = ensureNpcsSpawned(world, content);
    expect(ids).toHaveLength(2);
    expect(allSims(world).filter(isNpc)).toHaveLength(2);
    expect(world.household.memberIds).toContain(simA);
    for (const id of ids) {
      expect(world.household.memberIds).not.toContain(id);
      const npc = getSim(world, id)!;
      expect(isNpc(npc)).toBe(true);
      expect(isHouseholdSim(world, npc)).toBe(false);
    }
  });

  it('does not re-spawn NPCs that already exist', () => {
    const content = contentWithNpcs();
    const world = prepWorld(content);
    ensureNpcsSpawned(world, content);
    expect(ensureNpcsSpawned(world, content)).toHaveLength(0);
    expect(allSims(world).filter(isNpc)).toHaveLength(2);
  });

  it('selectSim ignores NPCs; HUD exposes bio and filters household list', () => {
    const content = contentWithNpcs();
    const world = prepWorld(content);
    const { simA } = spawnTestPair(world, content);
    const [npcId] = ensureNpcsSpawned(world, content);
    const cmds = createCommands(world, content);
    cmds.selectSim(simA);
    cmds.selectSim(npcId!);
    expect(world.ui.selectedSimId).toBe(simA);
    cmds.setWorldTarget(npcId!);
    world.neighborhood.activePlaceId = 'home';
    const projection = projectHud(world, content, []);
    expect(projection.target?.role).toBe('npc');
    expect(projection.target?.bio).toContain('Test');
    expect(projection.householdSims.every((s) => s.id !== npcId)).toBe(true);
    expect(projection.target?.availableInteractions.some((i) => i.id === 'interact.chat')).toBe(
      true,
    );
  });

  it('marks met on social relationship delta', () => {
    const content = contentWithNpcs();
    const world = prepWorld(content);
    const { simA } = spawnTestPair(world, content);
    const [npcId] = ensureNpcsSpawned(world, content);
    addRelationshipDelta(world.relationships, simA, npcId!, 8, 0);
    const edge = getRelationship(world.relationships, simA, npcId!);
    expect(edge?.flags).toContain('met');
    expect(edge?.friendship).toBe(8);
  });
});
