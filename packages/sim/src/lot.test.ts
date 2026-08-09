import { describe, expect, it } from 'vitest';
import { buildPlaceLot, CITY_PLACES } from './neighborhood.js';
import {
  canWalkBetween,
  cellIndex,
  createLot,
  inBounds,
  recomputeLotDerived,
  setWall,
} from './lot.js';

describe('LotState', () => {
  it('creates walkable empty shell', () => {
    const lot = createLot(32, 32);
    expect(lot.width).toBe(32);
    expect(lot.height).toBe(32);
    expect(lot.walkable.length).toBe(32 * 32);
    expect(inBounds(lot, 0, 0)).toBe(true);
    expect(inBounds(lot, 32, 0)).toBe(false);
  });

  it('home place has walls and entry', () => {
    const home = CITY_PLACES.find((p) => p.id === 'home')!;
    const lot = buildPlaceLot(home);
    expect(lot.walls.length).toBeGreaterThan(10);
    expect(lot.entryMarkers.length).toBeGreaterThan(0);
  });

  it('walls block orthogonal movement unless door', () => {
    const lot = createLot(16, 16);
    lot.walls = [];
    recomputeLotDerived(lot, []);
    expect(canWalkBetween(lot, 5, 5, 6, 5)).toBe(true);

    setWall(lot, 6, 5, 'v', 'wall');
    recomputeLotDerived(lot, []);
    expect(canWalkBetween(lot, 5, 5, 6, 5)).toBe(false);

    setWall(lot, 6, 5, 'v', 'door');
    recomputeLotDerived(lot, []);
    expect(canWalkBetween(lot, 5, 5, 6, 5)).toBe(true);
  });

  it('windows never open passage', () => {
    const lot = createLot(16, 16);
    lot.walls = [];
    setWall(lot, 6, 5, 'v', 'window');
    recomputeLotDerived(lot, []);
    expect(canWalkBetween(lot, 5, 5, 6, 5)).toBe(false);
  });

  it('object footprints block path when blocksPath', () => {
    const lot = createLot(16, 16);
    recomputeLotDerived(lot, [
      { x: 4, y: 4, w: 2, h: 2, blocksPath: true, id: 1 },
    ]);
    expect(lot.walkable[cellIndex(lot, 4, 4)]).toBe(0);
    expect(lot.walkable[cellIndex(lot, 5, 5)]).toBe(0);
    expect(lot.objectsAt.get(cellIndex(lot, 4, 4))).toContain(1);
  });

  it('non-blocking objects do not remove walkability', () => {
    const lot = createLot(16, 16);
    recomputeLotDerived(lot, [
      { x: 3, y: 3, w: 1, h: 1, blocksPath: false, id: 9 },
    ]);
    expect(lot.walkable[cellIndex(lot, 3, 3)]).toBe(1);
  });

  it('setWall erase removes edge', () => {
    const lot = createLot(16, 16);
    setWall(lot, 2, 2, 'h', 'wall');
    expect(lot.walls.some((w) => w.x === 2 && w.y === 2 && w.dir === 'h')).toBe(true);
    setWall(lot, 2, 2, 'h', null);
    expect(lot.walls.some((w) => w.x === 2 && w.y === 2 && w.dir === 'h')).toBe(false);
  });
});
