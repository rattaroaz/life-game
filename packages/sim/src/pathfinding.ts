import { canWalkBetween, cellIndex, type LotState } from './lot.js';

export type PathNode = { x: number; y: number };

/**
 * A* grid pathfinding. Orthogonal only for v1.
 */
export function findPath(
  lot: LotState,
  start: PathNode,
  goal: PathNode,
  maxNodes = 4000,
): PathNode[] | null {
  if (start.x === goal.x && start.y === goal.y) return [start];
  if (!lot.walkable[cellIndex(lot, goal.x, goal.y)]) {
    // try adjacent walkable cells near goal (approach)
    const near = nearestWalkable(lot, goal.x, goal.y, 3);
    if (!near) return null;
    goal = near;
  }

  const key = (x: number, y: number) => y * lot.width + x;
  const open = new Map<number, number>(); // key -> f
  const came = new Map<number, number>();
  const gScore = new Map<number, number>();
  const startK = key(start.x, start.y);
  gScore.set(startK, 0);
  open.set(startK, heuristic(start, goal));

  let expanded = 0;
  while (open.size && expanded < maxNodes) {
    expanded++;
    let currentK = -1;
    let bestF = Infinity;
    for (const [k, f] of open) {
      if (f < bestF) {
        bestF = f;
        currentK = k;
      }
    }
    open.delete(currentK);
    const cx = currentK % lot.width;
    const cy = Math.floor(currentK / lot.width);
    if (cx === goal.x && cy === goal.y) {
      return reconstruct(came, currentK, lot.width);
    }
    const neighbors: PathNode[] = [
      { x: cx + 1, y: cy },
      { x: cx - 1, y: cy },
      { x: cx, y: cy + 1 },
      { x: cx, y: cy - 1 },
    ];
    for (const n of neighbors) {
      if (!canWalkBetween(lot, cx, cy, n.x, n.y)) continue;
      const nk = key(n.x, n.y);
      const tent = (gScore.get(currentK) ?? Infinity) + 1;
      if (tent < (gScore.get(nk) ?? Infinity)) {
        came.set(nk, currentK);
        gScore.set(nk, tent);
        open.set(nk, tent + heuristic(n, goal));
      }
    }
  }
  return null;
}

function heuristic(a: PathNode, b: PathNode): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstruct(came: Map<number, number>, current: number, width: number): PathNode[] {
  const path: PathNode[] = [];
  let c: number | undefined = current;
  while (c !== undefined) {
    path.push({ x: c % width, y: Math.floor(c / width) });
    c = came.get(c);
  }
  path.reverse();
  return path;
}

export function nearestWalkable(
  lot: LotState,
  x: number,
  y: number,
  radius: number,
): PathNode | null {
  if (
    x >= 0 &&
    y >= 0 &&
    x < lot.width &&
    y < lot.height &&
    lot.walkable[cellIndex(lot, x, y)]
  ) {
    return { x, y };
  }
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= lot.width || ny >= lot.height) continue;
        if (lot.walkable[cellIndex(lot, nx, ny)]) return { x: nx, y: ny };
      }
    }
  }
  return null;
}
