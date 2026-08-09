import type { EntityId } from './types.js';

export type GridPos = { x: number; y: number };

export type WallEdge = {
  /** cell of the tile south/east of the edge for orientation */
  x: number;
  y: number;
  /** 'h' = horizontal edge north of cell; 'v' = vertical edge west of cell */
  dir: 'h' | 'v';
  kind: 'wall' | 'door' | 'window';
};

export type LotState = {
  id: string;
  width: number;
  height: number;
  floors: 1;
  floorCover: Uint16Array;
  walls: WallEdge[];
  walkable: Uint8Array;
  roomOfCell: Int16Array;
  entryMarkers: GridPos[];
  objectsAt: Map<number, EntityId[]>;
};

export function cellIndex(lot: LotState, x: number, y: number): number {
  return y * lot.width + x;
}

export function inBounds(lot: LotState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < lot.width && y < lot.height;
}

export function createLot(width = 32, height = 32, id = 'lot_starter'): LotState {
  const cells = width * height;
  const lot: LotState = {
    id,
    width,
    height,
    floors: 1,
    floorCover: new Uint16Array(cells),
    walls: [],
    walkable: new Uint8Array(cells),
    roomOfCell: new Int16Array(cells),
    entryMarkers: [{ x: 2, y: 2 }],
    objectsAt: new Map(),
  };
  // Default outdoor grass
  for (let i = 0; i < cells; i++) lot.floorCover[i] = 1;
  // Simple starter house interior: floor tiles in center
  for (let y = 8; y < 20; y++) {
    for (let x = 8; x < 22; x++) {
      lot.floorCover[cellIndex(lot, x, y)] = 2; // wood floor
    }
  }
  // Perimeter walls around house
  for (let x = 8; x < 22; x++) {
    lot.walls.push({ x, y: 8, dir: 'h', kind: 'wall' });
    lot.walls.push({ x, y: 20, dir: 'h', kind: 'wall' });
  }
  for (let y = 8; y < 20; y++) {
    lot.walls.push({ x: 8, y, dir: 'v', kind: 'wall' });
    lot.walls.push({ x: 22, y, dir: 'v', kind: 'wall' });
  }
  // Front door south
  lot.walls = lot.walls.filter(
    (w) => !(w.dir === 'h' && w.y === 20 && w.x === 14),
  );
  lot.walls.push({ x: 14, y: 20, dir: 'h', kind: 'door' });
  // A window
  lot.walls = lot.walls.filter(
    (w) => !(w.dir === 'h' && w.y === 8 && w.x === 12),
  );
  lot.walls.push({ x: 12, y: 8, dir: 'h', kind: 'window' });

  lot.entryMarkers = [{ x: 14, y: 21 }];
  recomputeLotDerived(lot, []);
  return lot;
}

function edgeBlocks(
  walls: WallEdge[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  // Moving from (ax,ay) to (bx,by) — adjacent cells
  const dx = bx - ax;
  const dy = by - ay;
  let edge: WallEdge | undefined;
  if (dx === 1 && dy === 0) {
    edge = walls.find((w) => w.dir === 'v' && w.x === bx && w.y === ay);
  } else if (dx === -1 && dy === 0) {
    edge = walls.find((w) => w.dir === 'v' && w.x === ax && w.y === ay);
  } else if (dx === 0 && dy === 1) {
    edge = walls.find((w) => w.dir === 'h' && w.x === ax && w.y === by);
  } else if (dx === 0 && dy === -1) {
    edge = walls.find((w) => w.dir === 'h' && w.x === ax && w.y === ay);
  }
  if (!edge) return false;
  if (edge.kind === 'door') return false; // passage
  if (edge.kind === 'window') return true; // never passage
  return edge.kind === 'wall';
}

export type FootprintStamp = {
  x: number;
  y: number;
  w: number;
  h: number;
  blocksPath: boolean;
  id: EntityId;
};

export function recomputeLotDerived(lot: LotState, objects: FootprintStamp[]): void {
  const n = lot.width * lot.height;
  lot.walkable = new Uint8Array(n);
  lot.roomOfCell = new Int16Array(n);
  lot.objectsAt = new Map();

  for (let y = 0; y < lot.height; y++) {
    for (let x = 0; x < lot.width; x++) {
      lot.walkable[cellIndex(lot, x, y)] = 1;
    }
  }

  for (const o of objects) {
    for (let dy = 0; dy < o.h; dy++) {
      for (let dx = 0; dx < o.w; dx++) {
        const cx = o.x + dx;
        const cy = o.y + dy;
        if (!inBounds(lot, cx, cy)) continue;
        const idx = cellIndex(lot, cx, cy);
        const list = lot.objectsAt.get(idx) ?? [];
        list.push(o.id);
        lot.objectsAt.set(idx, list);
        if (o.blocksPath) lot.walkable[idx] = 0;
      }
    }
  }

  // Flood fill rooms from outdoor (edge cells) and interiors
  lot.roomOfCell.fill(-1);
  let roomId = 0;
  const visit = (sx: number, sy: number, id: number) => {
    const stack: [number, number][] = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      if (!inBounds(lot, x, y)) continue;
      const idx = cellIndex(lot, x, y);
      if (lot.roomOfCell[idx] !== -1) continue;
      if (lot.walkable[idx] === 0 && lot.floorCover[idx] === 1) {
        // blocked outdoor
      }
      lot.roomOfCell[idx] = id;
      const neigh: [number, number][] = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx, ny] of neigh) {
        if (!inBounds(lot, nx, ny)) continue;
        if (edgeBlocks(lot.walls, x, y, nx, ny)) continue;
        if (lot.walkable[cellIndex(lot, nx, ny)] === 0) continue;
        if (lot.roomOfCell[cellIndex(lot, nx, ny)] !== -1) continue;
        stack.push([nx, ny]);
      }
    }
  };

  // Outdoor flood from border
  for (let x = 0; x < lot.width; x++) {
    if (lot.walkable[cellIndex(lot, x, 0)]) visit(x, 0, 0);
    if (lot.walkable[cellIndex(lot, x, lot.height - 1)]) visit(x, lot.height - 1, 0);
  }
  for (let y = 0; y < lot.height; y++) {
    if (lot.walkable[cellIndex(lot, 0, y)]) visit(0, y, 0);
    if (lot.walkable[cellIndex(lot, lot.width - 1, y)]) visit(lot.width - 1, y, 0);
  }
  roomId = 1;
  for (let y = 0; y < lot.height; y++) {
    for (let x = 0; x < lot.width; x++) {
      const idx = cellIndex(lot, x, y);
      if (lot.walkable[idx] && lot.roomOfCell[idx] === -1) {
        visit(x, y, roomId++);
      }
    }
  }
}

export function canWalkBetween(
  lot: LotState,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  if (!inBounds(lot, bx, by)) return false;
  if (lot.walkable[cellIndex(lot, bx, by)] === 0) return false;
  if (edgeBlocks(lot.walls, ax, ay, bx, by)) return false;
  return true;
}

export function setWall(
  lot: LotState,
  x: number,
  y: number,
  dir: 'h' | 'v',
  kind: 'wall' | 'door' | 'window' | null,
): void {
  lot.walls = lot.walls.filter((w) => !(w.x === x && w.y === y && w.dir === dir));
  if (kind) lot.walls.push({ x, y, dir, kind });
}
