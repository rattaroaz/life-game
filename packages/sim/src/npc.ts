import { travelSimToPlace } from './neighborhood.js';
import { nearestWalkable } from './pathfinding.js';
import { ensureRelationship } from './relationships.js';
import type { ContentPack, EntityId, NpcDef, Needs, SimEntity, World } from './types.js';
import { allSims, spawnSim } from './world.js';

const NEED_KEYS = ['hunger', 'energy', 'bladder', 'hygiene', 'fun', 'social'] as const;
const CRITICAL = 28;

function hasCriticalNeeds(needs: Needs): boolean {
  return NEED_KEYS.some((k) => needs[k] < CRITICAL);
}

function hangoutPlace(def: NpcDef): string {
  if (def.startPlaceId !== def.homePlaceId) return def.startPlaceId;
  // Homebodies still go out sometimes
  return 'park';
}

export const FLIRT_MIN_FRIENDSHIP = 20;

export function isNpc(sim: SimEntity): boolean {
  return sim.role === 'npc';
}

export function isHouseholdSim(world: World, sim: SimEntity): boolean {
  return sim.role === 'household' && world.household.memberIds.includes(sim.id);
}

export function getNpcDef(content: ContentPack, npcDefId: string | null | undefined): NpcDef | undefined {
  if (!npcDefId) return undefined;
  return content.npcs.find((n) => n.id === npcDefId);
}

function spawnPoint(world: World, def: NpcDef): { x: number; y: number } {
  const lot = world.lots[def.startPlaceId];
  const entry = lot?.entryMarkers[0] ?? { x: 12, y: 14 };
  const ox = def.spawnOffset?.x ?? 0;
  const oy = def.spawnOffset?.y ?? -2;
  let x = entry.x + ox;
  let y = entry.y + oy;
  if (lot) {
    const walk = nearestWalkable(lot, x, y, 6);
    if (walk) {
      x = walk.x;
      y = walk.y;
    }
  }
  return { x, y };
}

/** Spawn a single NPC from a content def (never joins the player household). */
export function spawnNpc(world: World, def: NpcDef): SimEntity | null {
  if (!world.lots[def.startPlaceId]) {
    return null;
  }
  const { x, y } = spawnPoint(world, def);
  const sim = spawnSim(world, {
    firstName: def.firstName,
    lastName: def.lastName,
    x,
    y,
    placeId: def.startPlaceId,
    traits: def.traits,
    aspirationId: def.aspirationId,
    visual: def.visual,
    role: 'npc',
    npcDefId: def.id,
    householdMember: false,
  });
  // NPCs never join player careers
  sim.career = { trackId: null, level: 0, performance: 50, daysWorked: 0, skipCount: 0 };
  return sim;
}

/**
 * Ensure all content NPCs exist in the world.
 * Safe to call on new games and after load (fills missing townies).
 */
export function ensureNpcsSpawned(world: World, content: ContentPack): EntityId[] {
  const existing = new Set(
    allSims(world)
      .map((s) => s.npcDefId)
      .filter((id): id is string => !!id),
  );
  const spawned: EntityId[] = [];
  for (const def of content.npcs) {
    if (existing.has(def.id)) continue;
    const sim = spawnNpc(world, def);
    if (sim) spawned.push(sim.id);
  }
  seedNpcRelationships(world, content);
  return spawned;
}

/** Light flavor: neighbor couples start as friends with each other. */
function seedNpcRelationships(world: World, content: ContentPack): void {
  const byDef = new Map<string, SimEntity>();
  for (const s of allSims(world)) {
    if (s.npcDefId) byDef.set(s.npcDefId, s);
  }
  const pairs: [string, string, number][] = [
    ['npc.mei_chen', 'npc.wei_chen', 55],
    ['npc.sofia_park', 'npc.minjun_park', 45],
    ['npc.amara_okonkwo', 'npc.kwame_okonkwo', 50],
    ['npc.lucia_diaz', 'npc.mateo_diaz', 48],
    ['npc.nora_blake', 'npc.theo_reed', 15],
    ['npc.sofia_park', 'npc.nora_blake', 25],
  ];
  for (const [aId, bId, friendship] of pairs) {
    const a = byDef.get(aId);
    const b = byDef.get(bId);
    if (!a || !b) continue;
    const edge = ensureRelationship(world.relationships, a.id, b.id);
    if (edge.friendship === 0 && !edge.flags.includes('met')) {
      edge.friendship = friendship;
      edge.flags.push('met');
    }
  }
  // Silence unused in case content.npcs empty
  void content;
}

/** Normalize legacy saves that predate role / npcDefId. */
export function normalizeSimRoles(world: World): void {
  for (const sim of allSims(world)) {
    if (sim.role !== 'household' && sim.role !== 'npc') {
      sim.role = world.household.memberIds.includes(sim.id) ? 'household' : 'npc';
    }
    if (sim.npcDefId === undefined) {
      sim.npcDefId = null;
    }
    // Household list must not include NPCs
    if (sim.role === 'npc') {
      world.household.memberIds = world.household.memberIds.filter((id) => id !== sim.id);
    }
  }
}

/**
 * Daily rhythm for NPCs so they live without player input:
 * night → home; daytime when comfortable → hangout; never leave home while critical.
 */
export function systemNpcRoutine(world: World, content: ContentPack): void {
  const min = world.clock.minuteOfDay;
  const night = min >= 22 * 60 || min < 7 * 60;
  const dayOut = min >= 10 * 60 && min < 18 * 60;

  for (const sim of allSims(world)) {
    if (!isNpc(sim)) continue;
    if (sim.presence !== 'on_lot') continue;
    if (sim.action.kind !== 'idle') continue;
    if (sim.socialLock) continue;
    if (sim.queue.items.some((q) => q.playerQueued)) continue;
    // Let autonomy finish current care queue
    if (sim.queue.items.length > 0) continue;

    const def = getNpcDef(content, sim.npcDefId);
    if (!def) continue;
    const home = def.homePlaceId;
    const out = hangoutPlace(def);
    if (!world.lots[home]) continue;

    // Night: sleep / recover at home
    if (night && sim.placeId !== home) {
      travelSimToPlace(world, sim.id, home, { silent: true });
      sim.autonomy.nextPlanTick = world.clock.tick + 1;
      continue;
    }

    // Critical needs: stay put if already home (autonomy uses objects); else go home
    if (hasCriticalNeeds(sim.needs)) {
      if (sim.placeId !== home) {
        travelSimToPlace(world, sim.id, home, { silent: true });
        sim.autonomy.nextPlanTick = world.clock.tick + 1;
      }
      continue;
    }

    // Daytime outing when comfortable — stagger by id so they don't teleport en masse
    if (
      dayOut &&
      !night &&
      out !== home &&
      world.lots[out] &&
      sim.placeId === home &&
      (world.clock.tick + sim.id) % 40 === 0
    ) {
      travelSimToPlace(world, sim.id, out, { silent: true });
      sim.autonomy.nextPlanTick = world.clock.tick + 2;
      continue;
    }

    // Stranded on a street with almost no care options — go home
    if (
      (sim.placeId.startsWith('street_') || sim.placeId === 'plaza') &&
      hasCriticalNeeds(sim.needs)
    ) {
      travelSimToPlace(world, sim.id, home, { silent: true });
      sim.autonomy.nextPlanTick = world.clock.tick + 1;
    }
  }
}
