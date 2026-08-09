import type { GameMode, Rot } from '@lifesim/shared';
import { formatClock } from './clock.js';
import { describeSimActivity } from './activity.js';
import { cellIndex, inBounds, setWall } from './lot.js';
import {
  getPlaceMeta,
  refreshPlaceCaches,
  setActivePlace,
  travelSimToPlace,
} from './neighborhood.js';
import { ensureNpcsSpawned, FLIRT_MIN_FRIENDSHIP, getNpcDef, isNpc } from './npc.js';
import { getObs } from './observability/hub.js';
import { findPath, nearestWalkable } from './pathfinding.js';
import { getRelationship } from './relationships.js';
import type { ContentPack, EntityId, HudProjection, SimEntity, World } from './types.js';
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

/** Player work skips before the Sim is fired. */
export const WORK_SKIP_FIRE_COUNT = 3;
const WORK_SKIP_PERF_PENALTY = 28;

export type BusyInfo = {
  busy: boolean;
  /** Player-facing activity, e.g. "Working" / "Watching TV" */
  activityLabel: string;
  atWork: boolean;
  name: string;
};

export type InterruptResult = {
  interrupted: boolean;
  leftWork: boolean;
  fired: boolean;
};

export type SimCommands = {
  setMode: (mode: GameMode) => void;
  setSpeed: (speed: 0 | 1 | 2 | 3) => void;
  setPaused: (paused: boolean) => void;
  selectSim: (id: EntityId | null) => void;
  setWorldTarget: (id: EntityId | null) => void;
  enqueueInteraction: (simId: EntityId, interactionId: string, targetId: EntityId | null) => void;
  cancelAction: (simId: EntityId) => void;
  /** Whether the Sim is mid-action / at work and needs a stop confirm. */
  getBusyInfo: (simId?: EntityId | null) => BusyInfo;
  /**
   * Drop current action + queue; if at work, leave the shift (job risk).
   * Call before forcing a new player command after the player confirms.
   */
  interruptForPlayer: (simId: EntityId) => InterruptResult;
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
  /**
   * Selected household Sim talks to another Sim/NPC.
   * Travels to their place if needed, then queues Talk (chat).
   */
  talkTo: (targetSimId: EntityId, simId?: EntityId | null) => boolean;
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** True only while actually doing an activity — walking / pathing does not count. */
function isEngagedInActivity(sim: SimEntity): boolean {
  return sim.action.kind === 'performing';
}

function clearSimActionState(world: World, sim: SimEntity): void {
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
  sim.path.waypoints = [];
  sim.path.index = 0;
  sim.anim.clip = 'idle';
  sim.action = { kind: 'idle' };
}

export function createCommands(world: World, content: ContentPack): SimCommands {
  const applyWorkSkipPenalty = (sim: SimEntity): boolean => {
    if (!sim.career.trackId) return false;
    sim.career.skipCount = (sim.career.skipCount ?? 0) + 1;
    sim.career.performance = clamp(
      sim.career.performance - WORK_SKIP_PERF_PENALTY,
      0,
      100,
    );
    const skips = sim.career.skipCount;
    const fired = skips >= WORK_SKIP_FIRE_COUNT || sim.career.performance <= 0;
    if (fired) {
      const job =
        content.careers.find((c) => c.id === sim.career.trackId)?.nameKey ?? 'their job';
      sim.career = {
        trackId: null,
        level: 0,
        performance: 50,
        daysWorked: sim.career.daysWorked,
        skipCount: 0,
      };
      world.eventBus.push({
        type: 'toast',
        message: `${sim.identity.firstName} was fired from ${job} for skipping work too often`,
      });
      getObs().event('career.fired', 'career', { simId: sim.id, skips });
      return true;
    }
    const left = WORK_SKIP_FIRE_COUNT - skips;
    world.eventBus.push({
      type: 'toast',
      message: `${sim.identity.firstName} left work early (boss noticed — ${left} warning${left === 1 ? '' : 's'} left)`,
    });
    return false;
  };

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
      if (id != null) {
        const sim = getSim(world, id);
        if (!sim || isNpc(sim)) return;
        world.ui.selectedSimId = id;
        setActivePlace(world, sim.placeId);
        return;
      }
      world.ui.selectedSimId = null;
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
    getBusyInfo(simId) {
      const id = simId ?? world.ui.selectedSimId;
      if (id == null) {
        return { busy: false, activityLabel: 'Idle', atWork: false, name: 'Sim' };
      }
      const sim = getSim(world, id);
      if (!sim) {
        return { busy: false, activityLabel: 'Idle', atWork: false, name: 'Sim' };
      }
      const activity = describeSimActivity(sim, content, world);
      const atWork = sim.presence === 'at_work';
      // Walking / en route never needs a stop confirm — only at-activity or at work
      const busy = atWork || isEngagedInActivity(sim);
      return {
        busy,
        activityLabel: activity.label,
        atWork,
        name: sim.identity.firstName,
      };
    },
    interruptForPlayer(simId) {
      const sim = getSim(world, simId);
      if (!sim) {
        return { interrupted: false, leftWork: false, fired: false };
      }
      const wasBusy =
        sim.presence === 'at_work' || isEngagedInActivity(sim) || sim.queue.items.length > 0;
      const leftWork = sim.presence === 'at_work';
      let fired = false;
      if (leftWork) {
        fired = applyWorkSkipPenalty(sim);
        sim.presence = 'on_lot';
        // Stay at the workplace lot so the player can command them immediately
      }
      clearSimActionState(world, sim);
      sim.autonomy.nextPlanTick = world.clock.tick + 4;
      getObs().event('action.interrupt_player', 'input', {
        simId,
        leftWork,
        fired,
      });
      return { interrupted: wasBusy, leftWork, fired };
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
    talkTo(targetSimId, simId) {
      const id = simId ?? world.ui.selectedSimId;
      if (id == null) {
        world.eventBus.push({ type: 'toast', message: 'Select a household Sim first' });
        return false;
      }
      const sim = getSim(world, id);
      const other = getSim(world, targetSimId);
      if (!sim || sim.role === 'npc') {
        world.eventBus.push({ type: 'toast', message: 'Select a household Sim first' });
        return false;
      }
      if (!other || other.id === sim.id) {
        world.eventBus.push({ type: 'toast', message: 'Nobody to talk to' });
        return false;
      }
      if (sim.presence === 'at_work') {
        world.eventBus.push({
          type: 'toast',
          message: `${sim.identity.firstName} is at work — confirm to pull them off the job first`,
        });
        return false;
      }
      if (other.presence !== 'on_lot') {
        world.eventBus.push({
          type: 'toast',
          message: `${other.identity.firstName} is not available right now`,
        });
        return false;
      }

      world.ui.targetEntityId = other.id;
      // Meet them where they are
      if (sim.placeId !== other.placeId) {
        const traveled = travelSimToPlace(world, sim.id, other.placeId);
        if (!traveled) {
          world.eventBus.push({
            type: 'toast',
            message: `Could not reach ${other.identity.firstName}`,
          });
          return false;
        }
        setActivePlace(world, other.placeId);
      }

      clearSimActionState(world, sim);
      sim.queue.items.push({
        interactionId: 'interact.chat',
        targetId: other.id,
        playerQueued: true,
      });
      world.eventBus.push({
        type: 'toast',
        message: `${sim.identity.firstName} is going to talk with ${other.identity.firstName}`,
      });
      getObs().event('action.talk', 'input', {
        simId: sim.id,
        targetId: other.id,
      });
      return true;
    },
    cancelAction(simId) {
      const sim = getSim(world, simId);
      if (!sim) return;
      // Soft cancel (no work penalty) — use interruptForPlayer when pulling off a job
      if (sim.presence === 'at_work') {
        world.eventBus.push({
          type: 'toast',
          message: `${sim.identity.firstName} is at work — confirm to pull them off the job`,
        });
        return;
      }
      if (
        sim.action.kind === 'idle' &&
        sim.queue.items.length === 0 &&
        sim.path.waypoints.length === 0
      ) {
        return;
      }
      clearSimActionState(world, sim);
    },
    walkTo(x, y, simId) {
      const id = simId ?? world.ui.selectedSimId;
      if (id == null) {
        world.eventBus.push({ type: 'toast', message: 'Select a Sim first' });
        return false;
      }
      const sim = getSim(world, id);
      if (!sim) {
        world.eventBus.push({ type: 'toast', message: 'Select a Sim first' });
        return false;
      }
      if (sim.presence === 'at_work') {
        world.eventBus.push({
          type: 'toast',
          message: `${sim.identity.firstName} is at work — confirm to pull them off the job first`,
        });
        return false;
      }
      if (sim.presence !== 'on_lot') {
        world.eventBus.push({
          type: 'toast',
          message: `${sim.identity.firstName} cannot walk right now`,
        });
        return false;
      }
      if (sim.placeId !== world.neighborhood.activePlaceId) {
        const here = getPlaceMeta(world, world.neighborhood.activePlaceId)?.name ?? 'this place';
        world.eventBus.push({
          type: 'toast',
          message: `${sim.identity.firstName} is not at ${here} — travel there first`,
        });
        return false;
      }
      const lot = world.lots[sim.placeId] ?? world.lot;
      const gx = Math.round(x);
      const gy = Math.round(y);
      if (!inBounds(lot, gx, gy)) {
        world.eventBus.push({ type: 'toast', message: 'That spot is outside the lot' });
        return false;
      }
      const goal = nearestWalkable(lot, gx, gy, 4);
      if (!goal) {
        world.eventBus.push({
          type: 'toast',
          message: 'That tile is blocked — no nearby walkable spot',
        });
        return false;
      }
      const start = {
        x: Math.round(sim.transform.x),
        y: Math.round(sim.transform.y),
      };
      let pathStart = start;
      if (!inBounds(lot, start.x, start.y) || !lot.walkable[cellIndex(lot, start.x, start.y)]) {
        const nearStart = nearestWalkable(lot, start.x, start.y, 4);
        if (!nearStart) {
          world.eventBus.push({
            type: 'toast',
            message: `${sim.identity.firstName} is stuck and cannot path`,
          });
          return false;
        }
        pathStart = nearStart;
        sim.transform.x = nearStart.x;
        sim.transform.y = nearStart.y;
      }
      const path = findPath(lot, pathStart, goal);
      if (!path || path.length === 0) {
        world.eventBus.push({
          type: 'toast',
          message: 'No path — walls or objects block the way',
        });
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
      sim.anim.clip = path.length > 1 ? 'walk' : 'idle';
      // Player walk must run — unpause so pathing ticks
      if (world.clock.paused || world.clock.speed === 0) {
        world.clock.paused = false;
        if (world.clock.speed === 0) world.clock.speed = 1;
      }
      // Hold autonomy off until arrival (+ buffer)
      sim.autonomy.nextPlanTick = world.clock.tick + Math.max(path.length, 1) + 8;
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
      if (!sim || isNpc(sim)) return;
      if (!content.careers.find((c) => c.id === trackId)) return;
      sim.career = { trackId, level: 0, performance: 50, daysWorked: 0, skipCount: 0 };
      world.eventBus.push({
        type: 'toast',
        message: `${sim.identity.firstName} joined a career`,
      });
    },
    debugSpawnHousehold() {
      debugSpawnHousehold(world, content);
      ensureNpcsSpawned(world, content);
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
        ensureNpcsSpawned(world, content);
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
      ensureNpcsSpawned(world, content);
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
  // Never treat an NPC as the controlled Sim
  if (world.ui.selectedSimId != null) {
    const cur = getSim(world, world.ui.selectedSimId);
    if (!cur || isNpc(cur)) {
      world.ui.selectedSimId = world.household.memberIds[0] ?? null;
    }
  }
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
      const npcDef = getNpcDef(content, ent.npcDefId);
      const rel =
        selected && selected.id !== ent.id
          ? getRelationship(world.relationships, selected.id, ent.id)
          : null;
      const social = content.interactions
        .filter((i) => i.social)
        .map((i) => {
          let enabled = ent.id !== selected?.id;
          let failReasonKey: string | undefined;
          if (enabled && i.id.includes('flirt')) {
            if ((rel?.friendship ?? 0) < FLIRT_MIN_FRIENDSHIP) {
              enabled = false;
              failReasonKey = 'need_friendship';
            }
          }
          return {
            id: i.id,
            labelKey: i.nameKey,
            enabled,
            failReasonKey,
          };
        });
      const aspirationLabel =
        content.aspirations.find((a) => a.id === ent.aspiration.defId)?.nameKey ?? null;
      const traitLabels = ent.traits.ids.map(
        (tid) => content.traits.find((t) => t.id === tid)?.nameKey ?? tid,
      );
      target = {
        id: ent.id,
        kind: 'sim',
        label: `${ent.identity.firstName} ${ent.identity.lastName}`,
        role: ent.role,
        bio: npcDef?.bio ?? null,
        traits: traitLabels,
        aspirationLabel,
        relationship: selected
          ? {
              friendship: rel?.friendship ?? 0,
              romance: rel?.romance ?? 0,
              met: !!rel?.flags.includes('met'),
            }
          : null,
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
    householdSims: sims
      .filter((s) => s.role === 'household' && world.household.memberIds.includes(s.id))
      .map((s) => ({
        id: s.id,
        name: `${s.identity.firstName} ${s.identity.lastName}`,
        mood: s.mood.value,
        presence: s.presence,
        placeId: s.placeId,
        placeName: getPlaceMeta(world, s.placeId)?.name ?? s.placeId,
        needs: { ...s.needs },
      })),
    people: sims
      .filter((s) => s.id !== selected?.id && s.presence === 'on_lot')
      .filter((s) => s.role === 'npc' || s.role === 'household')
      .map((s) => {
        const rel = selected
          ? getRelationship(world.relationships, selected.id, s.id)
          : null;
        const npcDef = getNpcDef(content, s.npcDefId);
        return {
          id: s.id,
          name: `${s.identity.firstName} ${s.identity.lastName}`,
          role: s.role,
          placeId: s.placeId,
          placeName: getPlaceMeta(world, s.placeId)?.name ?? s.placeId,
          here: s.placeId === activeId,
          bio: npcDef?.bio ?? null,
          friendship: rel?.friendship ?? 0,
          met: !!rel?.flags.includes('met'),
        };
      })
      .sort((a, b) => {
        if (a.here !== b.here) return a.here ? -1 : 1;
        if (a.role !== b.role) return a.role === 'npc' ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    selectedSim:
      selected && selected.role === 'household'
        ? (() => {
            const activity = describeSimActivity(selected, content, world);
            return {
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
              presence: selected.presence,
              activityLabel: activity.label,
              activityDetail: activity.detail,
              activityPhase: activity.phase,
            };
          })()
        : null,
    target,
    toasts,
  };
}
