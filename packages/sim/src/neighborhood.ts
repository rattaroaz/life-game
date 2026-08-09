/**
 * Full small-city neighborhood: homes, shops, offices, roads, sidewalks.
 * Each place is a separate view; Sims travel via the City map (or autonomy).
 */
import {
  cellIndex,
  createLot,
  recomputeLotDerived,
  type LotState,
  type WallEdge,
} from './lot.js';
import type { ContentPack, ObjectDef, ObjectEntity, World } from './types.js';

export type PlaceKind =
  | 'home'
  | 'residential'
  | 'street'
  | 'park'
  | 'cafe'
  | 'restaurant'
  | 'market'
  | 'shop'
  | 'office'
  | 'clinic'
  | 'gym'
  | 'salon'
  | 'library'
  | 'school'
  | 'plaza'
  | 'convenience';

export type PlaceExit = {
  to: string;
  label: string;
  x: number;
  y: number;
};

export type PlaceMeta = {
  id: string;
  name: string;
  kind: PlaceKind;
  ground: 'grass' | 'wood' | 'stone' | 'sand' | 'tile' | 'asphalt';
  description: string;
  exits: PlaceExit[];
};

export type NeighborhoodState = {
  places: PlaceMeta[];
  activePlaceId: string;
  homePlaceId: string;
};

/**
 * Floor cover ids (renderer):
 * 1 grass · 2 wood · 3 stone · 4 sand · 5 tile · 6 exit
 * 7 asphalt · 8 sidewalk · 9 crosswalk
 */
const F = {
  grass: 1,
  wood: 2,
  stone: 3,
  sand: 4,
  tile: 5,
  exit: 6,
  asphalt: 7,
  sidewalk: 8,
  crosswalk: 9,
} as const;

/** Full city roster */
export const CITY_PLACES: PlaceMeta[] = [
  // —— Residential ——
  {
    id: 'home',
    name: 'Rivera House',
    kind: 'home',
    ground: 'wood',
    description: 'Your household',
    exits: [
      { to: 'street_oak', label: 'Oak Street', x: 15, y: 34 },
      { to: 'park', label: 'Park (side)', x: 2, y: 16 },
    ],
  },
  {
    id: 'house_chen',
    name: 'Chen Residence',
    kind: 'residential',
    ground: 'wood',
    description: 'Neighbor family home',
    exits: [{ to: 'street_oak', label: 'Oak Street', x: 15, y: 34 }],
  },
  {
    id: 'house_park',
    name: 'Park Residence',
    kind: 'residential',
    ground: 'wood',
    description: 'Neighbor home with a big porch vibe',
    exits: [{ to: 'street_oak', label: 'Oak Street', x: 15, y: 34 }],
  },
  {
    id: 'house_okonkwo',
    name: 'Okonkwo Home',
    kind: 'residential',
    ground: 'wood',
    description: 'Corner house on Maple',
    exits: [{ to: 'street_maple', label: 'Maple Ave', x: 15, y: 34 }],
  },
  {
    id: 'house_diaz',
    name: 'Diaz Cottage',
    kind: 'residential',
    ground: 'wood',
    description: 'Cozy cottage near the park',
    exits: [
      { to: 'street_maple', label: 'Maple Ave', x: 15, y: 34 },
      { to: 'park', label: 'Park', x: 28, y: 16 },
    ],
  },
  // —— Streets / plaza ——
  {
    id: 'street_oak',
    name: 'Oak Street',
    kind: 'street',
    ground: 'asphalt',
    description: 'Residential street with sidewalks and driveways',
    exits: [
      { to: 'home', label: 'Rivera House', x: 6, y: 8 },
      { to: 'house_chen', label: 'Chen House', x: 14, y: 8 },
      { to: 'house_park', label: 'Park House', x: 22, y: 8 },
      { to: 'plaza', label: 'Town Plaza', x: 16, y: 34 },
      { to: 'street_maple', label: 'Maple Ave', x: 34, y: 18 },
      { to: 'convenience', label: 'Quick Mart', x: 28, y: 28 },
    ],
  },
  {
    id: 'street_maple',
    name: 'Maple Avenue',
    kind: 'street',
    ground: 'asphalt',
    description: 'Busier avenue toward downtown',
    exits: [
      { to: 'street_oak', label: 'Oak Street', x: 2, y: 18 },
      { to: 'plaza', label: 'Town Plaza', x: 16, y: 2 },
      { to: 'house_okonkwo', label: 'Okonkwo Home', x: 8, y: 8 },
      { to: 'house_diaz', label: 'Diaz Cottage', x: 24, y: 8 },
      { to: 'school', label: 'School', x: 30, y: 18 },
      { to: 'clinic', label: 'Clinic', x: 16, y: 34 },
    ],
  },
  {
    id: 'plaza',
    name: 'Town Plaza',
    kind: 'plaza',
    ground: 'stone',
    description: 'Downtown square — shops and offices all around',
    exits: [
      { to: 'street_oak', label: 'Oak Street', x: 16, y: 2 },
      { to: 'street_maple', label: 'Maple Ave', x: 2, y: 16 },
      { to: 'cafe', label: 'Corner Cafe', x: 28, y: 10 },
      { to: 'restaurant', label: 'Bistro Luna', x: 28, y: 22 },
      { to: 'market', label: 'Market Hall', x: 10, y: 30 },
      { to: 'boutique', label: 'Thread & Needle', x: 22, y: 30 },
      { to: 'office', label: 'Office Tower', x: 6, y: 10 },
      { to: 'gym', label: 'Iron Gym', x: 6, y: 22 },
      { to: 'library', label: 'Library', x: 30, y: 16 },
      { to: 'salon', label: 'Glow Salon', x: 16, y: 30 },
      { to: 'park', label: 'Central Park', x: 16, y: 6 },
    ],
  },
  {
    id: 'park',
    name: 'Central Park',
    kind: 'park',
    ground: 'grass',
    description: 'Paths, benches, and open green',
    exits: [
      { to: 'plaza', label: 'Plaza', x: 16, y: 34 },
      { to: 'home', label: 'Rivera side gate', x: 2, y: 16 },
      { to: 'house_diaz', label: 'Diaz gate', x: 30, y: 16 },
      { to: 'street_oak', label: 'Oak Street', x: 16, y: 2 },
    ],
  },
  // —— Businesses ——
  {
    id: 'cafe',
    name: 'Corner Cafe',
    kind: 'cafe',
    ground: 'tile',
    description: 'Coffee, pastries, chatter',
    exits: [{ to: 'plaza', label: 'Plaza', x: 2, y: 16 }],
  },
  {
    id: 'restaurant',
    name: 'Bistro Luna',
    kind: 'restaurant',
    ground: 'tile',
    description: 'Sit-down meals and evening vibes',
    exits: [{ to: 'plaza', label: 'Plaza', x: 2, y: 16 }],
  },
  {
    id: 'market',
    name: 'Market Hall',
    kind: 'market',
    ground: 'stone',
    description: 'Groceries and bulk goods',
    exits: [{ to: 'plaza', label: 'Plaza', x: 16, y: 2 }],
  },
  {
    id: 'boutique',
    name: 'Thread & Needle',
    kind: 'shop',
    ground: 'tile',
    description: 'Clothes and lifestyle shopping',
    exits: [{ to: 'plaza', label: 'Plaza', x: 16, y: 2 }],
  },
  {
    id: 'convenience',
    name: 'Quick Mart',
    kind: 'convenience',
    ground: 'tile',
    description: 'Late-night snacks on Oak Street',
    exits: [{ to: 'street_oak', label: 'Oak Street', x: 2, y: 16 }],
  },
  {
    id: 'office',
    name: 'Harbor Office Tower',
    kind: 'office',
    ground: 'tile',
    description: 'Cubicles, meetings, water cooler',
    exits: [{ to: 'plaza', label: 'Plaza', x: 16, y: 34 }],
  },
  {
    id: 'clinic',
    name: 'Maple Clinic',
    kind: 'clinic',
    ground: 'tile',
    description: 'Checkups and calm waiting rooms',
    exits: [{ to: 'street_maple', label: 'Maple Ave', x: 16, y: 2 }],
  },
  {
    id: 'gym',
    name: 'Iron Gym',
    kind: 'gym',
    ground: 'tile',
    description: 'Mats, music, sweat',
    exits: [{ to: 'plaza', label: 'Plaza', x: 30, y: 16 }],
  },
  {
    id: 'salon',
    name: 'Glow Salon',
    kind: 'salon',
    ground: 'tile',
    description: 'Chairs, mirrors, self-care',
    exits: [{ to: 'plaza', label: 'Plaza', x: 16, y: 2 }],
  },
  {
    id: 'library',
    name: 'City Library',
    kind: 'library',
    ground: 'wood',
    description: 'Stacks, study desks, quiet hours',
    exits: [{ to: 'plaza', label: 'Plaza', x: 2, y: 16 }],
  },
  {
    id: 'school',
    name: 'Maple Elementary',
    kind: 'school',
    ground: 'tile',
    description: 'Classrooms and playground edge',
    exits: [{ to: 'street_maple', label: 'Maple Ave', x: 2, y: 16 }],
  },
];

function fillRect(
  lot: LotState,
  x0: number,
  y0: number,
  w: number,
  h: number,
  cover: number,
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && y >= 0 && x < lot.width && y < lot.height) {
        lot.floorCover[cellIndex(lot, x, y)] = cover;
      }
    }
  }
}

function rectWalls(
  lot: LotState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  door?: { x: number; y: number; dir: 'h' | 'v' },
  window?: { x: number; y: number; dir: 'h' | 'v' },
): void {
  const walls: WallEdge[] = [];
  for (let x = x0; x < x1; x++) {
    walls.push({ x, y: y0, dir: 'h', kind: 'wall' });
    walls.push({ x, y: y1, dir: 'h', kind: 'wall' });
  }
  for (let y = y0; y < y1; y++) {
    walls.push({ x: x0, y, dir: 'v', kind: 'wall' });
    walls.push({ x: x1, y, dir: 'v', kind: 'wall' });
  }
  let result = walls;
  if (door) {
    result = result.filter(
      (w) => !(w.x === door.x && w.y === door.y && w.dir === door.dir),
    );
    result.push({ ...door, kind: 'door' });
  }
  if (window) {
    result = result.filter(
      (w) => !(w.x === window.x && w.y === window.y && w.dir === window.dir),
    );
    result.push({ ...window, kind: 'window' });
  }
  lot.walls.push(...result);
}

/** Horizontal road band with sidewalks on both sides */
function paintRoadEW(lot: LotState, yCenter: number, roadH = 4): void {
  const y0 = yCenter - Math.floor(roadH / 2);
  fillRect(lot, 0, y0 - 1, lot.width, 1, F.sidewalk);
  fillRect(lot, 0, y0, lot.width, roadH, F.asphalt);
  fillRect(lot, 0, y0 + roadH, lot.width, 1, F.sidewalk);
  // Crosswalks every ~10 tiles
  for (let x = 4; x < lot.width; x += 10) {
    fillRect(lot, x, y0, 2, roadH, F.crosswalk);
  }
}

/** Vertical road band with sidewalks */
function paintRoadNS(lot: LotState, xCenter: number, roadW = 4): void {
  const x0 = xCenter - Math.floor(roadW / 2);
  fillRect(lot, x0 - 1, 0, 1, lot.height, F.sidewalk);
  fillRect(lot, x0, 0, roadW, lot.height, F.asphalt);
  fillRect(lot, x0 + roadW, 0, 1, lot.height, F.sidewalk);
  for (let y = 4; y < lot.height; y += 10) {
    fillRect(lot, x0, y, roadW, 2, F.crosswalk);
  }
}

/** Decorative building shell (street facade) — walkable edges, blocked interior feel via walls */
function paintFacade(
  lot: LotState,
  x0: number,
  y0: number,
  w: number,
  h: number,
  doorX: number,
  doorY: number,
  doorDir: 'h' | 'v',
): void {
  fillRect(lot, x0, y0, w, h, F.stone);
  rectWalls(
    lot,
    x0,
    y0,
    x0 + w,
    y0 + h,
    { x: doorX, y: doorY, dir: doorDir },
    { x: x0 + 2, y: y0, dir: 'h' },
  );
}

function paintHouseLot(
  lot: LotState,
  opts: { doorX?: number; colorWood?: boolean } = {},
): void {
  // Yard grass
  fillRect(lot, 0, 0, lot.width, lot.height, F.grass);
  // Street edge at bottom — sidewalk + strip of asphalt
  fillRect(lot, 0, lot.height - 3, lot.width, 2, F.asphalt);
  fillRect(lot, 0, lot.height - 4, lot.width, 1, F.sidewalk);
  // Driveway to street
  fillRect(lot, 20, 22, 4, lot.height - 22, F.asphalt);
  fillRect(lot, 20, 21, 4, 1, F.sidewalk);
  // Front walk from door to sidewalk
  fillRect(lot, 13, 20, 3, lot.height - 24, F.sidewalk);
  // Side yard path
  fillRect(lot, 2, 14, 2, 10, F.sidewalk);
  // House footprint
  fillRect(lot, 8, 8, 16, 12, F.wood);
  const doorX = opts.doorX ?? 14;
  rectWalls(lot, 8, 8, 24, 20, { x: doorX, y: 20, dir: 'h' }, { x: 12, y: 8, dir: 'h' });
  lot.walls.push({ x: 18, y: 8, dir: 'h', kind: 'window' });
  lot.walls.push({ x: 10, y: 14, dir: 'v', kind: 'window' });
  lot.entryMarkers = [{ x: doorX, y: 21 }];
}

function paintShopInterior(
  lot: LotState,
  door: { x: number; y: number; dir: 'h' | 'v' },
): void {
  // Exterior sidewalk / street apron
  fillRect(lot, 0, 0, lot.width, lot.height, F.sidewalk);
  fillRect(lot, 0, 0, lot.width, 3, F.asphalt);
  fillRect(lot, 0, lot.height - 3, lot.width, 3, F.asphalt);
  fillRect(lot, 0, 3, lot.width, 1, F.sidewalk);
  fillRect(lot, 0, lot.height - 4, lot.width, 1, F.sidewalk);
  // Shop floor
  fillRect(lot, 6, 6, 24, 20, F.tile);
  rectWalls(lot, 6, 6, 30, 26, door, { x: 12, y: 6, dir: 'h' });
  lot.walls.push({ x: 20, y: 6, dir: 'h', kind: 'window' });
  lot.entryMarkers = [
    door.dir === 'h'
      ? { x: door.x, y: door.y === 6 ? 5 : door.y + 1 }
      : { x: door.x === 6 ? 5 : door.x + 1, y: door.y },
  ];
}

/** Build geometry for one city place */
export function buildPlaceLot(place: PlaceMeta): LotState {
  const size = place.kind === 'street' || place.kind === 'plaza' || place.kind === 'park' ? 36 : 32;
  const lot = createLot(size, size, place.id);
  lot.walls = [];

  // Base fill
  const base =
    place.ground === 'asphalt'
      ? F.grass
      : place.ground === 'grass'
        ? F.grass
        : place.ground === 'wood'
          ? F.grass
          : place.ground === 'stone'
            ? F.stone
            : F.tile;
  for (let i = 0; i < lot.floorCover.length; i++) lot.floorCover[i] = base;

  switch (place.kind) {
    case 'home':
    case 'residential':
      paintHouseLot(lot);
      break;
    case 'street':
      fillRect(lot, 0, 0, lot.width, lot.height, F.grass);
      if (place.id === 'street_oak') {
        // Main residential road + dual sidewalks
        paintRoadEW(lot, 20, 5);
        // Continuous sidewalks north of road (parcel frontage)
        fillRect(lot, 0, 14, lot.width, 2, F.sidewalk);
        fillRect(lot, 0, 26, lot.width, 1, F.sidewalk);
        // Three house parcels north of road (driveways + front walks)
        for (const hx of [4, 12, 20]) {
          fillRect(lot, hx, 4, 7, 6, F.wood); // house pad
          fillRect(lot, hx + 2, 10, 2, 4, F.sidewalk); // front walk
          fillRect(lot, hx + 5, 10, 2, 8, F.asphalt); // driveway
        }
        // Corner convenience pad south-east
        fillRect(lot, 26, 26, 8, 6, F.tile);
        fillRect(lot, 26, 25, 8, 1, F.sidewalk);
        // Lawn strips between parcels
        fillRect(lot, 0, 0, lot.width, 3, F.grass);
        lot.entryMarkers = [{ x: 16, y: 20 }];
      } else {
        // Maple — busier cross avenue
        paintRoadNS(lot, 18, 5);
        paintRoadEW(lot, 20, 4);
        // Crosswalk at intersection (already from paint helpers)
        // North parcels (homes)
        for (const hx of [4, 24]) {
          fillRect(lot, hx, 4, 7, 6, F.wood);
          fillRect(lot, hx + 2, 10, 2, 6, F.sidewalk);
        }
        // School / clinic pads on south & east
        fillRect(lot, 26, 14, 8, 6, F.tile);
        fillRect(lot, 10, 28, 12, 5, F.tile);
        fillRect(lot, 0, 14, 2, lot.height - 14, F.sidewalk);
        fillRect(lot, lot.width - 2, 0, 2, lot.height, F.sidewalk);
        lot.entryMarkers = [{ x: 18, y: 20 }];
      }
      break;
    case 'plaza':
      fillRect(lot, 0, 0, lot.width, lot.height, F.sidewalk);
      // Ring roads around the square
      paintRoadEW(lot, 6, 3);
      paintRoadEW(lot, 30, 3);
      paintRoadNS(lot, 6, 3);
      paintRoadNS(lot, 30, 3);
      // Central plaza stones + fountain pad
      fillRect(lot, 10, 10, 16, 16, F.stone);
      fillRect(lot, 14, 14, 8, 8, F.sidewalk);
      fillRect(lot, 16, 16, 4, 4, F.sand); // fountain / planter
      // Shop fronts on each edge of the square (decorative facades)
      paintFacade(lot, 10, 2, 5, 3, 12, 5, 'h'); // north cafe-ish
      paintFacade(lot, 22, 2, 5, 3, 24, 5, 'h');
      paintFacade(lot, 2, 12, 3, 5, 5, 14, 'v'); // west office
      paintFacade(lot, 2, 20, 3, 5, 5, 22, 'v'); // west gym
      paintFacade(lot, 31, 12, 3, 5, 31, 14, 'v'); // east library
      paintFacade(lot, 10, 31, 5, 3, 12, 31, 'h'); // south market
      paintFacade(lot, 18, 31, 5, 3, 20, 31, 'h'); // south salon
      paintFacade(lot, 24, 31, 5, 3, 26, 31, 'h'); // south boutique
      lot.entryMarkers = [{ x: 18, y: 18 }];
      break;
    case 'park':
      fillRect(lot, 0, 0, lot.width, lot.height, F.grass);
      // Perimeter path + cross paths
      fillRect(lot, 2, 2, lot.width - 4, 2, F.sidewalk);
      fillRect(lot, 2, lot.height - 4, lot.width - 4, 2, F.sidewalk);
      fillRect(lot, 2, 2, 2, lot.height - 4, F.sidewalk);
      fillRect(lot, lot.width - 4, 2, 2, lot.height - 4, F.sidewalk);
      fillRect(lot, 16, 2, 3, lot.height - 4, F.sidewalk);
      fillRect(lot, 2, 16, lot.width - 4, 3, F.sidewalk);
      // Play areas
      fillRect(lot, 8, 8, 5, 5, F.sand);
      fillRect(lot, 22, 22, 6, 6, F.sand);
      fillRect(lot, 22, 8, 4, 4, F.sand);
      // Small pond edge (stone)
      fillRect(lot, 8, 22, 5, 4, F.stone);
      lot.entryMarkers = [{ x: 17, y: 17 }];
      break;
    case 'cafe':
    case 'restaurant':
    case 'salon':
    case 'shop':
    case 'convenience':
      paintShopInterior(lot, { x: 16, y: 26, dir: 'h' });
      break;
    case 'market':
      fillRect(lot, 0, 0, lot.width, lot.height, F.stone);
      fillRect(lot, 4, 6, 24, 18, F.tile);
      rectWalls(lot, 4, 6, 28, 24, { x: 16, y: 6, dir: 'h' });
      lot.entryMarkers = [{ x: 16, y: 5 }];
      break;
    case 'office':
    case 'clinic':
    case 'school':
    case 'library':
    case 'gym':
      paintShopInterior(lot, { x: 16, y: 6, dir: 'h' });
      break;
    default:
      fillRect(lot, 0, 0, lot.width, lot.height, F.grass);
      lot.entryMarkers = [{ x: 16, y: 16 }];
  }

  // Exit pads
  for (const ex of place.exits) {
    if (ex.x >= 0 && ex.y >= 0 && ex.x < lot.width && ex.y < lot.height) {
      lot.floorCover[cellIndex(lot, ex.x, ex.y)] = F.exit;
      // small pad around exit
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as const) {
        const xx = ex.x + dx;
        const yy = ex.y + dy;
        if (xx >= 0 && yy >= 0 && xx < lot.width && yy < lot.height) {
          if (lot.floorCover[cellIndex(lot, xx, yy)] !== F.asphalt) {
            // keep asphalt roads; mark sidewalks near exits lightly
          }
        }
      }
    }
  }

  if (lot.entryMarkers.length === 0) {
    lot.entryMarkers = [{ x: Math.floor(lot.width / 2), y: Math.floor(lot.height / 2) }];
  }

  recomputeLotDerived(lot, []);
  return lot;
}

export function createNeighborhood(): {
  neighborhood: NeighborhoodState;
  lots: Record<string, LotState>;
} {
  const lots: Record<string, LotState> = {};
  for (const p of CITY_PLACES) {
    lots[p.id] = buildPlaceLot(p);
  }
  return {
    neighborhood: {
      places: CITY_PLACES.map((p) => ({
        ...p,
        exits: p.exits.map((e) => ({ ...e })),
      })),
      activePlaceId: 'home',
      homePlaceId: 'home',
    },
    lots,
  };
}

function placeObject(
  world: World,
  placeId: string,
  def: ObjectDef,
  x: number,
  y: number,
): ObjectEntity {
  const id = world.nextId++;
  const obj: ObjectEntity = {
    kind: 'object',
    id,
    placeId,
    transform: { x, y, zFloor: 0, rot: 0 },
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
  return obj;
}

function def(content: ContentPack, id: string): ObjectDef | undefined {
  return content.objects.find((o) => o.id === id);
}

function p(
  world: World,
  content: ContentPack,
  placeId: string,
  oid: string,
  x: number,
  y: number,
): void {
  const d = def(content, oid);
  if (d) placeObject(world, placeId, d, x, y);
}

function furnishHome(
  world: World,
  content: ContentPack,
  placeId: string,
  palette: 'a' | 'b' | 'c' = 'a',
): void {
  // Shared residential kit with slight layout variants
  const ox = palette === 'b' ? 1 : 0;
  p(world, content, placeId, 'object.fridge_basic', 9 + ox, 9);
  p(world, content, placeId, 'object.stove_basic', 11 + ox, 9);
  p(world, content, placeId, 'object.counter_basic', 10 + ox, 9);
  p(world, content, placeId, 'object.table_dining', 14, 12);
  p(world, content, placeId, 'object.chair_dining', 14, 13);
  p(world, content, placeId, 'object.chair_dining', 16, 12);
  p(world, content, placeId, 'object.bed_double', 18, 10);
  p(world, content, placeId, 'object.dresser', 20, 10);
  p(world, content, placeId, 'object.toilet_basic', 9, 17);
  p(world, content, placeId, 'object.shower_basic', 11, 17);
  p(world, content, placeId, 'object.sink_basic', 10, 17);
  p(world, content, placeId, 'object.sofa_basic', 15, 15);
  p(world, content, placeId, 'object.tv_basic', 15, 17);
  p(world, content, placeId, 'object.coffee_table', 15, 14);
  p(world, content, placeId, 'object.bookshelf', 19, 15);
  p(world, content, placeId, 'object.desk_computer', 20, 12);
  p(world, content, placeId, 'object.lamp_floor', 17, 15);
  p(world, content, placeId, 'object.plant_pot', 13, 10);
  p(world, content, placeId, 'object.plant_pot', 22, 18);
}

/** True if place already has at least one object (skip re-furnish on load). */
function placeHasObjects(world: World, placeId: string): boolean {
  for (const e of world.entities.values()) {
    if (e.kind === 'object' && e.placeId === placeId) return true;
  }
  return false;
}

/** Run furnish block only if the place has no objects yet (save-safe). */
function ifEmpty(
  world: World,
  placeId: string,
  fn: () => void,
): void {
  if (!placeHasObjects(world, placeId)) fn();
}

/**
 * Furnish every place in the city.
 * Skips places that already have objects (so save-load keeps player edits).
 */
export function furnishNeighborhood(world: World, content: ContentPack): void {
  ifEmpty(world, 'home', () => furnishHome(world, content, 'home', 'a'));
  ifEmpty(world, 'house_chen', () => furnishHome(world, content, 'house_chen', 'b'));
  ifEmpty(world, 'house_park', () => furnishHome(world, content, 'house_park', 'c'));
  ifEmpty(world, 'house_okonkwo', () => furnishHome(world, content, 'house_okonkwo', 'a'));
  ifEmpty(world, 'house_diaz', () => furnishHome(world, content, 'house_diaz', 'b'));

  ifEmpty(world, 'street_oak', () => {
    p(world, content, 'street_oak', 'object.plant_pot', 4, 12);
    p(world, content, 'street_oak', 'object.plant_pot', 10, 12);
    p(world, content, 'street_oak', 'object.plant_pot', 18, 12);
    p(world, content, 'street_oak', 'object.plant_pot', 26, 12);
    p(world, content, 'street_oak', 'object.plant_pot', 8, 24);
    p(world, content, 'street_oak', 'object.plant_pot', 20, 24);
    p(world, content, 'street_oak', 'object.lamp_floor', 12, 15);
    p(world, content, 'street_oak', 'object.lamp_floor', 24, 15);
  });

  ifEmpty(world, 'street_maple', () => {
    p(world, content, 'street_maple', 'object.plant_pot', 10, 10);
    p(world, content, 'street_maple', 'object.plant_pot', 22, 10);
    p(world, content, 'street_maple', 'object.plant_pot', 10, 26);
    p(world, content, 'street_maple', 'object.plant_pot', 22, 26);
    p(world, content, 'street_maple', 'object.lamp_floor', 14, 14);
    p(world, content, 'street_maple', 'object.lamp_floor', 20, 22);
  });

  ifEmpty(world, 'plaza', () => {
    p(world, content, 'plaza', 'object.plant_pot', 14, 14);
    p(world, content, 'plaza', 'object.plant_pot', 20, 14);
    p(world, content, 'plaza', 'object.plant_pot', 14, 20);
    p(world, content, 'plaza', 'object.plant_pot', 20, 20);
    p(world, content, 'plaza', 'object.stereo', 17, 17);
    p(world, content, 'plaza', 'object.sofa_basic', 12, 16);
    p(world, content, 'plaza', 'object.lamp_floor', 16, 12);
    p(world, content, 'plaza', 'object.lamp_floor', 18, 22);
    p(world, content, 'plaza', 'object.toilet_basic', 22, 18);
  });

  ifEmpty(world, 'park', () => {
    p(world, content, 'park', 'object.sofa_basic', 10, 12);
    p(world, content, 'park', 'object.sofa_basic', 20, 12);
    p(world, content, 'park', 'object.sofa_basic', 14, 22);
    p(world, content, 'park', 'object.plant_pot', 8, 10);
    p(world, content, 'park', 'object.plant_pot', 24, 10);
    p(world, content, 'park', 'object.plant_pot', 8, 24);
    p(world, content, 'park', 'object.plant_pot', 24, 24);
    p(world, content, 'park', 'object.plant_pot', 16, 8);
    p(world, content, 'park', 'object.exercise_mat', 18, 18);
    p(world, content, 'park', 'object.exercise_mat', 12, 18);
    p(world, content, 'park', 'object.toilet_basic', 6, 16);
  });

  ifEmpty(world, 'cafe', () => {
    p(world, content, 'cafe', 'object.fridge_basic', 8, 8);
    p(world, content, 'cafe', 'object.counter_basic', 10, 8);
    p(world, content, 'cafe', 'object.counter_basic', 12, 8);
    p(world, content, 'cafe', 'object.stove_basic', 14, 8);
    p(world, content, 'cafe', 'object.table_dining', 10, 12);
    p(world, content, 'cafe', 'object.table_dining', 16, 12);
    p(world, content, 'cafe', 'object.chair_dining', 10, 13);
    p(world, content, 'cafe', 'object.chair_dining', 12, 12);
    p(world, content, 'cafe', 'object.chair_dining', 16, 13);
    p(world, content, 'cafe', 'object.stereo', 20, 10);
    p(world, content, 'cafe', 'object.plant_pot', 18, 8);
    p(world, content, 'cafe', 'object.sofa_basic', 18, 16);
    // Staff pad — Nora lives here and must self-care
    p(world, content, 'cafe', 'object.toilet_basic', 22, 8);
    p(world, content, 'cafe', 'object.shower_basic', 22, 10);
    p(world, content, 'cafe', 'object.bed_double', 20, 18);
  });

  ifEmpty(world, 'restaurant', () => {
    p(world, content, 'restaurant', 'object.stove_basic', 8, 8);
    p(world, content, 'restaurant', 'object.fridge_basic', 10, 8);
    p(world, content, 'restaurant', 'object.counter_basic', 12, 8);
    p(world, content, 'restaurant', 'object.table_dining', 10, 12);
    p(world, content, 'restaurant', 'object.table_dining', 16, 12);
    p(world, content, 'restaurant', 'object.table_dining', 12, 16);
    p(world, content, 'restaurant', 'object.chair_dining', 10, 13);
    p(world, content, 'restaurant', 'object.chair_dining', 16, 13);
    p(world, content, 'restaurant', 'object.chair_dining', 12, 17);
    p(world, content, 'restaurant', 'object.stereo', 20, 10);
    p(world, content, 'restaurant', 'object.plant_pot', 20, 16);
    p(world, content, 'restaurant', 'object.lamp_floor', 18, 14);
  });

  ifEmpty(world, 'market', () => {
    p(world, content, 'market', 'object.fridge_basic', 8, 10);
    p(world, content, 'market', 'object.fridge_basic', 10, 10);
    p(world, content, 'market', 'object.fridge_basic', 12, 10);
    p(world, content, 'market', 'object.counter_basic', 8, 14);
    p(world, content, 'market', 'object.counter_basic', 12, 14);
    p(world, content, 'market', 'object.counter_basic', 16, 14);
    p(world, content, 'market', 'object.counter_basic', 20, 14);
    p(world, content, 'market', 'object.plant_pot', 22, 10);
    p(world, content, 'market', 'object.plant_pot', 6, 16);
  });

  ifEmpty(world, 'boutique', () => {
    p(world, content, 'boutique', 'object.dresser', 10, 10);
    p(world, content, 'boutique', 'object.dresser', 14, 10);
    p(world, content, 'boutique', 'object.dresser', 18, 10);
    p(world, content, 'boutique', 'object.sofa_basic', 12, 14);
    p(world, content, 'boutique', 'object.plant_pot', 20, 12);
    p(world, content, 'boutique', 'object.lamp_floor', 10, 14);
    p(world, content, 'boutique', 'object.stereo', 16, 16);
  });

  ifEmpty(world, 'convenience', () => {
    p(world, content, 'convenience', 'object.fridge_basic', 10, 10);
    p(world, content, 'convenience', 'object.fridge_basic', 12, 10);
    p(world, content, 'convenience', 'object.counter_basic', 14, 12);
    p(world, content, 'convenience', 'object.counter_basic', 16, 12);
    p(world, content, 'convenience', 'object.plant_pot', 18, 14);
  });

  ifEmpty(world, 'office', () => {
    p(world, content, 'office', 'object.desk_computer', 10, 10);
    p(world, content, 'office', 'object.desk_computer', 14, 10);
    p(world, content, 'office', 'object.desk_computer', 18, 10);
    p(world, content, 'office', 'object.desk_computer', 10, 14);
    p(world, content, 'office', 'object.desk_computer', 14, 14);
    p(world, content, 'office', 'object.bookshelf', 20, 10);
    p(world, content, 'office', 'object.bookshelf', 20, 12);
    p(world, content, 'office', 'object.sofa_basic', 12, 18);
    p(world, content, 'office', 'object.plant_pot', 16, 16);
    p(world, content, 'office', 'object.plant_pot', 8, 16);
    p(world, content, 'office', 'object.coffee_table', 12, 17);
  });

  ifEmpty(world, 'clinic', () => {
    p(world, content, 'clinic', 'object.sofa_basic', 10, 12);
    p(world, content, 'clinic', 'object.sofa_basic', 16, 12);
    p(world, content, 'clinic', 'object.desk_computer', 12, 16);
    p(world, content, 'clinic', 'object.plant_pot', 18, 10);
    p(world, content, 'clinic', 'object.plant_pot', 10, 18);
    p(world, content, 'clinic', 'object.bookshelf', 20, 14);
  });

  ifEmpty(world, 'gym', () => {
    p(world, content, 'gym', 'object.exercise_mat', 10, 10);
    p(world, content, 'gym', 'object.exercise_mat', 14, 10);
    p(world, content, 'gym', 'object.exercise_mat', 18, 10);
    p(world, content, 'gym', 'object.exercise_mat', 10, 14);
    p(world, content, 'gym', 'object.exercise_mat', 14, 14);
    p(world, content, 'gym', 'object.shower_basic', 10, 18);
    p(world, content, 'gym', 'object.shower_basic', 12, 18);
    p(world, content, 'gym', 'object.sink_basic', 14, 18);
    p(world, content, 'gym', 'object.toilet_basic', 16, 18);
    p(world, content, 'gym', 'object.stereo', 20, 12);
    p(world, content, 'gym', 'object.plant_pot', 20, 16);
  });

  ifEmpty(world, 'salon', () => {
    p(world, content, 'salon', 'object.chair_dining', 10, 10);
    p(world, content, 'salon', 'object.chair_dining', 14, 10);
    p(world, content, 'salon', 'object.chair_dining', 18, 10);
    p(world, content, 'salon', 'object.sofa_basic', 12, 14);
    p(world, content, 'salon', 'object.plant_pot', 20, 12);
    p(world, content, 'salon', 'object.stereo', 16, 16);
    p(world, content, 'salon', 'object.lamp_floor', 10, 14);
  });

  ifEmpty(world, 'library', () => {
    p(world, content, 'library', 'object.bookshelf', 8, 8);
    p(world, content, 'library', 'object.bookshelf', 10, 8);
    p(world, content, 'library', 'object.bookshelf', 12, 8);
    p(world, content, 'library', 'object.bookshelf', 14, 8);
    p(world, content, 'library', 'object.bookshelf', 16, 8);
    p(world, content, 'library', 'object.bookshelf', 8, 12);
    p(world, content, 'library', 'object.bookshelf', 10, 12);
    p(world, content, 'library', 'object.desk_computer', 18, 12);
    p(world, content, 'library', 'object.desk_computer', 18, 16);
    p(world, content, 'library', 'object.chair_dining', 12, 16);
    p(world, content, 'library', 'object.chair_dining', 14, 16);
    p(world, content, 'library', 'object.plant_pot', 20, 10);
    p(world, content, 'library', 'object.plant_pot', 20, 18);
    // Staff pad — Theo lives here and must self-care
    p(world, content, 'library', 'object.toilet_basic', 22, 8);
    p(world, content, 'library', 'object.shower_basic', 22, 10);
    p(world, content, 'library', 'object.bed_double', 20, 18);
    p(world, content, 'library', 'object.fridge_basic', 22, 14);
  });

  ifEmpty(world, 'school', () => {
    p(world, content, 'school', 'object.desk_computer', 10, 10);
    p(world, content, 'school', 'object.desk_computer', 14, 10);
    p(world, content, 'school', 'object.desk_computer', 18, 10);
    p(world, content, 'school', 'object.bookshelf', 10, 14);
    p(world, content, 'school', 'object.bookshelf', 14, 14);
    p(world, content, 'school', 'object.chair_dining', 12, 16);
    p(world, content, 'school', 'object.chair_dining', 16, 16);
    p(world, content, 'school', 'object.plant_pot', 20, 12);
    p(world, content, 'school', 'object.easel', 18, 16);
  });

  // Patch amenities onto existing lots (saves that predate staff pads / public toilets)
  ensurePlaceAmenity(world, content, 'cafe', 'object.toilet_basic', 22, 8);
  ensurePlaceAmenity(world, content, 'cafe', 'object.shower_basic', 22, 10);
  ensurePlaceAmenity(world, content, 'cafe', 'object.bed_double', 20, 18);
  ensurePlaceAmenity(world, content, 'library', 'object.toilet_basic', 22, 8);
  ensurePlaceAmenity(world, content, 'library', 'object.shower_basic', 22, 10);
  ensurePlaceAmenity(world, content, 'library', 'object.bed_double', 20, 18);
  ensurePlaceAmenity(world, content, 'library', 'object.fridge_basic', 22, 14);
  ensurePlaceAmenity(world, content, 'gym', 'object.toilet_basic', 16, 18);
  ensurePlaceAmenity(world, content, 'park', 'object.toilet_basic', 6, 16);
  ensurePlaceAmenity(world, content, 'plaza', 'object.toilet_basic', 22, 18);

  for (const placeId of Object.keys(world.lots)) {
    refreshPlaceCaches(world, placeId);
  }
  world.lot = world.lots[world.neighborhood.activePlaceId]!;
}

/** Add a def to a place only if that def is not already present there. */
function ensurePlaceAmenity(
  world: World,
  content: ContentPack,
  placeId: string,
  defId: string,
  x: number,
  y: number,
): void {
  if (!world.lots[placeId]) return;
  for (const e of world.entities.values()) {
    if (e.kind === 'object' && e.placeId === placeId && e.defId === defId) return;
  }
  p(world, content, placeId, defId, x, y);
}

export function objectsInPlace(world: World, placeId: string): ObjectEntity[] {
  const out: ObjectEntity[] = [];
  for (const e of world.entities.values()) {
    if (e.kind === 'object' && e.placeId === placeId) out.push(e);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

export function refreshPlaceCaches(world: World, placeId: string): void {
  const lot = world.lots[placeId];
  if (!lot) return;
  const stamps = objectsInPlace(world, placeId).map((o) => ({
    x: o.transform.x,
    y: o.transform.y,
    w: o.footprint.w,
    h: o.footprint.h,
    blocksPath: o.blocksPath,
    id: o.id,
  }));
  recomputeLotDerived(lot, stamps);
}

export function getPlaceMeta(world: World, placeId: string): PlaceMeta | undefined {
  const p = world.neighborhood.places.find((x) => x.id === placeId);
  return p as PlaceMeta | undefined;
}

export function setActivePlace(world: World, placeId: string): boolean {
  if (!world.lots[placeId]) return false;
  world.neighborhood.activePlaceId = placeId;
  world.lot = world.lots[placeId]!;
  world.ui.targetEntityId = null;
  return true;
}

export function travelSimToPlace(
  world: World,
  simId: number,
  placeId: string,
  opts?: { silent?: boolean },
): boolean {
  const sim = world.entities.get(simId);
  if (!sim || sim.kind !== 'sim') return false;
  const lot = world.lots[placeId];
  const meta = getPlaceMeta(world, placeId);
  if (!lot || !meta) return false;

  sim.path.waypoints = [];
  sim.path.index = 0;
  // Keep player-queued items; clear autonomy junk so travel isn't blocked mid-queue
  sim.queue.items = sim.queue.items.filter((q) => q.playerQueued);
  sim.action = { kind: 'idle' };
  sim.anim.clip = 'idle';
  sim.placeId = placeId;
  sim.presence = 'on_lot';

  const entry = lot.entryMarkers[0] ?? { x: 10, y: 10 };
  sim.transform.x = entry.x;
  sim.transform.y = entry.y;

  if (world.ui.selectedSimId === simId) {
    setActivePlace(world, placeId);
  }

  if (!opts?.silent) {
    world.eventBus.push({
      type: 'toast',
      message: `${sim.identity.firstName} arrived at ${meta.name}`,
    });
  }
  world.eventBus.push({
    type: 'travel',
    simId,
    placeId,
    placeName: meta.name,
  });
  return true;
}

export function exitAt(
  world: World,
  placeId: string,
  x: number,
  y: number,
): PlaceExit | null {
  const meta = getPlaceMeta(world, placeId);
  if (!meta) return null;
  return meta.exits.find((e) => e.x === x && e.y === y) ?? null;
}
