import type { EntityId, RelationshipEdge } from './types.js';

export function pairKey(a: EntityId, b: EntityId): [EntityId, EntityId] {
  return a < b ? [a, b] : [b, a];
}

export function getRelationship(
  edges: RelationshipEdge[],
  a: EntityId,
  b: EntityId,
): RelationshipEdge | null {
  const [lo, hi] = pairKey(a, b);
  return edges.find((e) => e.a === lo && e.b === hi) ?? null;
}

export function ensureRelationship(
  edges: RelationshipEdge[],
  a: EntityId,
  b: EntityId,
): RelationshipEdge {
  let e = getRelationship(edges, a, b);
  if (!e) {
    const [lo, hi] = pairKey(a, b);
    e = { a: lo, b: hi, friendship: 0, romance: 0, flags: [] };
    edges.push(e);
  }
  return e;
}

export function addRelationshipDelta(
  edges: RelationshipEdge[],
  a: EntityId,
  b: EntityId,
  friendship = 0,
  romance = 0,
): void {
  const e = ensureRelationship(edges, a, b);
  e.friendship = clamp(e.friendship + friendship, -100, 100);
  e.romance = clamp(e.romance + romance, 0, 100);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
