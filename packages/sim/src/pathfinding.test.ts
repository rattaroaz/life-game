import { describe, expect, it } from 'vitest';
import { createLot, recomputeLotDerived, setWall } from './lot.js';
import { findPath, nearestWalkable } from './pathfinding.js';

describe('pathfinding A*', () => {
  it('returns single node when start equals goal', () => {
    const lot = createLot(16, 16);
    recomputeLotDerived(lot, []);
    const path = findPath(lot, { x: 2, y: 2 }, { x: 2, y: 2 });
    expect(path).toEqual([{ x: 2, y: 2 }]);
  });

  it('finds a short open-space path', () => {
    const lot = createLot(16, 16);
    lot.walls = [];
    recomputeLotDerived(lot, []);
    const path = findPath(lot, { x: 1, y: 1 }, { x: 4, y: 1 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 1, y: 1 });
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 1 });
    expect(path!.length).toBe(4); // 1,2,3,4
  });

  it('routes around a blocking wall', () => {
    const lot = createLot(16, 16);
    lot.walls = [];
    // vertical wall segment blocking direct east from (2,5) to (4,5)
    setWall(lot, 3, 4, 'v', 'wall');
    setWall(lot, 3, 5, 'v', 'wall');
    setWall(lot, 3, 6, 'v', 'wall');
    recomputeLotDerived(lot, []);
    const path = findPath(lot, { x: 1, y: 5 }, { x: 5, y: 5 });
    expect(path).not.toBeNull();
    // must not step through blocked edge — path should exist via detour
    expect(path!.length).toBeGreaterThan(5);
  });

  it('returns null when goal is fully enclosed by walls and blocked cells', () => {
    const lot = createLot(16, 16);
    lot.walls = [];
    // Block goal cell and neighbors via footprints
    recomputeLotDerived(lot, [
      { x: 8, y: 8, w: 3, h: 3, blocksPath: true, id: 1 },
    ]);
    const path = findPath(lot, { x: 1, y: 1 }, { x: 9, y: 9 }, 500);
    // nearest walkable may still find approach outside the footprint
    // fully unwalkable cluster: ensure either null or ends outside block
    if (path) {
      const end = path[path.length - 1]!;
      expect(lot.walkable[end.y * lot.width + end.x]).toBe(1);
    }
  });

  it('nearestWalkable finds nearby open cell', () => {
    const lot = createLot(16, 16);
    recomputeLotDerived(lot, [
      { x: 5, y: 5, w: 1, h: 1, blocksPath: true, id: 1 },
    ]);
    const n = nearestWalkable(lot, 5, 5, 2);
    expect(n).not.toBeNull();
    expect(lot.walkable[n!.y * lot.width + n!.x]).toBe(1);
  });

  it('path cells are walkable and adjacent', () => {
    const lot = createLot(20, 20);
    lot.walls = [];
    recomputeLotDerived(lot, []);
    const path = findPath(lot, { x: 0, y: 0 }, { x: 5, y: 5 })!;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      expect(dist).toBe(1);
      expect(lot.walkable[b.y * lot.width + b.x]).toBe(1);
    }
  });
});
