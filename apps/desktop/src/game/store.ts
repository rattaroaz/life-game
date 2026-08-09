import { create } from 'zustand';
import {
  createCommands,
  createEmptyWorld,
  furnishNeighborhood,
  getObs,
  initObs,
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

initObs({
  minLevel: 'info',
  console: true,
  systemTiming: true,
  traceSampleRate: 0.05,
});

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
  /** Bumps only when a new world is created — used to remount renderer safely */
  worldEpoch: number;
  initNewDemo: () => void;
  openCas: () => void;
  startFromCas: (
    householdName: string,
    members: Parameters<SimCommands['createHousehold']>[0]['members'],
  ) => void;
  saveGame: (slotId?: string) => void;
  loadGame: (slotId: string) => void;
  refreshSaves: () => void;
  frame: (dt: number) => void;
  pushToast: (msg: string) => void;
  setSelectedBuyDef: (id: string | null) => void;
  setBuildKind: (k: GameStore['buildKind']) => void;
  reproject: () => void;
};

/** Module-level tick accumulator — avoids setState every frame */
let tickAccum = 0;
let projectAccum = 0;
const PROJECT_INTERVAL = 0.1; // HUD refresh ~10 Hz

export const useGameStore = create<GameStore>((set, get) => {
  let content: ContentPack;
  try {
    content = loadBuiltinContent();
    getObs().logger.info('boot', 'Content loaded', {
      objects: content.objects.length,
      interactions: content.interactions.length,
    });
  } catch (e) {
    getObs().logger.error('boot', 'Content load failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    content = {
      objects: [],
      interactions: [],
      careers: [],
      traits: [],
      aspirations: [],
    };
  }

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
    worldEpoch: 0,

    refreshSaves() {
      try {
        set({ saves: listLocalSaves() });
      } catch {
        set({ saves: [] });
      }
    },

    pushToast(msg) {
      set((s) => ({ toasts: [...s.toasts.slice(-4), msg] }));
      window.setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t !== msg) }));
      }, 4000);
    },

    reproject() {
      const { world, content: c, toasts } = get();
      if (!world) return;
      try {
        const t0 = performance.now();
        set({ hud: projectHud(world, c, toasts) });
        getObs().metrics.observe('ui.project.ms', performance.now() - t0);
      } catch (e) {
        getObs().logger.error('ui', 'reproject failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    initNewDemo() {
      try {
        tickAccum = 0;
        projectAccum = 0;
        const world = createEmptyWorld(Date.now() % 1_000_000);
        const commands = createCommands(world, content);
        commands.debugSpawnHousehold();
        set((s) => ({
          screen: 'game',
          world,
          commands,
          worldEpoch: s.worldEpoch + 1,
          toasts: [
            'Welcome! Sims care for themselves — watch or step in anytime. F3 = debug.',
          ],
        }));
        getObs().event('game.start', 'ui', { mode: 'demo' });
        get().reproject();
      } catch (e) {
        getObs().logger.error('ui', 'initNewDemo failed', {
          error: e instanceof Error ? e.message : String(e),
        });
        get().pushToast('Failed to start game');
      }
    },

    openCas() {
      getObs().event('ui.open_cas', 'ui');
      set({ screen: 'cas' });
    },

    startFromCas(householdName, members) {
      try {
        tickAccum = 0;
        projectAccum = 0;
        const world = createEmptyWorld(Date.now() % 1_000_000);
        const commands = createCommands(world, content);
        commands.createHousehold({ householdName, funds: 22000, members });
        set((s) => ({
          screen: 'game',
          world,
          commands,
          worldEpoch: s.worldEpoch + 1,
          toasts: [`${householdName} moved in!`],
        }));
        getObs().event('game.start', 'ui', {
          mode: 'cas',
          members: members.length,
        });
        get().reproject();
      } catch (e) {
        getObs().logger.error('ui', 'startFromCas failed', {
          error: e instanceof Error ? e.message : String(e),
        });
        get().pushToast('Failed to create household');
      }
    },

    saveGame(slotId = 'slot1') {
      const { world } = get();
      if (!world) return;
      try {
        saveToLocalStorage(slotId, world, world.household.name);
        get().refreshSaves();
        get().pushToast('Game saved');
        getObs().event('game.saved', 'save', { slotId });
        get().reproject();
      } catch (e) {
        getObs().logger.error('save', 'Save failed', {
          error: e instanceof Error ? e.message : String(e),
        });
        get().pushToast('Save failed');
      }
    },

    loadGame(slotId) {
      try {
        const world = loadFromLocalStorage(slotId);
        if (!world) {
          get().pushToast('Save not found');
          return;
        }
        tickAccum = 0;
        projectAccum = 0;
        // Fill any city places added since the save was written
        furnishNeighborhood(world, content);
        const commands = createCommands(world, content);
        set((s) => ({
          screen: 'game',
          world,
          commands,
          worldEpoch: s.worldEpoch + 1,
          toasts: ['Game loaded'],
        }));
        get().refreshSaves();
        getObs().event('game.loaded', 'save', { slotId });
        get().reproject();
      } catch (e) {
        getObs().logger.error('save', 'Load failed', {
          error: e instanceof Error ? e.message : String(e),
        });
        get().pushToast('Load failed');
      }
    },

    setSelectedBuyDef(id) {
      set({ selectedBuyDef: id });
    },

    setBuildKind(k) {
      set({ buildKind: k });
    },

    frame(dt) {
      const { world, content: c } = get();
      if (!world || !get().commands) return;

      // Clamp pathological dt after tab backgrounding
      const safeDt = Math.min(0.05, Math.max(0, dt));
      world.playTimeSeconds += safeDt;

      let simTickMs = 0;
      let simTicksThisFrame = 0;

      try {
        if (world.mode === 'live' && !world.clock.paused && world.clock.speed > 0) {
          // 1× ≈ 6 ticks/s, 3× ≈ 18 ticks/s — allow enough catch-up per frame
          tickAccum += safeDt * BASE_TICKS_PER_REAL_SECOND * world.clock.speed;
          const maxTicks = 24;
          let n = 0;
          const simT0 = performance.now();
          while (tickAccum >= 1 && n < maxTicks) {
            try {
              runSimTick(world, c);
            } catch (e) {
              getObs().logger.error('sim', 'tick threw — skipped', {
                error: e instanceof Error ? e.message : String(e),
                tick: world.clock.tick,
              });
              // prevent infinite error loop on same tick
              tickAccum = 0;
              break;
            }
            tickAccum -= 1;
            n++;
          }
          // Soft-drop only huge backlog (e.g. tab was backgrounded a long time)
          if (tickAccum > 30) tickAccum = 0;
          simTickMs = performance.now() - simT0;
          simTicksThisFrame = n;

          const drained = get().commands!.drainEvents();
          if (drained.length) {
            for (const m of drained) get().pushToast(m);
          }
        }
      } catch (e) {
        getObs().logger.error('sim', 'frame sim section failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }

      // Throttle HUD projection — main crash source was setState 60x/sec
      projectAccum += safeDt;
      if (projectAccum >= PROJECT_INTERVAL) {
        projectAccum = 0;
        get().reproject();
      }

      getObs().recordFrame({
        frameMs: safeDt * 1000,
        simTickMs,
        simTicksThisFrame,
        projectMs: 0,
        renderMs: 0,
      });
    },
  };
});
