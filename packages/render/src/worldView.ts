import { Application, Container, Graphics, Text } from 'pixi.js';
import type { ContentPack, EntityId, World } from '@lifesim/sim';
import { allObjects, allSims } from '@lifesim/sim';
import { daylightFactor } from '@lifesim/sim';
import { depthKey, gridToScreen, screenToGrid, TILE_H, TILE_W } from './iso.js';

export type WorldViewCallbacks = {
  onPick: (entityId: EntityId | null, gridX: number, gridY: number) => void;
};

const SKIN: Record<string, number> = {
  tone_1: 0xffe0bd,
  tone_2: 0xf1c27d,
  tone_3: 0xc68642,
  tone_4: 0x8d5524,
  tone_5: 0x5c3317,
};

const OUTFIT: Record<string, number> = {
  outfit_casual: 0x3498db,
  outfit_pro: 0x2c3e50,
  outfit_sport: 0xe74c3c,
};

export class WorldView {
  app: Application;
  worldLayer = new Container();
  camera = { x: 0, y: 0, zoom: 1 };
  private dragging = false;
  private lastPtr = { x: 0, y: 0 };
  private content: ContentPack;
  private callbacks: WorldViewCallbacks;
  private ready = false;

  constructor(content: ContentPack, callbacks: WorldViewCallbacks) {
    this.app = new Application();
    this.content = content;
    this.callbacks = callbacks;
  }

  async mount(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: 0x1a1a2e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.worldLayer);
    this.worldLayer.eventMode = 'static';
    this.app.stage.eventMode = 'static';
    this.app.canvas.style.touchAction = 'none';

    this.app.stage.on('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2) {
        this.dragging = true;
        this.lastPtr = { x: e.global.x, y: e.global.y };
        return;
      }
      const local = this.screenToWorld(e.global.x, e.global.y);
      const g = screenToGrid(local.x, local.y);
      const gx = Math.floor(g.x);
      const gy = Math.floor(g.y);
      const hit = this.hitTest(gx, gy);
      this.callbacks.onPick(hit, gx, gy);
    });
    this.app.stage.on('pointerup', () => {
      this.dragging = false;
    });
    this.app.stage.on('pointerupoutside', () => {
      this.dragging = false;
    });
    this.app.stage.on('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.global.x - this.lastPtr.x;
      const dy = e.global.y - this.lastPtr.y;
      this.camera.x += dx;
      this.camera.y += dy;
      this.lastPtr = { x: e.global.x, y: e.global.y };
    });
    this.app.canvas.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const factor = ev.deltaY > 0 ? 0.9 : 1.1;
        this.camera.zoom = Math.min(2.5, Math.max(0.35, this.camera.zoom * factor));
      },
      { passive: false },
    );
    this.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Center camera on house
    const c = gridToScreen(14, 14);
    this.camera.x = this.app.screen.width / 2 - c.sx;
    this.camera.y = this.app.screen.height / 3 - c.sy;
    this.ready = true;
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.camera.x) / this.camera.zoom,
      y: (sy - this.camera.y) / this.camera.zoom,
    };
  }

  private hitWorld: World | null = null;

  private hitTest(gx: number, gy: number): EntityId | null {
    if (!this.hitWorld) return null;
    // Sims first
    for (const sim of allSims(this.hitWorld)) {
      if (sim.presence !== 'on_lot') continue;
      if (Math.floor(sim.transform.x) === gx && Math.floor(sim.transform.y) === gy) {
        return sim.id;
      }
    }
    const idx = gy * this.hitWorld.lot.width + gx;
    const objs = this.hitWorld.lot.objectsAt.get(idx);
    if (objs?.length) return objs[objs.length - 1]!;
    return null;
  }

  render(world: World): void {
    if (!this.ready) return;
    this.hitWorld = world;
    this.worldLayer.removeChildren();
    this.worldLayer.position.set(this.camera.x, this.camera.y);
    this.worldLayer.scale.set(this.camera.zoom);

    const day = daylightFactor(world.clock.minuteOfDay);
    const tintMul = world.weather === 'rain' ? 0.85 : 1;
    const ambient = 0.35 + day * 0.65 * tintMul;

    type DrawItem = { z: number; g: Graphics | Container };
    const items: DrawItem[] = [];

    // Floor tiles
    for (let y = 0; y < world.lot.height; y++) {
      for (let x = 0; x < world.lot.width; x++) {
        const cover = world.lot.floorCover[y * world.lot.width + x]!;
        const { sx, sy } = gridToScreen(x, y);
        const g = new Graphics();
        const col =
          cover === 2
            ? shade(0xc4a574, ambient)
            : shade(0x3d8b40, ambient * (world.weather === 'rain' ? 0.7 : 1));
        g.poly([
          sx,
          sy,
          sx + TILE_W / 2,
          sy + TILE_H / 2,
          sx,
          sy + TILE_H,
          sx - TILE_W / 2,
          sy + TILE_H / 2,
        ]);
        g.fill({ color: col });
        g.stroke({ width: 1, color: shade(0x000000, 0.15), alpha: 0.2 });
        items.push({ z: depthKey(x, y, 0, 0), g });
      }
    }

    // Walls
    for (const w of world.lot.walls) {
      const { sx, sy } = gridToScreen(w.x, w.y);
      const g = new Graphics();
      const h = w.kind === 'door' ? 18 : 28;
      const color =
        w.kind === 'door' ? 0x8b4513 : w.kind === 'window' ? 0x87ceeb : 0xd9cfc0;
      if (w.dir === 'h') {
        g.rect(sx - TILE_W / 2, sy - h, TILE_W, h);
      } else {
        g.rect(sx - 4, sy - h + TILE_H / 4, 8, h);
      }
      g.fill({ color: shade(color, ambient) });
      if (w.kind === 'window') {
        g.stroke({ width: 2, color: 0x4a90d9 });
      }
      items.push({
        z: depthKey(w.x, w.y, 100, 0),
        g,
      });
    }

    // Objects
    for (const obj of allObjects(world)) {
      const def = this.content.objects.find((o) => o.id === obj.defId);
      const color = parseColor(def?.color ?? '#888');
      const ax = obj.transform.x + obj.footprint.w - 1;
      const ay = obj.transform.y + obj.footprint.h - 1;
      const { sx, sy } = gridToScreen(obj.transform.x, obj.transform.y);
      const g = new Graphics();
      const w = obj.footprint.w * (TILE_W / 2);
      const h = obj.footprint.h * (TILE_H / 2);
      // boxy iso object
      g.roundRect(sx - w / 2, sy - 20 - h / 2, w, 20 + h / 2, 4);
      g.fill({ color: shade(color, ambient) });
      g.stroke({ width: 1, color: 0x111 });
      if (world.ui.targetEntityId === obj.id || world.ui.selectedSimId === obj.id) {
        g.stroke({ width: 2, color: 0x00ff88 });
      }
      const label = new Text({
        text: (def?.nameKey ?? '?').slice(0, 8),
        style: { fontSize: 9, fill: 0xffffff },
      });
      label.x = sx - 16;
      label.y = sy - 28;
      const c = new Container();
      c.addChild(g);
      c.addChild(label);
      items.push({
        z: depthKey(ax, ay, 200, obj.id, obj.footprint.w + obj.footprint.h),
        g: c,
      });
    }

    // Sims
    for (const sim of allSims(world)) {
      if (sim.presence !== 'on_lot') continue;
      const { sx, sy } = gridToScreen(sim.transform.x, sim.transform.y);
      const c = new Container();
      const body = new Graphics();
      const skin = SKIN[sim.visual.skinTone] ?? 0xc68642;
      const clothes = OUTFIT[sim.visual.outfitPreset] ?? 0x3498db;
      // shadow
      body.ellipse(sx, sy + 8, 12, 6);
      body.fill({ color: 0x000000, alpha: 0.25 });
      // body
      body.roundRect(sx - 10, sy - 36, 20, 28, 4);
      body.fill({ color: shade(clothes, ambient) });
      // head
      body.circle(sx, sy - 42, 10);
      body.fill({ color: shade(skin, ambient) });
      // selection
      if (world.ui.selectedSimId === sim.id) {
        body.circle(sx, sy - 60, 5);
        body.fill({ color: 0x00ff88 });
      }
      if (world.ui.targetEntityId === sim.id) {
        body.circle(sx, sy - 60, 5);
        body.fill({ color: 0xffaa00 });
      }
      const name = new Text({
        text: sim.identity.firstName,
        style: { fontSize: 11, fill: 0xffffff, fontWeight: 'bold' },
      });
      name.x = sx - name.width / 2;
      name.y = sy - 70;
      c.addChild(body);
      c.addChild(name);
      // mood diamond
      const moodG = new Graphics();
      const mc = sim.mood.value > 60 ? 0x2ecc71 : sim.mood.value > 35 ? 0xf1c40f : 0xe74c3c;
      moodG.poly([sx, sy - 78, sx + 5, sy - 73, sx, sy - 68, sx - 5, sy - 73]);
      moodG.fill({ color: mc });
      c.addChild(moodG);

      items.push({
        z: depthKey(sim.transform.x, sim.transform.y, 300, sim.id),
        g: c,
      });
    }

    items.sort((a, b) => a.z - b.z);
    for (const it of items) this.worldLayer.addChild(it.g);

    // Night overlay
    if (ambient < 0.85) {
      const overlay = new Graphics();
      const w = world.lot.width * TILE_W;
      const h = world.lot.height * TILE_H;
      overlay.rect(-w, -h, w * 3, h * 3);
      overlay.fill({ color: 0x0a0a20, alpha: Math.max(0, 0.55 - ambient * 0.5) });
      this.worldLayer.addChild(overlay);
    }
  }

  destroy(): void {
    this.app.destroy(true);
  }
}

function shade(color: number, ambient: number): number {
  const r = ((color >> 16) & 0xff) * ambient;
  const g = ((color >> 8) & 0xff) * ambient;
  const b = (color & 0xff) * ambient;
  return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
}

function parseColor(css: string): number {
  if (css.startsWith('#')) {
    return parseInt(css.slice(1), 16);
  }
  if (css.startsWith('hsl')) {
    // rough fallback
    return 0x888888;
  }
  return 0x888888;
}
