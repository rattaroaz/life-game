/**
 * Shared test fixtures — minimal content pack + world helpers.
 * Avoids importing the full catalog for unit tests; integration tests may still use loadBuiltinContent.
 */
import type {
  AspirationDef,
  CareerDef,
  ContentPack,
  InteractionDef,
  ObjectDef,
  TraitDef,
} from '../types.js';
import type { World } from '../types.js';
import { createEmptyWorld, spawnObject, spawnSim } from '../world.js';

export function minimalContent(): ContentPack {
  const objects: ObjectDef[] = [
    {
      id: 'object.fridge_basic',
      nameKey: 'Fridge',
      category: 'appliances',
      price: 400,
      footprint: { w: 1, h: 1 },
      blocksPath: true,
      tags: ['food_source'],
      outdoor: false,
      color: '#4a90d9',
      slots: [
        { id: 'use_front', offset: { x: 0, y: 1 }, facing: 0, tags: ['use'], exclusive: true },
      ],
      interactions: ['interact.fridge_snack', 'interact.fridge_start_meal'],
      states: ['default', 'open'],
    },
    {
      id: 'object.stove_basic',
      nameKey: 'Stove',
      category: 'appliances',
      price: 500,
      footprint: { w: 1, h: 1 },
      blocksPath: true,
      tags: ['cooking', 'surface'],
      outdoor: false,
      color: '#666',
      slots: [
        { id: 'use_front', offset: { x: 0, y: 1 }, facing: 0, tags: ['cook'], exclusive: true },
      ],
      interactions: ['interact.stove_cook'],
      states: ['default'],
    },
    {
      id: 'object.table_dining',
      nameKey: 'Table',
      category: 'surfaces',
      price: 300,
      footprint: { w: 2, h: 2 },
      blocksPath: true,
      tags: ['surface', 'dining'],
      outdoor: false,
      color: '#8b5a2b',
      slots: [
        { id: 'seat_0', offset: { x: 0, y: 2 }, facing: 0, tags: ['eat', 'sit'], exclusive: true },
      ],
      interactions: ['interact.eat_meal'],
      states: ['default'],
    },
    {
      id: 'object.bed_double',
      nameKey: 'Bed',
      category: 'bedroom',
      price: 800,
      footprint: { w: 2, h: 2 },
      blocksPath: true,
      tags: ['sleep'],
      outdoor: false,
      color: '#6b4c8a',
      slots: [
        { id: 'sleep_0', offset: { x: 0, y: 2 }, facing: 0, tags: ['sleep'], exclusive: true },
        { id: 'sleep_1', offset: { x: 1, y: 2 }, facing: 0, tags: ['sleep'], exclusive: true },
      ],
      interactions: ['interact.sleep'],
      states: ['default'],
    },
    {
      id: 'object.toilet_basic',
      nameKey: 'Toilet',
      category: 'bathroom',
      price: 250,
      footprint: { w: 1, h: 1 },
      blocksPath: true,
      tags: ['bathroom'],
      outdoor: false,
      color: '#eee',
      slots: [
        { id: 'use', offset: { x: 0, y: 1 }, facing: 0, tags: ['toilet'], exclusive: true },
      ],
      interactions: ['interact.use_toilet'],
      states: ['default'],
    },
    {
      id: 'object.open_tile',
      nameKey: 'Mat',
      category: 'decor',
      price: 10,
      footprint: { w: 1, h: 1 },
      blocksPath: false,
      tags: ['decor'],
      outdoor: false,
      color: '#333',
      slots: [],
      interactions: [],
      states: ['default'],
    },
  ];

  const interactions: InteractionDef[] = [
    {
      id: 'interact.fridge_snack',
      nameKey: 'Grab snack',
      durationTicks: 3,
      slotTag: 'use',
      outcomes: { needs: { hunger: 20 } },
      autonomyWeight: 1,
      ads: { hunger: 1.5 },
    },
    {
      id: 'interact.fridge_start_meal',
      nameKey: 'Get ingredients',
      durationTicks: 3,
      slotTag: 'use',
      outcomes: { giveHeldItem: 'item.ingredients' },
      chain: {
        nextInteractionId: 'interact.stove_cook',
        requireSurfaceTags: ['cooking'],
      },
      ads: { hunger: 1.5 },
    },
    {
      id: 'interact.stove_cook',
      nameKey: 'Cook',
      durationTicks: 4,
      slotTag: 'cook',
      requires: { heldItem: 'item.ingredients' },
      outcomes: {
        clearHeldItem: true,
        giveHeldItem: 'item.meal',
        skillXp: { cooking: 50 },
      },
      chain: {
        nextInteractionId: 'interact.eat_meal',
        requireSurfaceTags: ['dining'],
      },
    },
    {
      id: 'interact.eat_meal',
      nameKey: 'Eat',
      durationTicks: 4,
      slotTag: 'eat',
      requires: { heldItem: 'item.meal' },
      outcomes: {
        needs: { hunger: 50 },
        clearHeldItem: true,
        moodBuff: { id: 'fed', amount: 10, durationTicks: 60 },
      },
    },
    {
      id: 'interact.sleep',
      nameKey: 'Sleep',
      durationTicks: 5,
      slotTag: 'sleep',
      outcomes: { needs: { energy: 40 } },
      ads: { energy: 2 },
    },
    {
      id: 'interact.use_toilet',
      nameKey: 'Toilet',
      durationTicks: 3,
      slotTag: 'toilet',
      outcomes: { needs: { bladder: 80 } },
      ads: { bladder: 3 },
    },
    {
      id: 'interact.chat',
      nameKey: 'Chat',
      durationTicks: 4,
      social: true,
      outcomes: {
        needs: { social: 20 },
        relationship: { friendship: 10 },
      },
      ads: { social: 1.5 },
    },
    {
      id: 'interact.skill_gated',
      nameKey: 'Pro cook',
      durationTicks: 2,
      slotTag: 'cook',
      requires: { skill: { id: 'cooking', min: 5 } },
      outcomes: { needs: { fun: 5 } },
    },
  ];

  const careers: CareerDef[] = [
    {
      id: 'career.office_worker',
      nameKey: 'Office Worker',
      schedule: { startMinute: 9 * 60, endMinute: 17 * 60, days: [0, 1, 2, 3, 4] },
      levels: [
        { titleKey: 'Clerk', payPerDay: 100 },
        { titleKey: 'Manager', payPerDay: 200, requiredSkill: { id: 'charisma', min: 2 } },
      ],
    },
    {
      id: 'career.chef',
      nameKey: 'Chef',
      schedule: { startMinute: 14 * 60, endMinute: 22 * 60, days: [0, 1, 2, 3, 4, 5] },
      levels: [
        { titleKey: 'Line', payPerDay: 90 },
        { titleKey: 'Head', payPerDay: 180, requiredSkill: { id: 'cooking', min: 2 } },
      ],
    },
  ];

  const traits: TraitDef[] = [
    { id: 'trait.cheerful', nameKey: 'Cheerful', needDecayMult: { fun: 0.8 } },
    { id: 'trait.foodie', nameKey: 'Foodie', needDecayMult: { hunger: 1.2 } },
  ];

  const aspirations: AspirationDef[] = [
    {
      id: 'aspiration.friendly',
      nameKey: 'Friendly',
      milestones: [{ id: 'm1', descriptionKey: 'Socialize', target: 10 }],
    },
    {
      id: 'aspiration.master_chef',
      nameKey: 'Chef',
      milestones: [{ id: 'm1', descriptionKey: 'Cook', target: 10 }],
    },
  ];

  return { objects, interactions, careers, traits, aspirations };
}

export function makeTestWorld(seed = 42): World {
  return createEmptyWorld(seed);
}

export function spawnTestPair(
  world: World,
  content: ContentPack,
  opts?: { withKitchen?: boolean },
): { simA: number; simB: number } {
  const home = world.neighborhood?.homePlaceId ?? 'home';
  // Ensure home lot exists for minimal worlds
  if (!world.neighborhood) {
    (world as World).neighborhood = {
      places: [{ id: 'home', name: 'Home', kind: 'home', ground: 'wood', description: '', exits: [] }],
      activePlaceId: 'home',
      homePlaceId: 'home',
    };
  }
  if (!world.lots) {
    world.lots = { [world.lot.id]: world.lot };
  }
  const a = spawnSim(world, {
    firstName: 'Ada',
    lastName: 'Test',
    x: 12,
    y: 14,
    placeId: home,
    traits: ['trait.cheerful'],
  });
  const b = spawnSim(world, {
    firstName: 'Bob',
    lastName: 'Test',
    x: 14,
    y: 14,
    placeId: home,
    traits: ['trait.foodie'],
  });
  if (opts?.withKitchen !== false) {
    const fridge = content.objects.find((o) => o.id === 'object.fridge_basic')!;
    const stove = content.objects.find((o) => o.id === 'object.stove_basic')!;
    const table = content.objects.find((o) => o.id === 'object.table_dining')!;
    const bed = content.objects.find((o) => o.id === 'object.bed_double')!;
    const toilet = content.objects.find((o) => o.id === 'object.toilet_basic')!;
    spawnObject(world, fridge, 10, 10, 0, home);
    spawnObject(world, stove, 12, 10, 0, home);
    spawnObject(world, table, 14, 12, 0, home);
    spawnObject(world, bed, 18, 10, 0, home);
    spawnObject(world, toilet, 10, 16, 0, home);
  }
  return { simA: a.id, simB: b.id };
}

/** Advance sim N ticks (live, unpaused, speed 1). */
export function tick(world: World, content: ContentPack, n: number, run: (w: World, c: ContentPack) => void): void {
  world.mode = 'live';
  world.clock.paused = false;
  world.clock.speed = 1;
  for (let i = 0; i < n; i++) run(world, content);
}
