/** Shared types & IPC contracts for LifeSim */

export type SaveSlotMeta = {
  id: string;
  name: string;
  householdName: string;
  playTimeSeconds: number;
  schemaVersion: number;
  updatedAt: string;
};

export type AppPaths = {
  saves: string;
  userContent: string;
};

export type TauriCommands = {
  list_saves: () => Promise<SaveSlotMeta[]>;
  load_game: (id: string) => Promise<number[]>;
  save_game: (id: string, meta: SaveSlotMeta, body: number[]) => Promise<void>;
  delete_save: (id: string) => Promise<void>;
  get_asset: (relativePackPath: string) => Promise<number[]>;
  get_app_paths: () => Promise<AppPaths>;
};

export const SAVE_SCHEMA_VERSION = 1;

export type GameMode = 'live' | 'build' | 'buy' | 'cas';
export type Weather = 'sunny' | 'rain';
export type Facing = 0 | 1 | 2 | 3;
export type Rot = 0 | 1 | 2 | 3;
