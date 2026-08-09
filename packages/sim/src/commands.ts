import type { GameMode, Rot } from '@lifesim/shared';
import { formatClock } from './clock.js';
import { setWall } from './lot.js';
import {
  getPlaceMeta,
  refreshPlaceCaches,
  setActivePlace,
  travelSimToPlace,
} from './neighborhood.js';
import { getObs } from './observability/hub.js';
import { findPath, nearestWalkable } from './pathfinding.js';
import type { ContentPack, EntityId, HudProjection, World } from './types.js';
import {
  allObjects,
  allSims,
  debugSpawnHousehold,
  getObject,
  getSim,
  refreshLotCaches,
  spawnObject,
  spawnSim,
} from './world.js';
import { clearSocialPair } from './systems.js';

/** Special interaction id: pure walk-to tile (no object use). */
export const WALK_INTERACTION_ID = '__walk__';

export type SimCommands = {
  setMode: (mode: GameMode) => void;
  setSpeed: (speed: 0 | 1 | 2 | 3) => void;
  setPaused: (paused: boolean) => void;
  selectSim: (id: EntityId | null) => void;
  setWorldTarget: (id: EntityId | null) => void;
  enqueueInteraction: (simId: EntityId, interactionId: string, targetId: EntityId | null) => void;
  cancelAction: (simId: EntityId) => void;
  /**
   * Player-directed walk: selected Sim paths to (x,y) on their current place.
   * Clears current queue/action. Returns false if no path / no sim.
   */
  walkTo: (x: number, y: number, simId?: EntityId | null) => boolean;
  placeObject: (defId: string, x: number, y: number, rot?: Rot) => boolean;
  deleteObject: (id: EntityId) => void;
  setWallTool: (
    x: number,
    y: number,
    dir: 'h' | 'v',
    kind: 'wall' | 'door' | 'window' | null,
  ) => void;
  setModeTool: (tool: string | null) => void;
  joinCareer: (simId: EntityId, trackId: string) => void;
  /** Switch camera/view to a city place */
  viewPlace: (placeId: string) => boolean;
  /** Send selected (or given) Sim to a place */
  travelTo: (placeId: string, simId?: EntityId | null) => boolean;
  debugSpawnHousehold: () => void;
  createHousehold: (opts: {
    householdName: string;
    funds: number;
    members: {
      firstName: string;
      lastName: string;
      traits: string[];
      aspirationId: string;
      visual: {
        bodyPreset: string;
        hairPreset: string;
        outfitPreset: string;
        skinTone: string;
      };
    }[];
  }) => void;
  drainEvents: () => string[];
};

export function createCommands(world: World, content: ContentPack): SimCommands {
  return {
    setMode(mode) {
      const prev = world.mode;
      world.mode = mode;
      if (mode === 'build' || mode === 'buy') {
        world.clock.paused = true;
      }
      if (mode === 'live') {
        world.ui.modeTool = null;
        world.ui.buyGhost = null;
      }
      getObs().event('mode.change', 'ui', { from: prev, to: mode });
    },
    setSpeed(speed) {
      world.clock.speed = speed;
      world.clock.paused = speed === 0;
    },
    setPaused(paused) {
      world.clock.paused = paused;
      if (paused) world.clock.speed = 0;
      else if (world.clock.speed === 0) world.clock.speed = 1;
    },
    selectSim(id) {
      world.ui.selectedSimId = id;
      // Follow view to the Sim's current place
      if (id != null) {
        const sim = getSim(world, id);
        if (sim) setActivePlace(world, sim.placeId);
      }
    },
    setWorldTarget(id) {
      world.ui.targetEntityId = id;
    },
    enqueueInteraction(simId, interactionId, targetId) {
      const sim = getSim(world, simId);
      if (!sim || sim.presence !== 'on_lot') return;
      if (targetId != null) {
        const t = world.entities.get(targetId);
        if (t?.kind === 'object' && t.placeId !== sim.placeId) return;
        if (t?.kind === 'sim' && t.placeId !== sim.placeId) return;
      }
      sim.queue.items.push({ interactionId, targetId, playerQueued: true });
      getObs().event('action.enqueue', 'action', {
        simId,
        interactionId,
        targetId,
        player: true,
      });
    },
    viewPlace(placeId) {
      const ok = setActivePlace(world, placeId);
      if (ok) {
        getObs().event('view.place', 'ui', { placeId });
      }
      return ok;
    },
    travelTo(placeId, simId) {
      const id = simId ?? world.ui.selectedSimId;
      if (id == null) return false;
      const ok = travelSimToPlace(world, id, placeId);
      if (ok) {
        getObs().event('travel', 'ui', { placeId, simId: id });
      }
      return ok;
    },
    cancelAction(simId) {
      const sim = getSim(world, simId);
      if (!sim) return;
      sim.queue.items = [];
      if (sim.action.kind !== 'idle') {
        const iid =
          'interactionId' in sim.action ? sim.action.interactionId : 'cancel';
        clearSocialPair(world, sim);
        for (const o of allObjects(world)) {
          for (const s of o.slots) {
            if (s.reservedBy === sim.id) {
              s.reservedBy = null;
              s.reservedUntilTick = 0;
            }
          }
        }
        sim.action = {
          kind: 'failed',
          interactionId: iid,
          reason: 'cancelled_by_player',
        };
        sim.path.waypoints = [];
        sim.path.index = 0;
        sim.anim.clip = 'idle';
      }
    },
    walkTo(x, y, simId) {
      const id = simId ?? world.ui.selectedSimId;
      if (id == null) {
        world.eventBus.push({ type: 'toast', message: 'Select a Sim first' });
        return false;
      }
      const sim = getSim(world, id);
      if (!sim || sim.presence !== 'on_lot') {
        world.eventBus.push({ type: 'toast', message: 'That Sim cannot walk right now' });
        return false;
      }
      if (sim.placeId !== world.neighborhood.activePlaceId) {
        setActivePlace(world, sim.placeId);
      }
      const lot = world.lots[sim.placeId] ?? world.lot;
      const gx = Math.round(x);
      const gy = Math.round(y);
      const goal = nearestWalkable(lot, gx, gy, 3);
      if (!goal) {
        world.eventBus.push({ type: 'toast', message: 'Cannot walk there' });
        return false;
      }
      const start = {
        x: Math.round(sim.transform.x),
        y: Math.round(sim.transform.y),
      };
      const path = findPath(lot, start, goal);
      if (!path || path.length === 0) {
        world.eventBus.push({ type: 'toast', message: 'No path to that spot' });
        getObs().notePathResult(false, { simId: id, x: gx, y: gy });
        return false;
      }

      clearSocialPair(world, sim);
      for (const o of allObjects(world)) {
        for (const s of o.slots) {
          if (s.reservedBy === sim.id) {
            s.reservedBy = null;
            s.reservedUntilTick = 0;
          }
        }
      }
      sim.queue.items = [];
      sim.path.waypoints = path;
      sim.path.index = 0;
      sim.action = {
        kind: 'pathing',
        interactionId: WALK_INTERACTION_ID,
        targetId: null,
        fails: 0,
      };
      sim.anim.clip = 'walk';
      sim.autonomy.nextPlanTick = world.clock.tick + path.length + 5;
      getObs().notePathResult(true, {
        simId: id,
        interactionId: WALK_INTERACTION_ID,
        pathLen: path.length,
      });
      getObs().event('walk.to', 'input', {
        simId: id,
        x: goal.x,
        y: goal.y,
        pathLen: path.length,
      });
      return true;
    },
    placeObject(defId, x, y, rot = 0) {
      const def = content.objects.find((o) => o.id === defId);
      if (!def) {
        getObs().warnOnce(`missing_obj_${defId}`, `Unknown object def ${defId}`, 'content');
        return false;
      }
      if (world.household.funds < def.price) {
        world.eventBus.push({ type: 'toast', message: 'Not enough funds' });
        getObs().event('buy.rejected', 'buy', { defId, reason: 'no_funds' });
        return false;
      }
      world.household.funds -= def.price;
      spawnObject(world, def, x, y, rot, world.neighborhood.activePlaceId);
      getObs().event('buy.place', 'buy', { defId, x, y, price: def.price });
      return true;
    },
    deleteObject(id) {
      const obj = getObject(world, id);
      if (!obj) return;
      const def = content.objects.find((o) => o.id === obj.defId);
      if (def) world.household.funds += Math.floor(def.price * 0.5);
      for (const sim of allSims(world)) {
        sim.queue.items = sim.queue.items.filter((q) => q.targetId !== id);
        if (
          (sim.action.kind === 'pathing' ||
            sim.action.kind === 'performing' ||
            sim.action.kind === 'pending') &&
          sim.action.targetId === id
        ) {
          sim.action = {
            kind: 'failed',
            interactionId: sim.action.interactionId,
            reason: 'target_invalid',
          };
          sim.path.waypoints = [];
        }
      }
      const pid = obj.placeId;
      world.entities.delete(id);
      refreshPlaceCaches(world, pid);
      if (pid === world.neighborhood.activePlaceId) {
        world.lot = world.lots[pid]!;
      }
    },
    setWallTool(x, y, dir, kind) {
      setWall(world.lot, x, y, dir, kind);
      refreshLotCaches(world);
    },
    setModeTool(tool) {
      world.ui.modeTool = tool;
    },
    joinCareer(simId, trackId) {
      const sim = getSim(world, simId);
      if (!sim) return;
      if (!content.careers.find((c) => c.id === trackId)) return;
      sim.career = { trackId, level: 0, performance: 50, daysWorked: 0 };
      world.eventBus.push({
        type: 'toast',
        message: `${sim.identity.firstName} joined a career`,
      });
    },
    debugSpawnHousehold() {
      debugSpawnHousehold(world, content);
    },
    createHousehold(opts) {
      for (const id of [...world.household.memberIds]) {
        world.entities.delete(id);
      }
      world.household.memberIds = [];
      world.household.name = opts.householdName;
      world.household.funds = opts.funds;
      // Ensure city is furnished
      if (allObjects(world).length === 0) {
        debugSpawnHousehold(world, content);
        for (const id of [...world.household.memberIds]) {
          world.entities.delete(id);
        }
        world.household.memberIds = [];
        world.household.name = opts.householdName;
        world.household.funds = opts.funds;
      }
      let i = 0;
      for (const m of opts.members) {
        spawnSim(world, {
          firstName: m.firstName,
          lastName: m.lastName,
          x: 12 + i * 2,
          y: 14,
          placeId: world.neighborhood.homePlaceId,
          traits: m.traits,
          aspirationId: m.aspirationId,
          visual: m.visual,
        });
        i++;
      }
      setActivePlace(world, world.neighborhood.homePlaceId);
    },
    drainEvents() {
      const toasts = world.eventBus
        .filter((e) => e.type === 'toast')
        .map((e) => (e as { message: string }).message);
      world.eventBus = [];
      return toasts;
    },
  };
}

export function projectHud(world: World, content: ContentPack, toasts: string[]): HudProjection {
  const sims = allSims(world);
  const selected = world.ui.selectedSimId
    ? getSim(world, world.ui.selectedSimId)
    : null;
  const activeId = world.neighborhood.activePlaceId;
  const placeMeta = getPlaceMeta(world, activeId);

  let target: HudProjection['target'] = null;
  if (world.ui.targetEntityId != null) {
    const ent = world.entities.get(world.ui.targetEntityId);
    if (ent?.kind === 'object' && ent.placeId === activeId) {
      const def = content.objects.find((o) => o.id === ent.defId);
      const available =
        def?.interactions.map((iid) => {
          const idef = content.interactions.find((i) => i.id === iid);
          let enabled = true;
          let failReasonKey: string | undefined;
          if (selected && idef?.requires?.skill) {
            const sk = selected.skills[idef.requires.skill.id] ?? 0;
            if (sk < idef.requires.skill.min) {
              enabled = false;
              failReasonKey = 'skill_gate';
            }
          }
          if (selected && idef?.requires?.heldItem) {
            if (selected.inventory.held !== idef.requires.heldItem) {
              enabled = false;
              failReasonKey = 'need_item';
            }
          }
          if (idef?.requires?.objectState && ent.state !== idef.requires.objectState) {
            enabled = false;
            failReasonKey = 'object_state';
          }
          return {
            id: iid,
            labelKey: idef?.nameKey ?? iid,
            enabled,
            failReasonKey,
          };
        }) ?? [];
      target = {
        id: ent.id,
        kind: 'object',
        label: def?.nameKey ?? ent.defId,
        availableInteractions: available,
      };
    } else if (ent?.kind === 'sim' && ent.placeId === activeId) {
      const social = content.interactions
        .filter((i) => i.social)
        .map((i) => ({
          id: i.id,
          labelKey: i.nameKey,
          enabled: ent.id !== selected?.id,
        }));
      target = {
        id: ent.id,
        kind: 'sim',
        label: `${ent.identity.firstName} ${ent.identity.lastName}`,
        availableInteractions: social,
      };
    }
  }

  return {
    clockLabel: formatClock(world.clock),
    minuteOfDay: world.clock.minuteOfDay,
    dayNumber: world.clock.dayNumber,
    weather: world.weather,
    funds: world.household.funds,
    mode: world.mode,
    speed: world.clock.speed,
    paused: world.clock.paused,
    placeId: activeId,
    placeName: placeMeta?.name ?? activeId,
    places: world.neighborhood.places.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      description: p.description,
    })),
    householdSims: sims.map((s) => ({
      id: s.id,
      name: `${s.identity.firstName} ${s.identity.lastName}`,
      mood: s.mood.value,
      presence: s.presence,
      placeId: s.placeId,
      placeName: getPlaceMeta(world, s.placeId)?.name ?? s.placeId,
      needs: { ...s.needs },
    })),
    selectedSim: selected
      ? {
          id: selected.id,
          name: `${selected.identity.firstName} ${selected.identity.lastName}`,
          needs: { ...selected.needs },
          mood: selected.mood.value,
          skills: { ...selected.skills },
          career: { ...selected.career },
          queue: [...selected.queue.items],
          action: selected.action,
          aspiration: { ...selected.aspiration },
          traits: [...selected.traits.ids],
          placeId: selected.placeId,
        }
      : null,
    target,
    toasts,
  };
}
