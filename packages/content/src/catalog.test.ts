import { describe, expect, it } from 'vitest';
import { loadBuiltinContent } from './catalog.js';

describe('builtin catalog integrity', () => {
  const content = loadBuiltinContent();

  it('has unique object ids', () => {
    const ids = content.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique interaction ids', () => {
    const ids = content.interactions.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('object interaction refs resolve', () => {
    const map = new Map(content.interactions.map((i) => [i.id, i]));
    for (const o of content.objects) {
      for (const iid of o.interactions) {
        expect(map.has(iid)).toBe(true);
      }
      for (const slot of o.slots) {
        expect(slot.id.length).toBeGreaterThan(0);
        expect(slot.tags.length).toBeGreaterThan(0);
      }
      expect(o.footprint.w).toBeGreaterThan(0);
      expect(o.footprint.h).toBeGreaterThan(0);
      expect(o.price).toBeGreaterThanOrEqual(0);
    }
  });

  it('interaction chains and skill refs are well-formed', () => {
    const iids = new Set(content.interactions.map((i) => i.id));
    for (const i of content.interactions) {
      expect(i.durationTicks).toBeGreaterThan(0);
      if (i.chain) {
        expect(iids.has(i.chain.nextInteractionId)).toBe(true);
      }
      if (i.requires?.skill) {
        expect(i.requires.skill.min).toBeGreaterThan(0);
      }
    }
  });

  it('careers have schedule and levels', () => {
    expect(content.careers.length).toBe(2);
    for (const c of content.careers) {
      expect(c.levels.length).toBeGreaterThanOrEqual(2);
      expect(c.schedule.endMinute).toBeGreaterThan(c.schedule.startMinute);
      expect(c.schedule.days.length).toBeGreaterThan(0);
    }
  });

  it('traits and aspirations have ids and names', () => {
    for (const t of content.traits) {
      expect(t.id.startsWith('trait.')).toBe(true);
      expect(t.nameKey.length).toBeGreaterThan(0);
    }
    for (const a of content.aspirations) {
      expect(a.id.startsWith('aspiration.')).toBe(true);
      expect(a.milestones.length).toBeGreaterThan(0);
    }
  });

  it('ships 10 unique NPCs with traits and places', () => {
    expect(content.npcs).toHaveLength(10);
    const ids = content.npcs.map((n) => n.id);
    expect(new Set(ids).size).toBe(10);
    const traitIds = new Set(content.traits.map((t) => t.id));
    const aspIds = new Set(content.aspirations.map((a) => a.id));
    for (const n of content.npcs) {
      expect(n.id.startsWith('npc.')).toBe(true);
      expect(n.firstName.length).toBeGreaterThan(0);
      expect(n.bio.length).toBeGreaterThan(0);
      expect(n.startPlaceId.length).toBeGreaterThan(0);
      expect(n.homePlaceId.length).toBeGreaterThan(0);
      expect(aspIds.has(n.aspirationId)).toBe(true);
      for (const t of n.traits) expect(traitIds.has(t)).toBe(true);
    }
  });
});
