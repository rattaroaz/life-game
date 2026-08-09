import type { GameMode, Rot } from '@lifesim/shared';
import { setWall } from './lot.js';
import type { ContentPack, EntityId, HudProjection, World } from './types.js';
import { formatClock } from './clock.js';
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

export type SimCommands = {
  setMode: (mode: GameMode) => void;
  setSpeed: (speed: 0 | 1 | 2 | 3) => void;
  setPaused: (paused: boolean) => void;
  selectSim: (id: EntityId | null) => void;
  setWorldTarget: (id: EntityId | null) => void;
  enqueueInteraction: (simId: EntityId, interactionId: string, targetId: EntityId | null) => void;
  cancelAction: (simId: EntityId) => void;
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
      world.mode = mode;
      if (mode === 'build' || mode === 'buy') {
        world.clock.paused = true;
      }
      if (mode === 'live') {
        world.ui.modeTool = null;
        world.ui.buyGhost = null;
      }
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
    },
    setWorldTarget(id) {
      world.ui.targetEntityId = id;
    },
    enqueueInteraction(simId, interactionId, targetId) {
      const sim = getSim(world, simId);
      if (!sim || sim.presence !== 'on_lot') return;
      sim.queue.items.push({ interactionId, targetId, playerQueued: true });
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
    placeObject(defId, x, y, rot = 0) {
      const def = content.objects.find((o) => o.id === defId);
      if (!def) return false;
      if (world.household.funds < def.price) {
        world.eventBus.push({ type: 'toast', message: 'Not enough funds' });
        return false;
      }
      world.household.funds -= def.price;
      spawnObject(world, def, x, y, rot);
      return true;
    },
    deleteObject(id) {
      const obj = getObject(world, id);
      if (!obj) return;
      const def = content.objects.find((o) => o.id === obj.defId);
      if (def) world.household.funds += Math.floor(def.price * 0.5);
      // Invalidate queues targeting this object
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
      world.entities.delete(id);
      refreshLotCaches(world);
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
      // Clear existing sims only
      for (const id of [...world.household.memberIds]) {
        world.entities.delete(id);
      }
      world.household.memberIds = [];
      world.household.name = opts.householdName;
      world.household.funds = opts.funds;
      let i = 0;
      for (const m of opts.members) {
        spawnSim(world, {
          firstName: m.firstName,
          lastName: m.lastName,
          x: 12 + i * 2,
          y: 14,
          traits: m.traits,
          aspirationId: m.aspirationId,
          visual: m.visual,
        });
        i++;
      }
      if (allObjects(world).length === 0) {
        // Place furniture without extra demo sims
        const place = (id: string, x: number, y: number) => {
          const def = content.objects.find((o) => o.id === id);
          if (def) spawnObject(world, def, x, y);
        };
        place('object.fridge_basic', 9, 9);
        place('object.stove_basic', 11, 9);
        place('object.table_dining', 14, 12);
        place('object.bed_double', 18, 10);
        place('object.toilet_basic', 9, 17);
        place('object.shower_basic', 11, 17);
        place('object.sofa_basic', 16, 16);
        place('object.tv_basic', 16, 18);
      }
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

  let target: HudProjection['target'] = null;
  if (world.ui.targetEntityId != null) {
    const ent = world.entities.get(world.ui.targetEntityId);
    if (ent?.kind === 'object') {
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
    } else if (ent?.kind === 'sim') {
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
    householdSims: sims.map((s) => ({
      id: s.id,
      name: `${s.identity.firstName} ${s.identity.lastName}`,
      mood: s.mood.value,
      presence: s.presence,
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
        }
      : null,
    target,
    toasts,
  };
}
