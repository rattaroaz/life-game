import { createClock } from './clock.js';
import { createLot, recomputeLotDerived, type FootprintStamp } from './lot.js';
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
  return {
    nextId: 1,
    entities: new Map(),
    relationships: [],
    lot: createLot(32, 32),
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

export function stampObjects(world: World): FootprintStamp[] {
  return allObjects(world).map((o) => ({
    x: o.transform.x,
    y: o.transform.y,
    w: o.footprint.w,
    h: o.footprint.h,
    blocksPath: o.blocksPath,
    id: o.id,
  }));
}

export function refreshLotCaches(world: World): void {
  recomputeLotDerived(world.lot, stampObjects(world));
}

export function spawnSim(
  world: World,
  opts: {
    firstName: string;
    lastName: string;
    x: number;
    y: number;
    visual?: Partial<SimVisual>;
    traits?: string[];
    aspirationId?: string;
  },
): SimEntity {
  const id = allocId(world);
  const sim: SimEntity = {
    kind: 'sim',
    id,
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
  world.household.memberIds.push(id);
  if (!world.ui.selectedSimId) world.ui.selectedSimId = id;
  return sim;
}

export function spawnObject(
  world: World,
  def: ObjectDef,
  x: number,
  y: number,
  rot: 0 | 1 | 2 | 3 = 0,
): ObjectEntity | null {
  // Validate approach tiles roughly
  const id = allocId(world);
  const obj: ObjectEntity = {
    kind: 'object',
    id,
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
  refreshLotCaches(world);
  return obj;
}

export function debugSpawnHousehold(world: World, content: ContentPack): void {
  world.household.name = 'Demo Household';
  world.household.funds = 25000;

  const a = spawnSim(world, {
    firstName: 'Alex',
    lastName: 'Rivera',
    x: 12,
    y: 14,
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
    traits: ['trait.foodie'],
    aspirationId: 'aspiration.master_chef',
    visual: {
      bodyPreset: 'body_b',
      hairPreset: 'hair_long',
      outfitPreset: 'outfit_pro',
      skinTone: 'tone_2',
    },
  });
  ensureRelationship(world.relationships, a.id, b.id);
  const edge = world.relationships.find(
    (e) =>
      (e.a === a.id && e.b === b.id) || (e.a === b.id && e.b === a.id),
  );
  if (edge) edge.friendship = 40;

  const place = (id: string, x: number, y: number) => {
    const def = content.objects.find((o) => o.id === id);
    if (def) spawnObject(world, def, x, y);
  };
  place('object.fridge_basic', 9, 9);
  place('object.stove_basic', 11, 9);
  place('object.counter_basic', 10, 9);
  place('object.table_dining', 14, 12);
  place('object.chair_dining', 14, 13);
  place('object.chair_dining', 15, 12);
  place('object.bed_double', 18, 10);
  place('object.toilet_basic', 9, 17);
  place('object.shower_basic', 11, 17);
  place('object.sofa_basic', 16, 16);
  place('object.tv_basic', 16, 18);
  place('object.bookshelf', 19, 16);
  place('object.desk_computer', 20, 12);
  place('object.plant_pot', 13, 10);
  place('object.sink_basic', 10, 17);
}
