import { decode, encode } from '@msgpack/msgpack';
import { SAVE_SCHEMA_VERSION } from '@lifesim/shared';
import { createClock } from './clock.js';
import { createLot, recomputeLotDerived, type LotState } from './lot.js';
import { createNeighborhood, refreshPlaceCaches } from './neighborhood.js';
import { getObs } from './observability/hub.js';
import type { ObjectEntity, SimEntity, World } from './types.js';
import { allObjects, allSims } from './world.js';

export type SaveGameV1 = {
  schemaVersion: number;
  household: World['household'];
  clock: World['clock'];
  weather: World['weather'];
  rng: World['rng'];
  playTimeSeconds: number;
  neighborhood?: World['neighborhood'];
  lots?: Record<
    string,
    {
      id: string;
      width: number;
      height: number;
      floorCover: number[];
      walls: LotState['walls'];
      entryMarkers: LotState['entryMarkers'];
    }
  >;
  /** Legacy single-lot save */
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

function packLot(lot: LotState) {
  return {
    id: lot.id,
    width: lot.width,
    height: lot.height,
    floorCover: Array.from(lot.floorCover),
    walls: lot.walls,
    entryMarkers: lot.entryMarkers,
  };
}

function unpackLot(data: {
  id: string;
  width: number;
  height: number;
  floorCover: number[];
  walls: LotState['walls'];
  entryMarkers: LotState['entryMarkers'];
}): LotState {
  const lot = createLot(data.width, data.height, data.id);
  lot.floorCover = Uint16Array.from(data.floorCover);
  lot.walls = data.walls;
  lot.entryMarkers = data.entryMarkers;
  recomputeLotDerived(lot, []);
  return lot;
}

export function serializeWorld(world: World): Uint8Array {
  const obs = getObs();
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const lots: SaveGameV1['lots'] = {};
  for (const [id, lot] of Object.entries(world.lots)) {
    lots[id] = packLot(lot);
  }
  const save: SaveGameV1 = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    household: world.household,
    clock: world.clock,
    weather: world.weather,
    rng: { ...world.rng },
    playTimeSeconds: world.playTimeSeconds,
    neighborhood: world.neighborhood,
    lots,
    lot: {
      ...packLot(world.lot),
      objects: allObjects(world),
    },
    entities: { sims: allSims(world) },
    relationships: world.relationships,
  };
  const bytes = encode(save);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  obs.metrics.observe('save.serialize.ms', t1 - t0);
  obs.metrics.observe('save.bytes', bytes.byteLength);
  obs.event('save.serialize', 'save', {
    bytes: bytes.byteLength,
    ms: Math.round((t1 - t0) * 100) / 100,
    sims: save.entities.sims.length,
    objects: save.lot.objects.length,
  });
  return bytes;
}

export function deserializeWorld(bytes: Uint8Array): World {
  const obs = getObs();
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const raw = decode(bytes) as SaveGameV1;
  let data = raw;
  if (data.schemaVersion < SAVE_SCHEMA_VERSION) {
    data = migrate(data);
  }

  const built = createNeighborhood();
  // Always start from the full city atlas so old saves gain new places.
  let lots: Record<string, typeof built.lots[string]> = { ...built.lots };
  let neighborhood = built.neighborhood;

  if (data.lots && Object.keys(data.lots).length > 0) {
    for (const [id, packed] of Object.entries(data.lots)) {
      lots[id] = unpackLot(packed);
    }
  } else if (data.lot) {
    // Legacy: only one lot in save — keep player edits on that lot
    lots[data.lot.id] = unpackLot(data.lot);
  }

  if (data.neighborhood) {
    const saved = data.neighborhood as typeof neighborhood;
    // Union place list: city atlas + any save-only custom places
    const byId = new Map(neighborhood.places.map((p) => [p.id, p]));
    for (const p of saved.places) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    neighborhood = {
      places: [...byId.values()],
      activePlaceId: saved.activePlaceId || neighborhood.activePlaceId,
      homePlaceId: saved.homePlaceId || neighborhood.homePlaceId,
    };
  }

  const active = neighborhood.activePlaceId;
  if (!lots[active]) {
    neighborhood.activePlaceId = Object.keys(lots)[0] ?? 'home';
  }

  const world: World = {
    nextId: 1,
    entities: new Map(),
    relationships: data.relationships ?? [],
    lot: lots[neighborhood.activePlaceId]!,
    lots,
    neighborhood,
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
    if (!sim.placeId) sim.placeId = neighborhood.homePlaceId;
    // Legacy saves predating NPC roles
    if ((sim as { role?: string }).role !== 'household' && (sim as { role?: string }).role !== 'npc') {
      (sim as { role: string }).role = data.household.memberIds.includes(sim.id)
        ? 'household'
        : 'npc';
    }
    if ((sim as { npcDefId?: string | null }).npcDefId === undefined) {
      (sim as { npcDefId: string | null }).npcDefId = null;
    }
    world.entities.set(sim.id, sim);
    world.nextId = Math.max(world.nextId, sim.id + 1);
  }
  for (const obj of data.lot.objects) {
    if (!obj.placeId) obj.placeId = neighborhood.homePlaceId;
    world.entities.set(obj.id, obj);
    world.nextId = Math.max(world.nextId, obj.id + 1);
  }

  for (const placeId of Object.keys(world.lots)) {
    refreshPlaceCaches(world, placeId);
  }
  world.lot = world.lots[world.neighborhood.activePlaceId]!;

  world.ui.selectedSimId = world.household.memberIds[0] ?? null;
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  obs.metrics.observe('save.deserialize.ms', t1 - t0);
  obs.event('save.deserialize', 'save', {
    ms: Math.round((t1 - t0) * 100) / 100,
    schemaVersion: data.schemaVersion,
    sims: data.entities.sims.length,
  });
  return world;
}

function migrate(data: SaveGameV1): SaveGameV1 {
  return { ...data, schemaVersion: SAVE_SCHEMA_VERSION };
}

export function saveToLocalStorage(slotId: string, world: World, name: string): void {
  if (!storageAvailable()) {
    console.warn('localStorage unavailable; save skipped');
    return;
  }
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
  if (!storageAvailable()) return null;
  const raw = localStorage.getItem(`lifesim_save_${slotId}`);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { body: string };
  const bytes = base64ToUint8(parsed.body);
  return deserializeWorld(bytes);
}

function storageAvailable(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const k = '__lifesim_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
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
    if (!storageAvailable()) return [];
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
