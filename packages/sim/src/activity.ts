import type { ActionStatus, ContentPack, SimEntity, World } from './types.js';
import { getPlaceMeta } from './neighborhood.js';

export type ActivityPhase = 'idle' | 'moving' | 'doing' | 'work' | 'failed';

export type SimActivity = {
  /** Short player-facing verb phrase, e.g. "Watching TV" */
  label: string;
  /** Optional secondary line (destination, fail reason, place) */
  detail: string | null;
  phase: ActivityPhase;
};

function interactionLabel(content: ContentPack, interactionId: string): string {
  if (interactionId === '__walk__') return 'Walk';
  if (interactionId.startsWith('__travel__:')) {
    const placeId = interactionId.slice('__travel__:'.length);
    return `Travel to ${placeId}`;
  }
  const def = content.interactions.find((i) => i.id === interactionId);
  if (def?.nameKey) return def.nameKey;
  const tail = interactionId.includes('.')
    ? interactionId.split('.').pop()!
    : interactionId;
  return tail.replace(/_/g, ' ');
}

/** Prefer progressive / status wording for the activity window. */
function doingLabel(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith('watch')) return name.replace(/^Watch/i, 'Watching');
  if (lower.startsWith('eat')) return name.replace(/^Eat/i, 'Eating');
  if (lower.startsWith('sleep')) return 'Sleeping';
  if (lower.startsWith('shower')) return 'Showering';
  if (lower.startsWith('wash')) return name.replace(/^Wash/i, 'Washing');
  if (lower.startsWith('use ')) return name; // "Use toilet", "Use computer"
  if (lower.startsWith('read')) return 'Reading';
  if (lower.startsWith('exercise')) return 'Exercising';
  if (lower.startsWith('paint')) return 'Painting';
  if (lower.startsWith('dance')) return 'Dancing';
  if (lower.startsWith('cook')) return name.replace(/^Cook/i, 'Cooking');
  if (lower.startsWith('chat')) return 'Chatting';
  if (lower.startsWith('tell ')) return name.replace(/^Tell/i, 'Telling');
  if (lower.startsWith('flirt')) return 'Flirting';
  if (lower.startsWith('sit')) return 'Relaxing';
  if (lower.startsWith('grab')) return name.replace(/^Grab/i, 'Grabbing');
  if (lower.startsWith('get ')) return name.replace(/^Get/i, 'Getting');
  return name;
}

function failReasonLabel(reason: string): string {
  return reason.replace(/_/g, ' ');
}

/**
 * Player-facing status for what a Sim is doing right now.
 */
export function describeSimActivity(
  sim: SimEntity,
  content: ContentPack,
  world: World,
): SimActivity {
  if (sim.presence === 'at_work') {
    const career = sim.career.trackId
      ? content.careers.find((c) => c.id === sim.career.trackId)
      : undefined;
    const place = getPlaceMeta(world, sim.placeId)?.name;
    return {
      label: 'Working',
      detail: career?.nameKey ?? place ?? null,
      phase: 'work',
    };
  }

  const act: ActionStatus = sim.action;

  if (act.kind === 'idle') {
    const next = sim.queue.items[0];
    if (next) {
      return {
        label: 'Queued',
        detail: interactionLabel(content, next.interactionId),
        phase: 'idle',
      };
    }
    return { label: 'Idle', detail: null, phase: 'idle' };
  }

  if (act.kind === 'pathing' || act.kind === 'pending') {
    if (act.interactionId === '__walk__') {
      return { label: 'Walking', detail: null, phase: 'moving' };
    }
    if (act.interactionId.startsWith('__travel__:')) {
      const placeId = act.interactionId.slice('__travel__:'.length);
      const placeName = getPlaceMeta(world, placeId)?.name ?? placeId;
      return { label: 'Traveling', detail: placeName, phase: 'moving' };
    }
    const name = interactionLabel(content, act.interactionId);
    return {
      label: 'On the way',
      detail: name,
      phase: 'moving',
    };
  }

  if (act.kind === 'performing') {
    const name = interactionLabel(content, act.interactionId);
    return {
      label: doingLabel(name),
      detail: null,
      phase: 'doing',
    };
  }

  if (act.kind === 'succeeded') {
    const name = interactionLabel(content, act.interactionId);
    return {
      label: 'Finished',
      detail: name,
      phase: 'idle',
    };
  }

  // failed
  return {
    label: 'Interrupted',
    detail: failReasonLabel(act.reason),
    phase: 'failed',
  };
}
