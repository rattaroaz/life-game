import { create } from 'zustand';
import {
  createCommands,
  createEmptyWorld,
  listLocalSaves,
  loadFromLocalStorage,
  projectHud,
  runSimTick,
  saveToLocalStorage,
  type ContentPack,
  type HudProjection,
  type SimCommands,
  type World,
} from '@lifesim/sim';
import { loadBuiltinContent } from '@lifesim/content';
import { BASE_TICKS_PER_REAL_SECOND } from '@lifesim/sim';

export type Screen = 'menu' | 'cas' | 'game';

type GameStore = {
  screen: Screen;
  content: ContentPack;
  world: World | null;
  commands: SimCommands | null;
  hud: HudProjection | null;
  toasts: string[];
  selectedBuyDef: string | null;
  buildKind: 'wall' | 'door' | 'window' | 'erase';
  saves: ReturnType<typeof listLocalSaves>;
  initNewDemo: () => void;
  openCas: () => void;
  startFromCas: (householdName: string, members: Parameters<SimCommands['createHousehold']>[0]['members']) => void;
  saveGame: (slotId?: string) => void;
  loadGame: (slotId: string) => void;
  refreshSaves: () => void;
  tickAccum: number;
  frame: (dt: number) => void;
  pushToast: (msg: string) => void;
  setSelectedBuyDef: (id: string | null) => void;
  setBuildKind: (k: GameStore['buildKind']) => void;
  reproject: () => void;
};

export const useGameStore = create<GameStore>((set, get) => {
  const content = loadBuiltinContent();

  return {
    screen: 'menu',
    content,
    world: null,
    commands: null,
    hud: null,
    toasts: [],
    selectedBuyDef: null,
    buildKind: 'wall',
    saves: [],
    tickAccum: 0,

    refreshSaves() {
      set({ saves: listLocalSaves() });
    },

    pushToast(msg) {
      set((s) => ({ toasts: [...s.toasts.slice(-4), msg] }));
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t !== msg) }));
      }, 4000);
    },

    reproject() {
      const { world, content, toasts } = get();
      if (!world) return;
      set({ hud: projectHud(world, content, toasts) });
    },

    initNewDemo() {
      const world = createEmptyWorld(Date.now() % 1_000_000);
      const commands = createCommands(world, content);
      commands.debugSpawnHousehold();
      set({
        screen: 'game',
        world,
        commands,
        toasts: ['Welcome to LifeSim! Click objects to interact. Autonomy is on.'],
      });
      get().reproject();
    },

    openCas() {
      set({ screen: 'cas' });
    },

    startFromCas(householdName, members) {
      const world = createEmptyWorld(Date.now() % 1_000_000);
      const commands = createCommands(world, content);
      commands.createHousehold({ householdName, funds: 22000, members });
      set({
        screen: 'game',
        world,
        commands,
        toasts: [`${householdName} moved in!`],
      });
      get().reproject();
    },

    saveGame(slotId = 'slot1') {
      const { world } = get();
      if (!world) return;
      saveToLocalStorage(slotId, world, world.household.name);
      get().refreshSaves();
      get().pushToast('Game saved');
      get().reproject();
    },

    loadGame(slotId) {
      const world = loadFromLocalStorage(slotId);
      if (!world) {
        get().pushToast('Save not found');
        return;
      }
      const commands = createCommands(world, content);
      set({ screen: 'game', world, commands, toasts: ['Game loaded'] });
      get().refreshSaves();
      get().reproject();
    },

    setSelectedBuyDef(id) {
      set({ selectedBuyDef: id });
    },

    setBuildKind(k) {
      set({ buildKind: k });
    },

    frame(dt) {
      const { world, content } = get();
      if (!world || !get().commands) return;
      world.playTimeSeconds += dt;

      // Sim clock: speed * BASE ticks per real second
      if (world.mode === 'live' && !world.clock.paused && world.clock.speed > 0) {
        let accum = get().tickAccum + dt * BASE_TICKS_PER_REAL_SECOND * world.clock.speed;
        // Cap catch-up
        const maxTicks = 8;
        let n = 0;
        while (accum >= 1 && n < maxTicks) {
          runSimTick(world, content);
          accum -= 1;
          n++;
        }
        set({ tickAccum: accum });
        const drained = get().commands!.drainEvents();
        if (drained.length) {
          for (const m of drained) get().pushToast(m);
        }
      }
      get().reproject();
    },
  };
});
