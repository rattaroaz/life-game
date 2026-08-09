import { decode, encode } from '@msgpack/msgpack';
import { SAVE_SCHEMA_VERSION } from '@lifesim/shared';
import { createClock } from './clock.js';
import { createLot, recomputeLotDerived } from './lot.js';
import type { ObjectEntity, SimEntity, World } from './types.js';
import { allObjects, allSims } from './world.js';

export type SaveGameV1 = {
  schemaVersion: number;
  household: World['household'];
  clock: World['clock'];
  weather: World['weather'];
  rng: World['rng'];
  playTimeSeconds: number;
  lot: {
    id: string;
    width: number;
    height: number;
    floorCover: number[];
    walls: World['lot']['walls'];
    entryMarkers: World['lot']['entryMarkers'];
    objects: ObjectEntity[];
  };
  entities: { sims: SimEntity[] };
  relationships: World['relationships'];
};

export function serializeWorld(world: World): Uint8Array {
  const save: SaveGameV1 = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    household: world.household,
    clock: world.clock,
    weather: world.weather,
    rng: { ...world.rng },
    playTimeSeconds: world.playTimeSeconds,
    lot: {
      id: world.lot.id,
      width: world.lot.width,
      height: world.lot.height,
      floorCover: Array.from(world.lot.floorCover),
      walls: world.lot.walls,
      entryMarkers: world.lot.entryMarkers,
      objects: allObjects(world),
    },
    entities: { sims: allSims(world) },
    relationships: world.relationships,
  };
  return encode(save);
}

export function deserializeWorld(bytes: Uint8Array): World {
  const raw = decode(bytes) as SaveGameV1;
  let data = raw;
  if (data.schemaVersion < SAVE_SCHEMA_VERSION) {
    data = migrate(data);
  }

  const lot = createLot(data.lot.width, data.lot.height, data.lot.id);
  lot.floorCover = Uint16Array.from(data.lot.floorCover);
  lot.walls = data.lot.walls;
  lot.entryMarkers = data.lot.entryMarkers;

  const world: World = {
    nextId: 1,
    entities: new Map(),
    relationships: data.relationships ?? [],
    lot,
    household: data.household,
    clock: data.clock ?? createClock(),
    rng: data.rng,
    mode: 'live',
    weather: data.weather ?? 'sunny',
    ui: {
      selectedSimId: null,
      targetEntityId: null,
      hoverEntityId: null,
      modeTool: null,
      buyGhost: null,
    },
    eventBus: [],
    playTimeSeconds: data.playTimeSeconds ?? 0,
  };

  for (const sim of data.entities.sims) {
    world.entities.set(sim.id, sim);
    world.nextId = Math.max(world.nextId, sim.id + 1);
  }
  for (const obj of data.lot.objects) {
    world.entities.set(obj.id, obj);
    world.nextId = Math.max(world.nextId, obj.id + 1);
  }

  recomputeLotDerived(
    world.lot,
    allObjects(world).map((o) => ({
      x: o.transform.x,
      y: o.transform.y,
      w: o.footprint.w,
      h: o.footprint.h,
      blocksPath: o.blocksPath,
      id: o.id,
    })),
  );

  world.ui.selectedSimId = world.household.memberIds[0] ?? null;
  return world;
}

function migrate(data: SaveGameV1): SaveGameV1 {
  // Future migrations; v1 identity for now
  return { ...data, schemaVersion: SAVE_SCHEMA_VERSION };
}

export function saveToLocalStorage(slotId: string, world: World, name: string): void {
  const body = serializeWorld(world);
  const meta = {
    id: slotId,
    name,
    householdName: world.household.name,
    playTimeSeconds: world.playTimeSeconds,
    schemaVersion: SAVE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  };
  const b64 = uint8ToBase64(body);
  localStorage.setItem(`lifesim_save_${slotId}`, JSON.stringify({ meta, body: b64 }));
  const list = listLocalSaves();
  const filtered = list.filter((m) => m.id !== slotId);
  filtered.push(meta);
  localStorage.setItem('lifesim_saves_index', JSON.stringify(filtered));
}

export function loadFromLocalStorage(slotId: string): World | null {
  const raw = localStorage.getItem(`lifesim_save_${slotId}`);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { body: string };
  const bytes = base64ToUint8(parsed.body);
  return deserializeWorld(bytes);
}

export function listLocalSaves(): {
  id: string;
  name: string;
  householdName: string;
  playTimeSeconds: number;
  schemaVersion: number;
  updatedAt: string;
}[] {
  try {
    const raw = localStorage.getItem('lifesim_saves_index');
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
