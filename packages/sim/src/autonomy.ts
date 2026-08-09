/**
 * Self-sufficiency / utility AI.
 * When the player is idle, Sims continuously pick high-value actions to
 * keep needs up, practice skills for career, socialize, and finish held-item chains.
 */
import { FLIRT_MIN_FRIENDSHIP, getNpcDef, isNpc } from './npc.js';
import { getObs } from './observability/hub.js';
import { getRelationship } from './relationships.js';
import { nextRng } from './rng.js';
import type {
  ContentPack,
  EntityId,
  InteractionDef,
  Needs,
  ObjectDef,
  SimEntity,
  World,
} from './types.js';
import {
  exitAt,
  getPlaceMeta,
  objectsInPlace,
  travelSimToPlace,
} from './neighborhood.js';
import { allObjects, allSims } from './world.js';

const NEED_KEYS = ['hunger', 'energy', 'bladder', 'hygiene', 'fun', 'social'] as const;
type NeedKey = (typeof NEED_KEYS)[number];

/** Survival needs — must never bottom out into pass-out / free-fall. */
const SURVIVAL_KEYS = ['hunger', 'energy', 'bladder', 'hygiene'] as const;
type SurvivalKey = (typeof SURVIVAL_KEYS)[number];

/** Below this, the need is "urgent" and dominates scoring. */
const URGENT = 45;
/** Below this, "critical" — plan every tick and prefer only fixes. */
const CRITICAL = 28;
/** Comfort zone: can practice skills / social. */
const COMFORT = 55;
/** Energy floor where we force emergency rest instead of passing out. */
const ENERGY_COLLAPSE = 5;

export type AutonomyCandidate = {
  interactionId: string;
  targetId: EntityId | null;
  score: number;
  reason: string;
};

function getDef(content: ContentPack, id: string): InteractionDef | undefined {
  return content.interactions.find((i) => i.id === id);
}

function getObjectDef(content: ContentPack, id: string): ObjectDef | undefined {
  return content.objects.find((o) => o.id === id);
}

function slotFree(
  obj: { slots: { slotId: string; reservedBy: EntityId | null }[] },
  odef: ObjectDef,
  slotTag: string,
  simId: EntityId,
): boolean {
  return obj.slots.some((s) => {
    const sd = odef.slots.find((d) => d.id === s.slotId);
    return (
      !!sd?.tags.includes(slotTag) &&
      (!sd.exclusive || s.reservedBy === null || s.reservedBy === simId)
    );
  });
}

function canRunInteraction(
  sim: SimEntity,
  idef: InteractionDef,
  obj: { defId: string; state: string; slots: { slotId: string; reservedBy: EntityId | null }[] } | null,
  content: ContentPack,
): boolean {
  if (idef.requires?.heldItem && sim.inventory.held !== idef.requires.heldItem) {
    return false;
  }
  if (idef.requires?.skill) {
    if ((sim.skills[idef.requires.skill.id] ?? 0) < idef.requires.skill.min) return false;
  }
  if (!obj) {
    return !!idef.social;
  }
  const odef = getObjectDef(content, obj.defId);
  if (!odef) return false;
  if (idef.requires?.objectState && obj.state !== idef.requires.objectState) return false;
  if (idef.requires?.objectTags?.length) {
    if (!idef.requires.objectTags.every((t) => odef.tags.includes(t))) return false;
  }
  if (idef.slotTag && !slotFree(obj, odef, idef.slotTag, sim.id)) return false;
  return true;
}

/** How much this interaction helps a need (from ads or outcomes). */
function needHelp(idef: InteractionDef, need: NeedKey): number {
  if (idef.ads?.[need]) return idef.ads[need]!;
  const d = idef.outcomes.needs?.[need];
  if (d !== undefined && d > 0) return Math.min(3, d / 25);
  return 0;
}

function urgencyWeight(value: number): number {
  if (value < CRITICAL) return 12 + (CRITICAL - value) * 0.8;
  if (value < URGENT) return 4 + (URGENT - value) * 0.15;
  if (value < COMFORT) return 1.2;
  return 0.25; // already fine — weak pull
}

function lowestNeed(needs: Needs): { key: NeedKey; value: number } {
  let key: NeedKey = 'hunger';
  let value = needs.hunger;
  for (const k of NEED_KEYS) {
    if (needs[k] < value) {
      value = needs[k];
      key = k;
    }
  }
  return { key, value };
}

function hasCritical(needs: Needs): boolean {
  return NEED_KEYS.some((k) => needs[k] < CRITICAL);
}

function hasSurvivalCritical(needs: Needs): boolean {
  return SURVIVAL_KEYS.some((k) => needs[k] < CRITICAL);
}

function lowestSurvivalNeed(needs: Needs): { key: SurvivalKey; value: number } {
  let key: SurvivalKey = 'hunger';
  let value = needs.hunger;
  for (const k of SURVIVAL_KEYS) {
    if (needs[k] < value) {
      value = needs[k];
      key = k;
    }
  }
  return { key, value };
}

/** Player home or NPC personal home. */
function personalHomeId(world: World, content: ContentPack, sim: SimEntity): string {
  if (isNpc(sim)) {
    const def = getNpcDef(content, sim.npcDefId);
    if (def?.homePlaceId && world.lots[def.homePlaceId]) return def.homePlaceId;
  }
  return world.neighborhood.homePlaceId;
}

/** Whether the place has an interaction that raises this need. */
function placeHelpsNeed(
  world: World,
  content: ContentPack,
  placeId: string,
  need: NeedKey,
): boolean {
  for (const obj of objectsInPlace(world, placeId)) {
    const odef = getObjectDef(content, obj.defId);
    if (!odef) continue;
    for (const iid of odef.interactions) {
      const idef = getDef(content, iid);
      if (!idef || idef.social) continue;
      if (needHelp(idef, need) > 0) return true;
    }
  }
  return false;
}

function careerSkillId(trackId: string | null): string | null {
  if (!trackId) return null;
  if (trackId.includes('chef')) return 'cooking';
  if (trackId.includes('office')) return 'charisma';
  return 'logic';
}

/** Next skill the sim should practice for promotion. */
function skillToPractice(sim: SimEntity, content: ContentPack): string | null {
  if (!sim.career.trackId) return null;
  const career = content.careers.find((c) => c.id === sim.career.trackId);
  if (!career) return null;
  const next = career.levels[sim.career.level + 1];
  if (next?.requiredSkill) {
    const cur = sim.skills[next.requiredSkill.id] ?? 0;
    if (cur < next.requiredSkill.min) return next.requiredSkill.id;
  }
  // general career skill
  return careerSkillId(sim.career.trackId);
}

function interactionTeachesSkill(idef: InteractionDef, skillId: string): boolean {
  const xp = idef.outcomes.skillXp?.[skillId];
  return xp !== undefined && xp > 0;
}

export function gatherAutonomyCandidates(
  world: World,
  content: ContentPack,
  sim: SimEntity,
): AutonomyCandidate[] {
  const cands: AutonomyCandidate[] = [];
  const low = lowestNeed(sim.needs);
  const critical = hasCritical(sim.needs);
  const skillFocus = skillToPractice(sim, content);

  // --- Held-item chain continuation (highest priority when holding food chain items) ---
  if (sim.inventory.held === 'item.ingredients' || sim.inventory.held === 'item.meal') {
    for (const obj of allObjects(world)) {
      if (obj.placeId !== sim.placeId) continue;
      const odef = getObjectDef(content, obj.defId);
      if (!odef) continue;
      for (const iid of odef.interactions) {
        const idef = getDef(content, iid);
        if (!idef || idef.social) continue;
        if (!canRunInteraction(sim, idef, obj, content)) continue;
        // Strong bias to finish chain
        let score = 80;
        if (sim.inventory.held === 'item.ingredients' && iid.includes('cook')) score = 100;
        if (sim.inventory.held === 'item.meal' && iid.includes('eat')) score = 110;
        score += needHelp(idef, 'hunger') * urgencyWeight(sim.needs.hunger) * 2;
        cands.push({
          interactionId: iid,
          targetId: obj.id,
          score,
          reason: 'finish_chain',
        });
      }
    }
  }

  // --- Object interactions (same city place only) ---
  for (const obj of allObjects(world)) {
    if (obj.placeId !== sim.placeId) continue;
    const odef = getObjectDef(content, obj.defId);
    if (!odef) continue;
    for (const iid of odef.interactions) {
      const idef = getDef(content, iid);
      if (!idef || idef.social) continue;
      if (!canRunInteraction(sim, idef, obj, content)) continue;

      let score = idef.autonomyWeight ?? 1;
      let reason = 'routine';

      // Need-driven score
      let bestNeedHelp = 0;
      for (const k of NEED_KEYS) {
        const help = needHelp(idef, k);
        if (help <= 0) continue;
        const u = urgencyWeight(sim.needs[k]);
        const contrib = help * u * 3.5;
        score += contrib;
        if (contrib > bestNeedHelp) {
          bestNeedHelp = contrib;
          reason = `need_${k}`;
        }
      }

      // Critical: only keep if it helps a critical need (or skill when all ok)
      if (critical) {
        let helpsCritical = false;
        for (const k of NEED_KEYS) {
          if (sim.needs[k] < CRITICAL && needHelp(idef, k) > 0) {
            helpsCritical = true;
            score += 40;
            reason = `critical_${k}`;
          }
        }
        if (!helpsCritical) {
          score -= 50; // heavily deprioritize fluff when dying
        }
      }

      // Extra focus on single lowest need
      if (needHelp(idef, low.key) > 0) {
        score += urgencyWeight(low.value) * 2;
      }

      // Survival needs get an earlier / harder pull so they never collapse
      for (const k of SURVIVAL_KEYS) {
        if (needHelp(idef, k) > 0 && sim.needs[k] < URGENT) {
          score += urgencyWeight(sim.needs[k]) * 2.5;
          if (k === 'energy' && sim.needs.energy < CRITICAL) score += 35;
          if (k === 'hunger' && sim.needs.hunger < CRITICAL) score += 30;
          if (k === 'bladder' && sim.needs.bladder < CRITICAL) score += 32;
        }
      }

      // Skill practice when comfortable
      if (skillFocus && interactionTeachesSkill(idef, skillFocus) && !critical) {
        score += 15 + (10 - (sim.skills[skillFocus] ?? 0));
        reason = `skill_${skillFocus}`;
      } else if (
        !critical &&
        low.value > COMFORT &&
        idef.outcomes.skillXp &&
        Object.keys(idef.outcomes.skillXp).length
      ) {
        score += 6;
      }

      // Mood slightly prefers fun/social when mid
      score += sim.mood.value * 0.02;

      // Distance penalty (mild — self-sufficiency > laziness)
      const dist =
        Math.abs(obj.transform.x - sim.transform.x) +
        Math.abs(obj.transform.y - sim.transform.y);
      score -= dist * 0.08;

      // Prefer simple snack over full cook when very hungry and not holding items
      if (
        sim.needs.hunger < CRITICAL &&
        !sim.inventory.held &&
        iid.includes('snack')
      ) {
        score += 25;
        reason = 'critical_hunger_snack';
      }
      if (
        sim.needs.hunger < URGENT &&
        sim.needs.hunger >= CRITICAL &&
        !sim.inventory.held &&
        iid.includes('start_meal')
      ) {
        score += 12; // cook proper meal when moderately hungry
      }

      cands.push({ interactionId: iid, targetId: obj.id, score, reason });
    }
  }

  // --- Travel to other places (needs / fun / skills / personal home) ---
  // Always available — critical survival must be able to leave barren lots.
  const homeId = personalHomeId(world, content, sim);
  const hereHelpsLow = placeHelpsNeed(world, content, sim.placeId, low.key);

  if (
    !sim.inventory.held &&
    critical &&
    !hereHelpsLow &&
    homeId &&
    sim.placeId !== homeId &&
    world.lots[homeId]
  ) {
    cands.push({
      interactionId: `__travel__:${homeId}`,
      targetId: null,
      score: 95,
      reason: 'travel_home_critical',
    });
  }

  const meta = getPlaceMeta(world, sim.placeId);
  if (meta && !sim.inventory.held) {
    for (const ex of meta.exits) {
      let score = 2;
      let reason = 'travel';
      if (ex.to === 'park' || ex.to === 'plaza' || ex.to === 'street_oak' || ex.to === 'street_maple') {
        score += urgencyWeight(sim.needs.fun) * 2 + urgencyWeight(sim.needs.social);
        reason = 'travel_fun';
      }
      if (
        ex.to === 'cafe' ||
        ex.to === 'market' ||
        ex.to === 'restaurant' ||
        ex.to === 'convenience'
      ) {
        score += urgencyWeight(sim.needs.hunger) * 1.5 + urgencyWeight(sim.needs.fun);
        reason = 'travel_food';
      }
      if (ex.to === 'gym') {
        score += (100 - sim.needs.energy) * 0.05 + 8;
        reason = 'travel_gym';
      }
      if (ex.to === 'salon' || ex.to === 'boutique') {
        score += urgencyWeight(sim.needs.fun) + urgencyWeight(sim.needs.hygiene) * 0.5;
        reason = 'travel_lifestyle';
      }
      if (ex.to === 'clinic' && sim.needs.energy < URGENT) {
        score += 12;
        reason = 'travel_clinic';
      }
      if ((ex.to === 'library' || ex.to === 'school') && skillFocus === 'logic') {
        score += 18;
        reason = 'travel_study';
      }
      if (ex.to === 'office' && skillFocus === 'charisma') {
        score += 10;
        reason = 'travel_office';
      }
      if (ex.to.startsWith('house_') || ex.to === 'home') {
        score += urgencyWeight(sim.needs.social) * 0.8 + 4;
        reason = 'travel_visit';
      }
      if (ex.to === homeId && (critical || low.value < URGENT)) {
        score += critical ? 55 : 28;
        reason = 'travel_home_need';
      }
      // Prefer destinations that can fix the lowest need when urgent
      if (low.value < URGENT && placeHelpsNeed(world, content, ex.to, low.key)) {
        score += 20;
        reason = `travel_fix_${low.key}`;
      }
      // Don't wander for fun while critically failing a survival need here
      if (critical && !placeHelpsNeed(world, content, ex.to, low.key) && ex.to !== homeId) {
        score -= 30;
      }
      if (score > 15) {
        cands.push({
          interactionId: `__travel__:${ex.to}`,
          targetId: null,
          score,
          reason,
        });
      }
    }

    // Direct home travel even when home isn't a local exit (multi-hop city)
    if (
      homeId &&
      sim.placeId !== homeId &&
      !meta.exits.some((e) => e.to === homeId) &&
      (critical || low.value < URGENT) &&
      !hereHelpsLow
    ) {
      cands.push({
        interactionId: `__travel__:${homeId}`,
        targetId: null,
        score: critical ? 90 : 40,
        reason: 'travel_home_direct',
      });
    }
  }

  // --- Social (only if social is a real concern or all needs ok) ---
  if (sim.needs.social < COMFORT || (!critical && low.value > URGENT)) {
    for (const other of allSims(world)) {
      if (other.id === sim.id || other.presence !== 'on_lot') continue;
      if (other.placeId !== sim.placeId) continue;
      if (other.socialLock) continue;
      if (other.action.kind === 'pathing' || other.action.kind === 'performing') {
        // Prefer free partners
      }
      for (const idef of content.interactions) {
        if (!idef.social) continue;
        // Avoid mean by default for self-sufficiency
        if (idef.id.includes('mean')) continue;
        if (idef.id.includes('flirt')) {
          const rel = getRelationship(world.relationships, sim.id, other.id);
          if ((rel?.friendship ?? 0) < FLIRT_MIN_FRIENDSHIP) continue;
        }
        if (!canRunInteraction(sim, idef, null, content)) continue;
        let score =
          (idef.autonomyWeight ?? 1) +
          needHelp(idef, 'social') * urgencyWeight(sim.needs.social) * 4;
        if (idef.id.includes('chat')) score += 3;
        if (skillFocus === 'charisma') score += 8;
        if (critical && sim.needs.social >= CRITICAL) score -= 40;
        const dist =
          Math.abs(other.transform.x - sim.transform.x) +
          Math.abs(other.transform.y - sim.transform.y);
        score -= dist * 0.1;
        cands.push({
          interactionId: idef.id,
          targetId: other.id,
          score,
          reason: 'social',
        });
      }
    }
  }

  return cands;
}

export function pickAutonomyAction(
  world: World,
  content: ContentPack,
  sim: SimEntity,
): AutonomyCandidate | null {
  const cands = gatherAutonomyCandidates(world, content, sim);
  if (cands.length === 0) return null;

  // Stable order then noise (small — urgency should dominate)
  cands.sort((a, b) => {
    if (a.interactionId !== b.interactionId)
      return a.interactionId < b.interactionId ? -1 : 1;
    return (a.targetId ?? -1) - (b.targetId ?? -1);
  });
  const noiseScale = hasCritical(sim.needs) ? 0.5 : 2.5;
  for (const c of cands) {
    c.score += nextRng(world.rng) * noiseScale;
  }

  let best: AutonomyCandidate | null = null;
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
  return best;
}

/**
 * Cancel actions that don't help when a survival need is critical.
 * Player walks and fluff are dropped so Sims/NPCs can eat, sleep, etc.
 */
function queueItemHelpsSurvival(
  content: ContentPack,
  sim: SimEntity,
  interactionId: string,
): boolean {
  if (interactionId.startsWith('__travel__:')) return true;
  const idef = getDef(content, interactionId);
  if (!idef) return false;
  if (idef.social) return false;
  return SURVIVAL_KEYS.some((k) => sim.needs[k] < CRITICAL && needHelp(idef, k) > 0);
}

export function systemAutonomyPreempt(world: World, content: ContentPack): void {
  for (const sim of allSims(world)) {
    if (sim.presence !== 'on_lot') continue;
    if (!hasSurvivalCritical(sim.needs)) continue;

    // Never interrupt an active conversation (player talk / NPC social)
    if (sim.socialLock) continue;

    if (sim.action.kind === 'idle') {
      // Drop autonomy fluff; keep player-queued talk / care
      if (sim.queue.items.length > 0) {
        sim.queue.items = sim.queue.items.filter(
          (q) => q.playerQueued || queueItemHelpsSurvival(content, sim, q.interactionId),
        );
      }
      continue;
    }

    const act = sim.action;
    if (act.kind === 'performing' && act.ticksLeft <= 2) continue;

    let interactionId =
      act.kind === 'performing' || act.kind === 'pathing' || act.kind === 'pending'
        ? act.interactionId
        : null;
    if (!interactionId) continue;

    // Travel home / care travel is allowed to continue
    if (interactionId.startsWith('__travel__:')) continue;

    const idef = interactionId === '__walk__' ? undefined : getDef(content, interactionId);
    // Player / anyone mid-talk — do not cancel
    if (idef?.social) continue;

    let helps = false;
    if (interactionId === '__walk__') {
      helps = false; // pure walks never count as survival care
    } else if (idef) {
      for (const k of SURVIVAL_KEYS) {
        if (sim.needs[k] < CRITICAL && needHelp(idef, k) > 0) {
          helps = true;
          break;
        }
      }
      if (
        sim.inventory.held &&
        (interactionId.includes('cook') || interactionId.includes('eat'))
      ) {
        helps = true;
      }
    }
    if (helps) continue;

    // Drop autonomy fluff; keep player-queued social / care
    sim.queue.items = sim.queue.items.filter(
      (q) => q.playerQueued || queueItemHelpsSurvival(content, sim, q.interactionId),
    );
    for (const o of allObjects(world)) {
      for (const s of o.slots) {
        if (s.reservedBy === sim.id) {
          s.reservedBy = null;
          s.reservedUntilTick = 0;
        }
      }
    }
    sim.path.waypoints = [];
    sim.path.index = 0;
    sim.action = { kind: 'idle' };
    sim.anim.clip = 'idle';
    sim.autonomy.nextPlanTick = world.clock.tick;
    getObs().event('autonomy.preempt', 'ai', {
      simId: sim.id,
      dropped: interactionId,
    });
  }
}

function clearSocialLocks(world: World, sim: SimEntity): void {
  const partnerId = sim.socialLock?.partnerId;
  sim.socialLock = null;
  if (partnerId != null) {
    const partner = allSims(world).find((s) => s.id === partnerId);
    if (partner?.socialLock?.partnerId === sim.id) partner.socialLock = null;
  }
}

function applyAutonomyPick(
  world: World,
  sim: SimEntity,
  best: AutonomyCandidate,
): void {
  if (best.interactionId.startsWith('__travel__:')) {
    const dest = best.interactionId.slice('__travel__:'.length);
    travelSimToPlace(world, sim.id, dest, { silent: isNpc(sim) });
  } else {
    sim.queue.items.push({
      interactionId: best.interactionId,
      targetId: best.targetId,
      playerQueued: false,
    });
  }
  getObs().noteAutonomyPick({
    simId: sim.id,
    interactionId: best.interactionId,
    targetId: best.targetId,
    score: Math.round(best.score * 100) / 100,
    reason: best.reason,
  });
}

/** Queue / travel the best care action immediately (used by autonomy + failsafe). */
export function forceEmergencySelfCare(
  world: World,
  content: ContentPack,
  sim: SimEntity,
): boolean {
  if (sim.presence !== 'on_lot') return false;
  clearSocialLocks(world, sim);
  sim.autonomy.nextPlanTick = world.clock.tick;
  sim.autonomy.cooldownUntil = 0;

  // Already caring or traveling for care
  if (sim.action.kind === 'performing' || sim.action.kind === 'pathing') {
    const iid =
      sim.action.kind === 'performing' || sim.action.kind === 'pathing'
        ? sim.action.interactionId
        : null;
    if (iid && iid !== '__walk__') {
      if (iid.startsWith('__travel__:')) return true;
      const idef = getDef(content, iid);
      if (idef && SURVIVAL_KEYS.some((k) => needHelp(idef, k) > 0)) return true;
    }
  }

  if (sim.queue.items.length > 0) {
    const q = sim.queue.items[0]!;
    if (q.interactionId.startsWith('__travel__:')) return true;
    const idef = getDef(content, q.interactionId);
    if (idef && SURVIVAL_KEYS.some((k) => needHelp(idef, k) > 0)) return true;
    sim.queue.items = [];
  }

  if (sim.action.kind !== 'idle' && sim.action.kind !== 'failed' && sim.action.kind !== 'succeeded') {
    // Preempt already ran; if still busy on fluff, bail — next tick
    return false;
  }
  sim.action = { kind: 'idle' };
  if (sim.anim.clip === 'pass_out') sim.anim.clip = 'idle';

  const best = pickAutonomyAction(world, content, sim);
  if (best && best.score > 0) {
    applyAutonomyPick(world, sim, best);
    return true;
  }

  // Last resort: go home where beds/fridge/toilet exist
  const homeId = personalHomeId(world, content, sim);
  if (homeId && sim.placeId !== homeId && world.lots[homeId]) {
    travelSimToPlace(world, sim.id, homeId, { silent: isNpc(sim) });
    getObs().event('autonomy.emergency_home', 'ai', { simId: sim.id, homeId });
    return true;
  }
  return false;
}

export function systemAutonomy(world: World, content: ContentPack): void {
  // First: free them if stuck on useless actions while critical
  systemAutonomyPreempt(world, content);

  for (const sim of allSims(world)) {
    if (sim.presence !== 'on_lot') continue;
    if (sim.socialLock) continue;
    if (world.clock.tick < sim.autonomy.nextPlanTick) continue;
    if (sim.action.kind !== 'idle') continue;

    const survivalCritical = hasSurvivalCritical(sim.needs);
    if (sim.queue.items.length > 0) {
      if (!survivalCritical) continue;
      const helps = sim.queue.items.some((q) => {
        if (q.interactionId.startsWith('__travel__:')) return true;
        const idef = getDef(content, q.interactionId);
        return !!idef && SURVIVAL_KEYS.some((k) => sim.needs[k] < CRITICAL && needHelp(idef, k) > 0);
      });
      if (helps) continue;
      sim.queue.items = [];
    }
    // Survival planning ignores soft cooldown
    if (!survivalCritical && world.clock.tick < sim.autonomy.cooldownUntil) continue;

    // Auto-enroll in a career once if unemployed (household only — never NPCs)
    if (sim.role !== 'npc' && !sim.career.trackId && content.careers.length > 0) {
      // Stagger: after a few game hours of life
      if (world.clock.tick > 30) {
        const pick =
          content.careers[Math.floor(nextRng(world.rng) * content.careers.length)]!;
        sim.career = {
          trackId: pick.id,
          level: 0,
          performance: 50,
          daysWorked: 0,
          skipCount: 0,
        };
        world.eventBus.push({
          type: 'toast',
          message: `${sim.identity.firstName} took a job: ${pick.nameKey}`,
        });
        getObs().event('autonomy.joined_career', 'career', {
          simId: sim.id,
          trackId: pick.id,
        });
      }
    }

    const best = pickAutonomyAction(world, content, sim);
    if (best && best.score > 0.5) {
      applyAutonomyPick(world, sim, best);
    }

    // Standing on exit pad — optional step-on travel for player-driven walks
    const ex = exitAt(
      world,
      sim.placeId,
      Math.round(sim.transform.x),
      Math.round(sim.transform.y),
    );
    if (ex && sim.action.kind === 'idle' && sim.queue.items.length === 0) {
      // Don't auto-step for autonomy every frame; only if they planned travel already handled
    }

    // Replan cadence: survival-critical = every tick; comfortable = less often
    const low = lowestNeed(sim.needs);
    let delay: number;
    if (survivalCritical || low.value < CRITICAL) delay = 1;
    else if (low.value < URGENT) delay = 4 + Math.floor(nextRng(world.rng) * 4);
    else delay = 10 + Math.floor(nextRng(world.rng) * 12);
    sim.autonomy.nextPlanTick = world.clock.tick + delay;
  }
}

/**
 * Hard survival rail: never pass out — floor collapsed needs and force care.
 */
export function systemSurvivalSafety(world: World, content: ContentPack): void {
  for (const sim of allSims(world)) {
    if (sim.presence !== 'on_lot') continue;

    // Floor so free-fall never soft-locks the AI (no pass-out)
    for (const k of SURVIVAL_KEYS) {
      if (sim.needs[k] < 1) sim.needs[k] = 1;
    }
    if (sim.needs.energy <= ENERGY_COLLAPSE) {
      sim.needs.energy = Math.max(sim.needs.energy, 10);
    }

    const low = lowestSurvivalNeed(sim.needs);
    if (low.value >= CRITICAL && sim.needs.energy > ENERGY_COLLAPSE) continue;

    if (sim.anim.clip === 'pass_out') sim.anim.clip = 'idle';
    forceEmergencySelfCare(world, content, sim);
  }
}
