/** Isometric helpers — diamond tiles */

export const TILE_W = 64;
export const TILE_H = 32;

export function gridToScreen(x: number, y: number): { sx: number; sy: number } {
  return {
    sx: (x - y) * (TILE_W / 2),
    sy: (x + y) * (TILE_H / 2),
  };
}

export function screenToGrid(
  sx: number,
  sy: number,
): { x: number; y: number } {
  const x = sx / (TILE_W / 2);
  const y = sy / (TILE_H / 2);
  return {
    x: (x + y) / 2,
    y: (y - x) / 2,
  };
}

export function depthKey(
  anchorX: number,
  anchorY: number,
  layerBias: number,
  entityId: number,
  footprintTie = 0,
): number {
  const DEPTH_SCALE = 1000;
  return (
    (anchorX + anchorY) * DEPTH_SCALE +
    layerBias +
    footprintTie +
    entityId * 0.001
  );
}
