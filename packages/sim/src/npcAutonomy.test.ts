import { describe, expect, it } from 'vitest';
import { createCommands } from './commands.js';
import { createNeighborhood, furnishNeighborhood } from './neighborhood.js';
import { ensureNpcsSpawned, isNpc, systemNpcRoutine } from './npc.js';
import { runSimTick } from './systems.js';
import { minimalContent, makeTestWorld } from './test/fixtures.js';
import type { ContentPack, NpcDef } from './types.js';
import { allSims, getSim } from './world.js';

function townContent(): ContentPack {
  const base = minimalContent();
  const npcs: NpcDef[] = [
    {
      id: 'npc.park_goer',
      firstName: 'Sofia',
      lastName: 'Test',
      bio: 'Park regular',
      traits: [],
      aspirationId: 'aspiration.friendly',
      visual: {
        bodyPreset: 'body_b',
        hairPreset: 'hair_curly',
        outfitPreset: 'outfit_casual',
        skinTone: 'tone_3',
      },
      homePlaceId: 'home',
      startPlaceId: 'park',
      spawnOffset: { x: 0, y: 0 },
    },
  ];
  return { ...base, npcs };
}

function prepTown(content: ContentPack) {
  const world = makeTestWorld(7);
  const built = createNeighborhood();
  world.lots = built.lots;
  world.neighborhood = built.neighborhood;
  world.lot = built.lots.home!;
  furnishNeighborhood(world, content);
  world.mode = 'live';
  world.clock.paused = false;
  world.clock.speed = 1;
  return world;
}

describe('NPC self-sufficiency', () => {
  it('sends NPCs home at night via routine', () => {
    const content = townContent();
    const world = prepTown(content);
    const [npcId] = ensureNpcsSpawned(world, content);
    const npc = getSim(world, npcId!)!;
    expect(npc.placeId).toBe('park');
    world.clock.minuteOfDay = 23 * 60;
    npc.action = { kind: 'idle' };
    npc.queue.items = [];
    systemNpcRoutine(world, content);
    expect(npc.placeId).toBe('home');
  });

  it('travels home when critical needs cannot be met on current lot', () => {
    const content = townContent();
    const world = prepTown(content);
    // Spawn household so home is furnished; NPCs use home as personal home in this fixture
    createCommands(world, content).debugSpawnHousehold();
    const npc = allSims(world).find(isNpc)!;
    // Put them on a barren street with critical bladder
    npc.placeId = 'street_oak';
    npc.transform.x = 12;
    npc.transform.y = 12;
    npc.needs.bladder = 10;
    npc.needs.hunger = 80;
    npc.needs.energy = 80;
    npc.action = { kind: 'idle' };
    npc.queue.items = [];
    npc.autonomy.nextPlanTick = 0;
    npc.autonomy.cooldownUntil = 0;

    for (let i = 0; i < 8; i++) {
      runSimTick(world, content);
      if (npc.placeId === 'home' || npc.placeId.startsWith('house_')) break;
    }
    // Should leave the street for a place with toilets / home care
    expect(npc.placeId).not.toBe('street_oak');
  });

  it('keeps NPC needs out of free-fall over a hands-off city run', () => {
    const content = townContent();
    const world = prepTown(content);
    createCommands(world, content).debugSpawnHousehold();
    const npcs = allSims(world).filter(isNpc);
    expect(npcs.length).toBeGreaterThan(0);

    for (const n of npcs) {
      n.needs = {
        hunger: 55,
        energy: 55,
        bladder: 55,
        hygiene: 55,
        fun: 55,
        social: 55,
      };
      n.autonomy.nextPlanTick = 0;
    }

    let collapsed = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      runSimTick(world, content);
      for (const n of npcs) {
        if (n.presence !== 'on_lot') continue;
        const avg =
          (n.needs.hunger +
            n.needs.energy +
            n.needs.bladder +
            n.needs.hygiene +
            n.needs.fun +
            n.needs.social) /
          6;
        if (avg < 12) collapsed++;
      }
    }

    expect(collapsed).toBeLessThan(N * npcs.length * 0.4);
    for (const n of npcs) {
      expect(n.anim.clip).not.toBe('pass_out');
      for (const v of Object.values(n.needs)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});
