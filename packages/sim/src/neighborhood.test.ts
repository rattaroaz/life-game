import { describe, expect, it } from 'vitest';
import { loadBuiltinContent } from '@lifesim/content';
import {
  CITY_PLACES,
  createNeighborhood,
  setActivePlace,
  travelSimToPlace,
} from './neighborhood.js';
import { createEmptyWorld, debugSpawnHousehold, getSim } from './world.js';

describe('neighborhood city', () => {
  it('builds all city places', () => {
    const { lots, neighborhood } = createNeighborhood();
    expect(neighborhood.places.length).toBe(CITY_PLACES.length);
    for (const p of CITY_PLACES) {
      expect(lots[p.id]).toBeDefined();
      expect(lots[p.id]!.width).toBeGreaterThan(10);
    }
  });

  it('debug household can travel between places', () => {
    const content = loadBuiltinContent();
    const world = createEmptyWorld(1);
    debugSpawnHousehold(world, content);
    const simId = world.household.memberIds[0]!;
    expect(getSim(world, simId)!.placeId).toBe('home');

    expect(travelSimToPlace(world, simId, 'park')).toBe(true);
    expect(getSim(world, simId)!.placeId).toBe('park');
    expect(world.neighborhood.activePlaceId).toBe('park');

    expect(travelSimToPlace(world, simId, 'cafe')).toBe(true);
    expect(getSim(world, simId)!.placeId).toBe('cafe');

    expect(setActivePlace(world, 'plaza')).toBe(true);
    expect(world.lot.id).toBe('plaza');
  });

  it('each place has interactable objects after furnish', () => {
    const content = loadBuiltinContent();
    const world = createEmptyWorld(2);
    debugSpawnHousehold(world, content);
    for (const p of CITY_PLACES) {
      const objs = [...world.entities.values()].filter(
        (e) => e.kind === 'object' && e.placeId === p.id,
      );
      expect(objs.length, p.id).toBeGreaterThan(0);
    }
  });
});
