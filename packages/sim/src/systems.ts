import { advanceClock, isWeekend } from './clock.js';
import { findPath } from './pathfinding.js';
import { addRelationshipDelta } from './relationships.js';
import { nextRng } from './rng.js';
import type {
  ActionFailReason,
  ContentPack,
  EntityId,
  InteractionDef,
  ObjectDef,
  ObjectEntity,
  SimEntity,
  World,
} from './types.js';
import { allObjects, allSims, getObject, getSim, refreshLotCaches } from './world.js';

const NEED_KEYS = ['hunger', 'energy', 'bladder', 'hygiene', 'fun', 'social'] as const;

/** Per-game-hour base decay (applied as /60 per tick). */
const NEED_DECAY_PER_HOUR: Record<(typeof NEED_KEYS)[number], number> = {
  hunger: 8,
  energy: 5,
  bladder: 7,
  hygiene: 3,
  fun: 4,
  social: 3,
};

export function clearSocialPair(world: World, sim: SimEntity): void {
  if (!sim.socialLock) return;
  const partner = getSim(world, sim.socialLock.partnerId);
  if (partner?.socialLock?.partnerId === sim.id) {
    partner.socialLock = null;
  }
  sim.socialLock = null;
}

function failAction(world: World, sim: SimEntity, interactionId: string, reason: ActionFailReason): void {
  releaseSlot(world, sim);
  clearSocialPair(world, sim);
  sim.action = { kind: 'failed', interactionId, reason };
  sim.path.waypoints = [];
  sim.path.index = 0;
  world.eventBus.push({ type: 'action_failed', simId: sim.id, reason });
  world.eventBus.push({ type: 'toast', message: `${sim.identity.firstName}: ${reason.replace(/_/g, ' ')}` });
}

function releaseSlot(world: World, sim: SimEntity): void {
  for (const o of allObjects(world)) {
    for (const s of o.slots) {
      if (s.reservedBy === sim.id) {
        s.reservedBy = null;
        s.reservedUntilTick = 0;
      }
    }
  }
}

function getDef(content: ContentPack, id: string): InteractionDef | undefined {
  return content.interactions.find((i) => i.id === id);
}

function getObjectDef(content: ContentPack, id: string): ObjectDef | undefined {
  return content.objects.find((o) => o.id === id);
}

function slotWorldPos(
  obj: ObjectEntity,
  slotOffset: { x: number; y: number },
): { x: number; y: number } {
  // Simple rotation of offset for v1
  const r = obj.transform.rot;
  let ox = slotOffset.x;
  let oy = slotOffset.y;
  for (let i = 0; i < r; i++) {
    const nx = -oy;
    const ny = ox;
    ox = nx;
    oy = ny;
  }
  return {
    x: Math.round(obj.transform.x + ox),
    y: Math.round(obj.transform.y + oy),
  };
}

export function findBestChainTarget(
  world: World,
  content: ContentPack,
  sim: SimEntity,
  interactionId: string,
  requireSurfaceTags?: string[],
): EntityId | null {
  const idef = getDef(content, interactionId);
  if (!idef) return null;
  let best: { id: EntityId; dist: number } | null = null;
  for (const obj of allObjects(world)) {
    const odef = getObjectDef(content, obj.defId);
    if (!odef) continue;
    if (!odef.interactions.includes(interactionId)) continue;
    if (requireSurfaceTags?.length) {
      if (!requireSurfaceTags.every((t) => odef.tags.includes(t))) continue;
    }
    if (idef.requires?.objectTags?.length) {
      if (!idef.requires.objectTags.every((t) => odef.tags.includes(t))) continue;
    }
    if (idef.requires?.objectState && obj.state !== idef.requires.objectState) continue;
    if (idef.slotTag) {
      const free = obj.slots.some((s) => {
        const sd = odef.slots.find((d) => d.id === s.slotId);
        return (
          sd?.tags.includes(idef.slotTag!) &&
          (!sd.exclusive || s.reservedBy === null || s.reservedBy === sim.id)
        );
      });
      if (!free) continue;
    }
    const dist =
      Math.abs(obj.transform.x - sim.transform.x) +
      Math.abs(obj.transform.y - sim.transform.y);
    if (!best || dist < best.dist || (dist === best.dist && obj.id < best.id)) {
      best = { id: obj.id, dist };
    }
  }
  return best?.id ?? null;
}

function applyOutcomes(
  world: World,
  content: ContentPack,
  sim: SimEntity,
  idef: InteractionDef,
  targetId: EntityId | null,
): void {
  const o = idef.outcomes;
  if (o.needs) {
    for (const k of NEED_KEYS) {
      if (o.needs[k] !== undefined) {
        sim.needs[k] = clamp(sim.needs[k] + o.needs[k]!, 0, 100);
      }
    }
  }
  if (o.skillXp) {
    for (const [sk, xp] of Object.entries(o.skillXp)) {
      sim.skills[sk] = clamp((sim.skills[sk] ?? 0) + xp / 100, 0, 10);
    }
  }
  if (o.moodBuff) {
    sim.mood.modifiers.push({
      id: o.moodBuff.id,
      amount: o.moodBuff.amount,
      untilTick: world.clock.tick + o.moodBuff.durationTicks,
    });
  }
  if (o.giveHeldItem) sim.inventory.held = o.giveHeldItem;
  if (o.clearHeldItem) sim.inventory.held = null;
  if (o.funds) world.household.funds += o.funds;

  const target = targetId != null ? world.entities.get(targetId) : null;
  if (target?.kind === 'object') {
    if (o.setObjectState) target.state = o.setObjectState;
    if (o.setCrafting) {
      target.crafting = {
        chainId: o.setCrafting.chainId,
        stageId: o.setCrafting.stageId,
        ownerSimId: o.setCrafting.captureOwner === false ? null : sim.id,
        ticksRemaining: o.setCrafting.ticksRemaining ?? 0,
        outputHeldItem: o.setCrafting.outputHeldItem,
      };
    }
    if (o.clearCrafting) delete target.crafting;
  }
  if (target?.kind === 'sim' && o.relationship) {
    addRelationshipDelta(
      world.relationships,
      sim.id,
      target.id,
      o.relationship.friendship ?? 0,
      o.relationship.romance ?? 0,
    );
  }

  // Aspiration progress hooks
  if (idef.id.includes('cook') || idef.id.includes('meal') || idef.id.includes('eat')) {
    if (sim.aspiration.defId === 'aspiration.master_chef') sim.aspiration.progress += 1;
  }
  if (idef.social && sim.aspiration.defId === 'aspiration.friendly') {
    sim.aspiration.progress += 1;
  }

  // Chain continuation
  if (idef.chain) {
    const nextId = idef.chain.nextInteractionId;
    const nextTarget = findBestChainTarget(
      world,
      content,
      sim,
      nextId,
      idef.chain.requireSurfaceTags,
    );
    if (nextTarget != null) {
      sim.queue.items.unshift({
        interactionId: nextId,
        targetId: nextTarget,
        playerQueued: false,
      });
    } else {
      world.eventBus.push({
        type: 'toast',
        message: `${sim.identity.firstName}: no place for next step`,
      });
      // leave held/crafting intact
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// --- Systems ---

export function systemTime(world: World): void {
  if (world.mode !== 'live' || world.clock.paused || world.clock.speed === 0) return;
  // one sim tick per call when speed accounted by loop
  advanceClock(world.clock, 1);
  // Light weather change
  if (world.clock.minuteOfDay === 0 && nextRng(world.rng) < 0.3) {
    world.weather = nextRng(world.rng) < 0.5 ? 'rain' : 'sunny';
  }
}

export function systemNeedDecay(world: World, content: ContentPack): void {
  for (const sim of allSims(world)) {
    if (sim.presence !== 'on_lot') continue;
    let mult: Partial<Record<(typeof NEED_KEYS)[number], number>> = {};
    for (const tid of sim.traits.ids) {
      const t = content.traits.find((x) => x.id === tid);
      if (t?.needDecayMult) mult = { ...mult, ...t.needDecayMult };
    }
    for (const k of NEED_KEYS) {
      const perHour = NEED_DECAY_PER_HOUR[k] * (mult[k] ?? 1);
      let d = perHour / 60;
      if (k === 'fun' && world.weather === 'rain') {
        // outdoor penalty if outdoor cell — simplified
        d *= 1.1;
      }
      sim.needs[k] = clamp(sim.needs[k] - d, 0, 100);
    }
    // Critical energy
    if (sim.needs.energy <= 0 && sim.action.kind === 'performing') {
      failAction(world, sim, sim.action.interactionId, 'preempted_critical');
    }
  }
}

export function systemMood(world: World): void {
  for (const sim of allSims(world)) {
    sim.mood.modifiers = sim.mood.modifiers.filter((m) => m.untilTick > world.clock.tick);
    const n = sim.needs;
    const base =
      (n.hunger + n.energy + n.bladder + n.hygiene + n.fun + n.social) / 6;
    const buff = sim.mood.modifiers.reduce((s, m) => s + m.amount, 0);
    sim.mood.value = clamp(base + buff, 0, 100);
  }
}

export function systemCareerSchedule(world: World, content: ContentPack): void {
  if (isWeekend(world.clock)) {
    // weekend off for v1 office/chef
  }
  for (const sim of allSims(world)) {
    if (!sim.career.trackId) continue;
    const career = content.careers.find((c) => c.id === sim.career.trackId);
    if (!career) continue;
    const dayOk = career.schedule.days.includes(world.clock.dayOfWeek);
    const min = world.clock.minuteOfDay;
    const working =
      dayOk && min >= career.schedule.startMinute && min < career.schedule.endMinute;

    if (working && sim.presence === 'on_lot') {
      // Preempt
      if (sim.action.kind !== 'idle') {
        const iid =
          sim.action.kind === 'performing' ||
          sim.action.kind === 'pathing' ||
          sim.action.kind === 'pending'
            ? sim.action.interactionId
            : 'work';
        failAction(world, sim, iid, 'preempted_work');
      }
      sim.queue.items = [];
      clearSocialPair(world, sim);
      sim.presence = 'at_work';
      sim.anim.clip = 'idle';
      world.eventBus.push({ type: 'work_left', simId: sim.id });
      world.eventBus.push({
        type: 'toast',
        message: `${sim.identity.firstName} left for work`,
      });
    }
    if (!working && sim.presence === 'at_work') {
      const level = career.levels[sim.career.level] ?? career.levels[0];
      const pay = level.payPerDay;
      world.household.funds += pay;
      sim.career.daysWorked += 1;
      sim.career.performance = clamp(sim.career.performance + 5, 0, 100);
      // promotion
      if (
        sim.career.performance >= 80 &&
        sim.career.level < career.levels.length - 1
      ) {
        const next = career.levels[sim.career.level + 1];
        const req = next.requiredSkill;
        if (!req || (sim.skills[req.id] ?? 0) >= req.min) {
          sim.career.level += 1;
          sim.career.performance = 40;
          world.eventBus.push({
            type: 'toast',
            message: `${sim.identity.firstName} promoted!`,
          });
        }
      }
      const entry = world.lot.entryMarkers[0] ?? { x: 14, y: 21 };
      sim.transform.x = entry.x;
      sim.transform.y = entry.y;
      sim.presence = 'on_lot';
      sim.needs.social = clamp(sim.needs.social + 10, 0, 100);
      sim.needs.fun = clamp(sim.needs.fun - 10, 0, 100);
      world.eventBus.push({ type: 'work_return', simId: sim.id, pay });
      world.eventBus.push({
        type: 'toast',
        message: `${sim.identity.firstName} returned (+$${pay})`,
      });
    }
  }
}

export function systemInteractionProgress(world: World, content: ContentPack): void {
  for (const sim of allSims(world)) {
    if (sim.presence !== 'on_lot') continue;

    // Clear transient succeeded/failed
    if (sim.action.kind === 'succeeded' || sim.action.kind === 'failed') {
      sim.action = { kind: 'idle' };
    }

    // Start pending from queue
    if (sim.action.kind === 'idle' && sim.queue.items.length > 0) {
      const item = sim.queue.items.shift()!;
      sim.action = {
        kind: 'pending',
        interactionId: item.interactionId,
        targetId: item.targetId,
      };
    }

    if (sim.action.kind === 'pending') {
      const idef = getDef(content, sim.action.interactionId);
      if (!idef) {
        failAction(world, sim, sim.action.interactionId, 'target_invalid');
        continue;
      }
      // skill gate
      if (idef.requires?.skill) {
        const sk = sim.skills[idef.requires.skill.id] ?? 0;
        if (sk < idef.requires.skill.min) {
          failAction(world, sim, idef.id, 'skill_gate');
          continue;
        }
      }
      if (idef.requires?.heldItem && sim.inventory.held !== idef.requires.heldItem) {
        failAction(world, sim, idef.id, 'target_invalid');
        continue;
      }

      if (idef.social && sim.action.targetId != null) {
        const partner = getSim(world, sim.action.targetId);
        if (!partner || partner.presence !== 'on_lot') {
          failAction(world, sim, idef.id, 'target_invalid');
          continue;
        }
        // path to adjacent
        const goal = {
          x: Math.round(partner.transform.x),
          y: Math.round(partner.transform.y),
        };
        // pick neighbor cell
        const neigh = [
          { x: goal.x + 1, y: goal.y },
          { x: goal.x - 1, y: goal.y },
          { x: goal.x, y: goal.y + 1 },
          { x: goal.x, y: goal.y - 1 },
        ];
        let bestPath: { x: number; y: number }[] | null = null;
        for (const n of neigh) {
          const p = findPath(
            world.lot,
            { x: Math.round(sim.transform.x), y: Math.round(sim.transform.y) },
            n,
          );
          if (p && (!bestPath || p.length < bestPath.length)) bestPath = p;
        }
        if (!bestPath) {
          failAction(world, sim, idef.id, 'path_impossible');
          continue;
        }
        sim.path.waypoints = bestPath;
        sim.path.index = 0;
        sim.action = {
          kind: 'pathing',
          interactionId: idef.id,
          targetId: partner.id,
          fails: 0,
        };
        continue;
      }

      // Object interaction
      const target = sim.action.targetId != null ? getObject(world, sim.action.targetId) : null;
      if (!target) {
        failAction(world, sim, idef.id, 'target_invalid');
        continue;
      }
      const odef = getObjectDef(content, target.defId);
      if (!odef) {
        failAction(world, sim, idef.id, 'target_invalid');
        continue;
      }
      if (idef.requires?.objectState && target.state !== idef.requires.objectState) {
        failAction(world, sim, idef.id, 'object_state');
        continue;
      }
      let approach = {
        x: Math.round(target.transform.x),
        y: Math.round(target.transform.y) + 1,
      };
      let slotId: string | null = null;
      if (idef.slotTag) {
        const slotDef = odef.slots.find((s) => s.tags.includes(idef.slotTag!));
        const runtime = target.slots.find((s) => s.slotId === slotDef?.id);
        if (!slotDef || !runtime) {
          failAction(world, sim, idef.id, 'slot_taken');
          continue;
        }
        if (
          slotDef.exclusive &&
          runtime.reservedBy != null &&
          runtime.reservedBy !== sim.id
        ) {
          failAction(world, sim, idef.id, 'slot_taken');
          continue;
        }
        approach = slotWorldPos(target, slotDef.offset);
        slotId = slotDef.id;
      }
      const path = findPath(
        world.lot,
        { x: Math.round(sim.transform.x), y: Math.round(sim.transform.y) },
        approach,
      );
      if (!path) {
        failAction(world, sim, idef.id, 'path_impossible');
        continue;
      }
      sim.path.waypoints = path;
      sim.path.index = 0;
      // reserve slot
      if (slotId) {
        const runtime = target.slots.find((s) => s.slotId === slotId)!;
        runtime.reservedBy = sim.id;
        runtime.reservedUntilTick = world.clock.tick + idef.durationTicks + 200;
      }
      sim.action = {
        kind: 'pathing',
        interactionId: idef.id,
        targetId: target.id,
        fails: 0,
      };
      // stash slot on performing later via re-lookup
      (sim as unknown as { _slotId?: string })._slotId = slotId ?? undefined;
    }
  }
}

export function systemPath(world: World, content: ContentPack): void {
  for (const sim of allSims(world)) {
    if (sim.presence !== 'on_lot') continue;
    if (sim.action.kind !== 'pathing') {
      if (sim.path.waypoints.length === 0) {
        if (sim.anim.clip === 'walk') sim.anim.clip = 'idle';
      }
      continue;
    }
    const wps = sim.path.waypoints;
    if (sim.path.index >= wps.length) {
      // arrived
      const idef = getDef(content, sim.action.interactionId);
      if (!idef) {
        failAction(world, sim, sim.action.interactionId, 'target_invalid');
        continue;
      }
      // social lock
      if (idef.social && sim.action.targetId != null) {
        const partner = getSim(world, sim.action.targetId);
        if (!partner || partner.presence !== 'on_lot') {
          failAction(world, sim, idef.id, 'partner_left');
          continue;
        }
        const until = world.clock.tick + idef.durationTicks;
        sim.socialLock = { partnerId: partner.id, untilTick: until, role: 'initiator' };
        partner.socialLock = { partnerId: sim.id, untilTick: until, role: 'partner' };
      }
      const slotId = (sim as unknown as { _slotId?: string })._slotId ?? null;
      sim.action = {
        kind: 'performing',
        interactionId: idef.id,
        targetId: sim.action.targetId,
        ticksLeft: idef.durationTicks,
        slotId,
      };
      sim.anim.clip = idef.social ? 'idle' : 'use';
      sim.path.waypoints = [];
      sim.path.index = 0;
      continue;
    }
    const target = wps[sim.path.index];
    const dx = target.x - sim.transform.x;
    const dy = target.y - sim.transform.y;
    const dist = Math.hypot(dx, dy);
    sim.anim.clip = 'walk';
    if (dist < 0.05) {
      sim.transform.x = target.x;
      sim.transform.y = target.y;
      sim.path.index += 1;
    } else {
      const step = Math.min(sim.path.speed, dist);
      sim.transform.x += (dx / dist) * step;
      sim.transform.y += (dy / dist) * step;
      if (Math.abs(dx) > Math.abs(dy)) {
        sim.transform.facing = dx > 0 ? 1 : 3;
      } else {
        sim.transform.facing = dy > 0 ? 2 : 0;
      }
      sim.anim.facing = sim.transform.facing;
    }
  }
}

export function systemPerforming(world: World, content: ContentPack): void {
  for (const sim of allSims(world)) {
    if (sim.action.kind !== 'performing') continue;
    if (sim.action.ticksLeft > 0) {
      sim.action.ticksLeft -= 1;
      // partner left check for social
      const idef = getDef(content, sim.action.interactionId);
      if (idef?.social && sim.action.targetId != null) {
        const partner = getSim(world, sim.action.targetId);
        if (!partner || partner.presence !== 'on_lot') {
          failAction(world, sim, idef.id, 'partner_left');
        }
      }
      continue;
    }
    // complete
    const idef = getDef(content, sim.action.interactionId);
    if (!idef) {
      failAction(world, sim, sim.action.interactionId, 'target_invalid');
      continue;
    }
    applyOutcomes(world, content, sim, idef, sim.action.targetId);
    releaseSlot(world, sim);
    clearSocialPair(world, sim);
    sim.anim.clip = 'idle';
    world.eventBus.push({
      type: 'action_done',
      simId: sim.id,
      interactionId: idef.id,
    });
    sim.action = { kind: 'succeeded', interactionId: idef.id };
  }
}

export function systemAutonomy(world: World, content: ContentPack): void {
  for (const sim of allSims(world)) {
    if (sim.presence !== 'on_lot') continue;
    if (sim.socialLock) continue;
    if (world.clock.tick < sim.autonomy.nextPlanTick) continue;
    if (sim.action.kind !== 'idle' || sim.queue.items.length > 0) continue;
    if (world.clock.tick < sim.autonomy.cooldownUntil) continue;

    type Cand = { interactionId: string; targetId: EntityId | null; score: number };
    const cands: Cand[] = [];

    // Object affordances
    for (const obj of allObjects(world)) {
      const odef = getObjectDef(content, obj.defId);
      if (!odef) continue;
      for (const iid of odef.interactions) {
        const idef = getDef(content, iid);
        if (!idef || idef.social) continue;
        if (idef.slotTag) {
          const free = obj.slots.some((s) => {
            const sd = odef.slots.find((d) => d.id === s.slotId);
            return (
              sd?.tags.includes(idef.slotTag!) &&
              (!sd.exclusive || s.reservedBy === null)
            );
          });
          if (!free) continue;
        }
        if (idef.requires?.heldItem && sim.inventory.held !== idef.requires.heldItem) {
          continue;
        }
        if (idef.requires?.skill) {
          if ((sim.skills[idef.requires.skill.id] ?? 0) < idef.requires.skill.min) continue;
        }
        let score = idef.autonomyWeight ?? 1;
        if (idef.ads) {
          for (const k of NEED_KEYS) {
            const w = idef.ads[k] ?? 0;
            score += w * (100 - sim.needs[k]) * 0.02;
          }
        }
        score += sim.mood.value * 0.01;
        const dist =
          Math.abs(obj.transform.x - sim.transform.x) +
          Math.abs(obj.transform.y - sim.transform.y);
        score -= dist * 0.05;
        cands.push({ interactionId: iid, targetId: obj.id, score });
      }
    }

    // Social
    for (const other of allSims(world)) {
      if (other.id === sim.id || other.presence !== 'on_lot') continue;
      if (other.socialLock) continue;
      for (const idef of content.interactions) {
        if (!idef.social) continue;
        let score = (idef.autonomyWeight ?? 1) + (100 - sim.needs.social) * 0.03;
        cands.push({ interactionId: idef.id, targetId: other.id, score });
      }
    }

    // Deterministic: sort by id first, score with noise, pick best
    cands.sort((a, b) => {
      if (a.interactionId !== b.interactionId)
        return a.interactionId < b.interactionId ? -1 : 1;
      return (a.targetId ?? -1) - (b.targetId ?? -1);
    });
    for (const c of cands) {
      c.score += nextRng(world.rng) * 2;
    }
    let best: Cand | null = null;
    for (const c of cands) {
      if (
        !best ||
        c.score > best.score ||
        (c.score === best.score && c.interactionId < best.interactionId) ||
        (c.score === best.score &&
          c.interactionId === best.interactionId &&
          (c.targetId ?? -1) < (best.targetId ?? -1))
      ) {
        best = c;
      }
    }
    if (best) {
      sim.queue.items.push({
        interactionId: best.interactionId,
        targetId: best.targetId,
        playerQueued: false,
      });
    }
    // Stagger next plan
    sim.autonomy.nextPlanTick = world.clock.tick + 15 + Math.floor(nextRng(world.rng) * 20);
  }
}

export function systemFailsafe(world: World): void {
  for (const sim of allSims(world)) {
    if (sim.socialLock && sim.socialLock.untilTick < world.clock.tick) {
      clearSocialPair(world, sim);
    }
    if (sim.needs.energy <= 0) {
      sim.anim.clip = 'pass_out';
      sim.needs.energy = 5;
      world.eventBus.push({
        type: 'toast',
        message: `${sim.identity.firstName} passed out from exhaustion!`,
      });
    }
  }
}

/** Ordered sim tick — design doc systems order */
export function runSimTick(world: World, content: ContentPack): void {
  if (world.mode !== 'live') return;
  if (world.clock.paused || world.clock.speed === 0) return;

  systemTime(world);
  systemCareerSchedule(world, content);
  systemNeedDecay(world, content);
  systemMood(world);
  systemInteractionProgress(world, content);
  systemPath(world, content);
  systemPerforming(world, content);
  systemAutonomy(world, content);
  systemFailsafe(world);
  refreshLotCaches(world);
}
