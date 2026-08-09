import { createClock } from './clock.js';
import { recomputeLotDerived, type FootprintStamp } from './lot.js';
import {
  createNeighborhood,
  furnishNeighborhood,
  objectsInPlace,
  refreshPlaceCaches,
} from './neighborhood.js';
import { createRng } from './rng.js';
import type {
  ContentPack,
  EntityId,
  Needs,
  ObjectDef,
  ObjectEntity,
  SimEntity,
  SimVisual,
  World,
} from './types.js';
import { ensureRelationship } from './relationships.js';

export const DEFAULT_NEEDS: Needs = {
  hunger: 70,
  energy: 80,
  bladder: 70,
  hygiene: 75,
  fun: 60,
  social: 55,
};

export function createEmptyWorld(seed = 42): World {
  const { neighborhood, lots } = createNeighborhood();
  const active = neighborhood.activePlaceId;
  return {
    nextId: 1,
    entities: new Map(),
    relationships: [],
    lot: lots[active]!,
    lots,
    neighborhood,
    household: { name: 'New Household', funds: 20000, memberIds: [] },
    clock: createClock(8 * 60),
    rng: createRng(seed),
    mode: 'live',
    weather: 'sunny',
    ui: {
      selectedSimId: null,
      targetEntityId: null,
      hoverEntityId: null,
      modeTool: null,
      buyGhost: null,
    },
    eventBus: [],
    playTimeSeconds: 0,
  };
}

export function allocId(world: World): EntityId {
  return world.nextId++;
}

export function getSim(world: World, id: EntityId): SimEntity | null {
  const e = world.entities.get(id);
  return e?.kind === 'sim' ? e : null;
}

export function getObject(world: World, id: EntityId): ObjectEntity | null {
  const e = world.entities.get(id);
  return e?.kind === 'object' ? e : null;
}

export function allSims(world: World): SimEntity[] {
  const out: SimEntity[] = [];
  for (const e of world.entities.values()) {
    if (e.kind === 'sim') out.push(e);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

export function allObjects(world: World): ObjectEntity[] {
  const out: ObjectEntity[] = [];
  for (const e of world.entities.values()) {
    if (e.kind === 'object') out.push(e);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

/** Objects in the currently viewed place */
export function activeObjects(world: World): ObjectEntity[] {
  return objectsInPlace(world, world.neighborhood.activePlaceId);
}

/** Sims currently in the active place and on_lot (or at_work shown at home door) */
export function activeSims(world: World): SimEntity[] {
  const placeId = world.neighborhood.activePlaceId;
  return allSims(world).filter(
    (s) =>
      s.placeId === placeId ||
      (s.presence === 'at_work' && placeId === world.neighborhood.homePlaceId),
  );
}

export function stampObjects(world: World, placeId?: string): FootprintStamp[] {
  const pid = placeId ?? world.neighborhood.activePlaceId;
  return objectsInPlace(world, pid).map((o) => ({
    x: o.transform.x,
    y: o.transform.y,
    w: o.footprint.w,
    h: o.footprint.h,
    blocksPath: o.blocksPath,
    id: o.id,
  }));
}

export function refreshLotCaches(world: World): void {
  refreshPlaceCaches(world, world.neighborhood.activePlaceId);
  world.lot = world.lots[world.neighborhood.activePlaceId]!;
}

export function spawnSim(
  world: World,
  opts: {
    firstName: string;
    lastName: string;
    x: number;
    y: number;
    placeId?: string;
    visual?: Partial<SimVisual>;
    traits?: string[];
    aspirationId?: string;
    role?: 'household' | 'npc';
    npcDefId?: string | null;
    /** When false, Sim is not added to the player household (NPCs). Default true. */
    householdMember?: boolean;
  },
): SimEntity {
  const id = allocId(world);
  const placeId = opts.placeId ?? world.neighborhood.homePlaceId;
  const householdMember = opts.householdMember !== false;
  const role = opts.role ?? (householdMember ? 'household' : 'npc');
  const sim: SimEntity = {
    kind: 'sim',
    id,
    placeId,
    role,
    npcDefId: opts.npcDefId ?? null,
    transform: { x: opts.x, y: opts.y, zFloor: 0, facing: 0 },
    identity: {
      firstName: opts.firstName,
      lastName: opts.lastName,
      ageStage: 'adult',
    },
    visual: {
      bodyPreset: opts.visual?.bodyPreset ?? 'body_a',
      hairPreset: opts.visual?.hairPreset ?? 'hair_short',
      outfitPreset: opts.visual?.outfitPreset ?? 'outfit_casual',
      skinTone: opts.visual?.skinTone ?? 'tone_3',
    },
    anim: { clip: 'idle', frame: 0, facing: 0 },
    needs: { ...DEFAULT_NEEDS },
    mood: { value: 50, modifiers: [] },
    skills: {
      cooking: 0,
      charisma: 0,
      fitness: 0,
      logic: 0,
      creativity: 0,
    },
    traits: { ids: opts.traits ?? [] },
    aspiration: {
      defId: opts.aspirationId ?? 'aspiration.friendly',
      progress: 0,
      completedMilestones: [],
    },
    career: { trackId: null, level: 0, performance: 50, daysWorked: 0 },
    inventory: { held: null },
    queue: { items: [] },
    action: { kind: 'idle' },
    path: { waypoints: [], index: 0, speed: 0.15 },
    autonomy: { nextPlanTick: 0, cooldownUntil: 0 },
    presence: 'on_lot',
    socialLock: null,
  };
  world.entities.set(id, sim);
  if (householdMember && role === 'household') {
    world.household.memberIds.push(id);
    if (!world.ui.selectedSimId) world.ui.selectedSimId = id;
  }
  return sim;
}

export function spawnObject(
  world: World,
  def: ObjectDef,
  x: number,
  y: number,
  rot: 0 | 1 | 2 | 3 = 0,
  placeId?: string,
): ObjectEntity | null {
  const id = allocId(world);
  const pid = placeId ?? world.neighborhood.activePlaceId;
  const obj: ObjectEntity = {
    kind: 'object',
    id,
    placeId: pid,
    transform: { x, y, zFloor: 0, rot },
    defId: def.id,
    quality: 5,
    dirtiness: 0,
    powered: def.startsPowered !== false,
    state: def.states[0] ?? 'default',
    footprint: { ...def.footprint },
    blocksPath: def.blocksPath,
    slots: def.slots.map((s) => ({
      slotId: s.id,
      reservedBy: null,
      reservedUntilTick: 0,
    })),
  };
  world.entities.set(id, obj);
  refreshPlaceCaches(world, pid);
  if (pid === world.neighborhood.activePlaceId) {
    world.lot = world.lots[pid]!;
  }
  return obj;
}

export function debugSpawnHousehold(world: World, content: ContentPack): void {
  world.household.name = 'Demo Household';
  world.household.funds = 25000;

  furnishNeighborhood(world, content);

  const a = spawnSim(world, {
    firstName: 'Alex',
    lastName: 'Rivera',
    x: 12,
    y: 14,
    placeId: 'home',
    traits: ['trait.cheerful'],
    aspirationId: 'aspiration.friendly',
    visual: {
      bodyPreset: 'body_a',
      hairPreset: 'hair_short',
      outfitPreset: 'outfit_casual',
      skinTone: 'tone_3',
    },
  });
  const b = spawnSim(world, {
    firstName: 'Jordan',
    lastName: 'Lee',
    x: 15,
    y: 14,
    placeId: 'home',
    traits: ['trait.foodie'],
    aspirationId: 'aspiration.master_chef',
    visual: {
      bodyPreset: 'body_b',
      hairPreset: 'hair_long',
      outfitPreset: 'outfit_pro',
      skinTone: 'tone_2',
    },
  });
  a.career = {
    trackId: 'career.office_worker',
    level: 0,
    performance: 55,
    daysWorked: 0,
  };
  b.career = {
    trackId: 'career.chef',
    level: 0,
    performance: 55,
    daysWorked: 0,
  };
  a.autonomy.nextPlanTick = 0;
  b.autonomy.nextPlanTick = 1;
  ensureRelationship(world.relationships, a.id, b.id);
  const edge = world.relationships.find(
    (e) =>
      (e.a === a.id && e.b === b.id) || (e.a === b.id && e.b === a.id),
  );
  if (edge) edge.friendship = 40;

  world.neighborhood.activePlaceId = 'home';
  world.lot = world.lots.home!;
  refreshLotCaches(world);
}
