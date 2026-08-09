import type { Facing, GameMode, Rot, Weather } from '@lifesim/shared';
import type { ClockState } from './clock.js';
import type { LotState } from './lot.js';
import type { RngState } from './rng.js';

export type EntityId = number;

export type Needs = {
  hunger: number;
  energy: number;
  bladder: number;
  hygiene: number;
  fun: number;
  social: number;
};

export type MoodModifier = {
  id: string;
  amount: number;
  untilTick: number;
};

export type AspirationState = {
  defId: string;
  progress: number;
  completedMilestones: string[];
};

export type CareerState = {
  trackId: string | null;
  level: number;
  performance: number;
  daysWorked: number;
};

export type InventoryState = {
  held: string | null;
};

export type ActionFailReason =
  | 'cancelled_by_player'
  | 'path_impossible'
  | 'slot_taken'
  | 'target_invalid'
  | 'skill_gate'
  | 'chain_target_unavailable'
  | 'partner_left'
  | 'preempted_work'
  | 'preempted_critical'
  | 'object_state'
  | 'no_funds';

export type ActionStatus =
  | { kind: 'idle' }
  | { kind: 'pending'; interactionId: string; targetId: EntityId | null }
  | { kind: 'pathing'; interactionId: string; targetId: EntityId | null; fails: number }
  | {
      kind: 'performing';
      interactionId: string;
      targetId: EntityId | null;
      ticksLeft: number;
      slotId: string | null;
    }
  | { kind: 'succeeded'; interactionId: string }
  | { kind: 'failed'; interactionId: string; reason: ActionFailReason };

export type QueueItem = {
  interactionId: string;
  targetId: EntityId | null;
  playerQueued: boolean;
};

export type InteractionQueue = {
  items: QueueItem[];
};

export type PathAgent = {
  waypoints: { x: number; y: number }[];
  index: number;
  speed: number; // tiles per tick
};

export type SimVisual = {
  bodyPreset: string;
  hairPreset: string;
  outfitPreset: string;
  skinTone: string;
};

export type AnimState = {
  clip: 'idle' | 'walk' | 'sit' | 'use' | 'pass_out';
  frame: number;
  facing: Facing;
};

export type SlotRuntime = {
  slotId: string;
  reservedBy: EntityId | null;
  reservedUntilTick: number;
};

export type CraftingState = {
  chainId: string;
  stageId: string;
  ownerSimId: EntityId | null;
  ticksRemaining: number;
  outputHeldItem?: string;
};

export type SimEntity = {
  kind: 'sim';
  id: EntityId;
  /** Which city place this Sim is currently in */
  placeId: string;
  transform: { x: number; y: number; zFloor: number; facing: Facing };
  identity: { firstName: string; lastName: string; ageStage: 'adult' };
  visual: SimVisual;
  anim: AnimState;
  needs: Needs;
  mood: { value: number; modifiers: MoodModifier[] };
  skills: Record<string, number>;
  traits: { ids: string[] };
  aspiration: AspirationState;
  career: CareerState;
  inventory: InventoryState;
  queue: InteractionQueue;
  action: ActionStatus;
  path: PathAgent;
  autonomy: { nextPlanTick: number; cooldownUntil: number };
  presence: 'on_lot' | 'at_work';
  socialLock: null | {
    partnerId: EntityId;
    untilTick: number;
    role: 'initiator' | 'partner';
  };
};

export type ObjectEntity = {
  kind: 'object';
  id: EntityId;
  /** Place this object belongs to */
  placeId: string;
  transform: { x: number; y: number; zFloor: number; rot: Rot };
  defId: string;
  quality: number;
  dirtiness: number;
  powered: boolean;
  state: string;
  footprint: { w: number; h: number };
  blocksPath: boolean;
  slots: SlotRuntime[];
  crafting?: CraftingState;
};

export type EntityRecord = SimEntity | ObjectEntity;

export type RelationshipEdge = {
  a: EntityId;
  b: EntityId;
  friendship: number; // -100..100
  romance: number; // 0..100
  flags: string[];
};

export type HouseholdState = {
  name: string;
  funds: number;
  memberIds: EntityId[];
};

export type WorldUiState = {
  selectedSimId: EntityId | null;
  targetEntityId: EntityId | null;
  hoverEntityId: EntityId | null;
  modeTool: string | null;
  buyGhost: null | { defId: string; x: number; y: number; rot: Rot };
};

export type SimEvent =
  | { type: 'toast'; message: string }
  | { type: 'action_failed'; simId: EntityId; reason: ActionFailReason }
  | { type: 'action_done'; simId: EntityId; interactionId: string }
  | { type: 'work_left'; simId: EntityId }
  | { type: 'work_return'; simId: EntityId; pay: number }
  | { type: 'travel'; simId: EntityId; placeId: string; placeName: string };

export type World = {
  nextId: EntityId;
  entities: Map<EntityId, EntityRecord>;
  relationships: RelationshipEdge[];
  /** Active place lot (view pointer — same ref as lots[activePlaceId]) */
  lot: LotState;
  /** All city lots by place id */
  lots: Record<string, LotState>;
  neighborhood: {
    places: {
      id: string;
      name: string;
      kind: string;
      ground: string;
      description: string;
      exits: { to: string; label: string; x: number; y: number }[];
    }[];
    activePlaceId: string;
    homePlaceId: string;
  };
  household: HouseholdState;
  clock: ClockState;
  rng: RngState;
  mode: GameMode;
  weather: Weather;
  ui: WorldUiState;
  eventBus: SimEvent[];
  playTimeSeconds: number;
};

export type ContentPack = {
  objects: ObjectDef[];
  interactions: InteractionDef[];
  careers: CareerDef[];
  traits: TraitDef[];
  aspirations: AspirationDef[];
};

export type ObjectSlotDef = {
  id: string;
  offset: { x: number; y: number };
  facing: Facing;
  tags: string[];
  exclusive: boolean;
};

export type ObjectDef = {
  id: string;
  nameKey: string;
  category: string;
  price: number;
  footprint: { w: number; h: number };
  blocksPath: boolean;
  tags: string[];
  outdoor: boolean;
  color: string;
  slots: ObjectSlotDef[];
  interactions: string[];
  states: string[];
  startsPowered?: boolean;
};

export type NeedDelta = Partial<Needs>;

export type InteractionOutcomes = {
  needs?: NeedDelta;
  skillXp?: Record<string, number>;
  moodBuff?: { id: string; amount: number; durationTicks: number };
  setObjectState?: string;
  giveHeldItem?: string;
  clearHeldItem?: boolean;
  relationship?: { friendship?: number; romance?: number };
  setCrafting?: {
    chainId: string;
    stageId: string;
    ticksRemaining?: number;
    outputHeldItem?: string;
    captureOwner?: boolean;
  };
  clearCrafting?: boolean;
  funds?: number;
};

export type InteractionDef = {
  id: string;
  nameKey: string;
  durationTicks: number;
  slotTag?: string;
  social?: boolean;
  requires?: {
    skill?: { id: string; min: number };
    heldItem?: string;
    objectState?: string;
    objectTags?: string[];
    freeSlotTag?: string;
  };
  outcomes: InteractionOutcomes;
  chain?: {
    nextInteractionId: string;
    requireSurfaceTags?: string[];
  };
  autonomyWeight?: number;
  ads?: Partial<Record<keyof Needs, number>>;
};

export type CareerLevel = {
  titleKey: string;
  payPerDay: number;
  requiredSkill?: { id: string; min: number };
};

export type CareerDef = {
  id: string;
  nameKey: string;
  schedule: { startMinute: number; endMinute: number; days: number[] };
  levels: CareerLevel[];
};

export type TraitDef = {
  id: string;
  nameKey: string;
  needDecayMult?: Partial<Needs>;
  autonomyBias?: Record<string, number>;
};

export type AspirationDef = {
  id: string;
  nameKey: string;
  milestones: { id: string; descriptionKey: string; target: number }[];
};

export type HudProjection = {
  clockLabel: string;
  minuteOfDay: number;
  dayNumber: number;
  weather: Weather;
  funds: number;
  mode: GameMode;
  speed: number;
  paused: boolean;
  placeId: string;
  placeName: string;
  places: { id: string; name: string; kind: string; description: string }[];
  householdSims: {
    id: EntityId;
    name: string;
    mood: number;
    presence: 'on_lot' | 'at_work';
    placeId: string;
    placeName: string;
    needs: Needs;
  }[];
  selectedSim: null | {
    id: EntityId;
    name: string;
    needs: Needs;
    mood: number;
    skills: Record<string, number>;
    career: CareerState;
    queue: QueueItem[];
    action: ActionStatus;
    aspiration: AspirationState;
    traits: string[];
    placeId: string;
  };
  target: null | {
    id: EntityId;
    kind: 'sim' | 'object';
    label: string;
    availableInteractions: {
      id: string;
      labelKey: string;
      enabled: boolean;
      failReasonKey?: string;
    }[];
  };
  toasts: string[];
};
