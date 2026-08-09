import { describe, expect, it } from 'vitest';
import {
  addRelationshipDelta,
  ensureRelationship,
  getRelationship,
  pairKey,
} from './relationships.js';
import type { RelationshipEdge } from './types.js';

describe('RelationshipStore helpers', () => {
  it('pairKey orders ids', () => {
    expect(pairKey(5, 2)).toEqual([2, 5]);
    expect(pairKey(1, 1)).toEqual([1, 1]);
  });

  it('ensureRelationship is idempotent and bidirectional lookup', () => {
    const edges: RelationshipEdge[] = [];
    const e1 = ensureRelationship(edges, 10, 3);
    const e2 = ensureRelationship(edges, 3, 10);
    expect(edges.length).toBe(1);
    expect(e1).toBe(e2);
    expect(e1.a).toBe(3);
    expect(e1.b).toBe(10);
    expect(getRelationship(edges, 10, 3)).toBe(e1);
  });

  it('addRelationshipDelta clamps friendship and romance', () => {
    const edges: RelationshipEdge[] = [];
    addRelationshipDelta(edges, 1, 2, 50, 40);
    addRelationshipDelta(edges, 1, 2, 80, 80);
    const e = getRelationship(edges, 1, 2)!;
    expect(e.friendship).toBe(100);
    expect(e.romance).toBe(100);
    addRelationshipDelta(edges, 1, 2, -300, 0);
    expect(e.friendship).toBe(-100);
    expect(e.romance).toBe(100);
  });

  it('getRelationship returns null when missing', () => {
    expect(getRelationship([], 1, 2)).toBeNull();
  });
});
