import { Application, Container, Graphics, Text } from 'pixi.js';
import type { ContentPack, EntityId, World } from '@lifesim/sim';
import { allObjects, allSims, daylightFactor } from '@lifesim/sim';
// active place filtering
import { depthKey, gridToScreen, screenToGrid, TILE_H, TILE_W } from './iso.js';

export type WorldViewCallbacks = {
  onPick: (entityId: EntityId | null, gridX: number, gridY: number) => void;
  /** Left double-click: walk selected Sim to tile (and optionally face an object). */
  onDoubleClick?: (
    entityId: EntityId | null,
    gridX: number,
    gridY: number,
  ) => void;
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

/**
 * Isometric world view.
 * Static geometry (floor/walls/objects) is rebuilt only when lotRevision changes.
 * Dynamic layer (sims + selection) updates every frame.
 */
export class WorldView {
  app: Application;
  root = new Container();
  staticLayer = new Container();
  dynamicLayer = new Container();
  camera = { x: 0, y: 0, zoom: 1 };
  /**
   * Camera stays still while the selected Sim walks around on-screen.
   * Only when they leave the viewport (or on explicit select/zoom) does the
   * background jump to reframe their new location.
   */
  private dragging = false;
  private lastPtr = { x: 0, y: 0 };
  private content: ContentPack;
  private callbacks: WorldViewCallbacks;
  private ready = false;
  private destroyed = false;
  private hitWorld: World | null = null;
  private lastLotRevision = -1;
  private lastWeather = '';
  private lastDayBucket = -1;
  private wheelHandler: ((ev: WheelEvent) => void) | null = null;
  private contextHandler: ((ev: Event) => void) | null = null;
  /** One-shot recenter (HUD select, zoom, initial mount). */
  private forceSnap = true;
  /** Keep this many pixels of padding before counting as "off screen". */
  private readonly edgePad = 48;
  private lastClickAt = 0;
  private lastClickTile = { x: -999, y: -999 };
  private readonly doubleClickMs = 350;

  constructor(content: ContentPack, callbacks: WorldViewCallbacks) {
    this.app = new Application();
    this.content = content;
    this.callbacks = callbacks;
  }

  async mount(host: HTMLElement): Promise<void> {
    if (this.destroyed) return;
    const initOpts = {
      resizeTo: host,
      background: 0x1a1a2e,
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
      autoDensity: true,
      powerPreference: 'high-performance' as const,
    };
    try {
      await this.app.init({ ...initOpts, preference: 'webgl' });
    } catch {
      await this.app.init({ ...initOpts, resolution: 1 });
    }

    if (this.destroyed) {
      try {
        this.app.destroy(true);
      } catch {
        /* ignore */
      }
      return;
    }

    const canvas = this.app.canvas;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    host.appendChild(canvas);

    if (host.clientWidth > 0 && host.clientHeight > 0) {
      try {
        this.app.renderer.resize(host.clientWidth, host.clientHeight);
      } catch {
        /* ignore */
      }
    }

    this.root.addChild(this.staticLayer);
    this.root.addChild(this.dynamicLayer);
    this.app.stage.addChild(this.root);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;

    this.app.stage.on('pointerdown', this.onPointerDown);
    this.app.stage.on('pointerup', this.onPointerUp);
    this.app.stage.on('pointerupoutside', this.onPointerUp);
    this.app.stage.on('pointermove', this.onPointerMove);

    this.wheelHandler = (ev: WheelEvent) => {
      ev.preventDefault();
      const factor = ev.deltaY > 0 ? 0.9 : 1.1;
      this.camera.zoom = Math.min(2.5, Math.max(0.45, this.camera.zoom * factor));
      // After zoom, only reframe if the focus Sim would be off-screen
      this.forceSnap = false;
      if (this.hitWorld) this.reframeIfOffscreen(this.hitWorld, true);
    };
    this.contextHandler = (e) => e.preventDefault();
    canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    canvas.addEventListener('contextmenu', this.contextHandler);

    this.forceSnap = true;
    this.ready = true;
  }

  /** Call when player selects a Sim from the HUD — jump camera to them once. */
  snapToEntity(world: World, entityId: EntityId | null): void {
    this.hitWorld = world;
    if (entityId != null) world.ui.selectedSimId = entityId;
    this.reframeIfOffscreen(world, true);
  }

  private viewportSize(): { sw: number; sh: number } {
    const sw =
      this.app.screen?.width ||
      this.app.canvas?.clientWidth ||
      this.app.canvas?.width ||
      800;
    const sh =
      this.app.screen?.height ||
      this.app.canvas?.clientHeight ||
      this.app.canvas?.height ||
      600;
    return { sw: Math.max(1, sw), sh: Math.max(1, sh) };
  }

  /** Focus point for camera: selected Sim, or door while at work. */
  private focusWorldPoint(world: World): { wx: number; wy: number } | null {
    let sim =
      world.ui.selectedSimId != null
        ? allSims(world).find((s) => s.id === world.ui.selectedSimId)
        : null;
    if (!sim) sim = allSims(world)[0] ?? null;
    if (!sim) return null;

    if (sim.presence !== 'on_lot') {
      const entry = world.lot.entryMarkers[0] ?? { x: 14, y: 21 };
      return { wx: entry.x, wy: entry.y };
    }
    if (!Number.isFinite(sim.transform.x) || !Number.isFinite(sim.transform.y)) {
      return null;
    }
    return { wx: sim.transform.x, wy: sim.transform.y };
  }

  /** Screen pixel position of an iso world point under the current camera. */
  private worldToScreen(isoX: number, isoY: number): { x: number; y: number } {
    const z = this.camera.zoom || 1;
    return {
      x: this.camera.x + isoX * z,
      y: this.camera.y + isoY * z,
    };
  }

  private isOnScreen(screenX: number, screenY: number): boolean {
    const { sw, sh } = this.viewportSize();
    const p = this.edgePad;
    return screenX >= p && screenX <= sw - p && screenY >= p && screenY <= sh - p;
  }

  /**
   * Jump camera so the focus point sits in the middle of the view.
   * Does not run every frame — only when off-screen or forced.
   */
  private centerOnWorld(wx: number, wy: number): void {
    const { sx, sy } = gridToScreen(wx, wy);
    const z = this.camera.zoom || 1;
    const { sw, sh } = this.viewportSize();
    const tx = sw * 0.5 - sx * z;
    const ty = sh * 0.45 - sy * z;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    this.camera.x = tx;
    this.camera.y = ty;
  }

  /**
   * Keep background still while Sim walks; if they leave the screen (or force),
   * reframe once to their new location.
   */
  reframeIfOffscreen(world: World, force = false): void {
    if (this.dragging) return;
    const focus = this.focusWorldPoint(world);
    if (!focus) return;
    const { sx, sy } = gridToScreen(focus.wx, focus.wy);
    const screen = this.worldToScreen(sx, sy);
    if (force || !this.isOnScreen(screen.x, screen.y)) {
      this.centerOnWorld(focus.wx, focus.wy);
    }
  }

  private onPointerDown = (e: {
    button: number;
    global: { x: number; y: number };
    detail?: number;
  }) => {
    if (!this.ready || this.destroyed) return;
    try {
      if (e.button === 1 || e.button === 2) {
        this.dragging = true;
        this.lastPtr = { x: e.global.x, y: e.global.y };
        return;
      }
      if (e.button !== 0) return;

      const local = this.screenToWorld(e.global.x, e.global.y);
      const g = screenToGrid(local.x, local.y);
      const gx = Math.floor(g.x);
      const gy = Math.floor(g.y);
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;
      const hit = this.hitTest(gx, gy, local.x, local.y);

      const now = performance.now();
      const isDouble =
        (typeof e.detail === 'number' && e.detail >= 2) ||
        (now - this.lastClickAt < this.doubleClickMs &&
          this.lastClickTile.x === gx &&
          this.lastClickTile.y === gy);
      this.lastClickAt = now;
      this.lastClickTile = { x: gx, y: gy };

      if (isDouble && this.callbacks.onDoubleClick) {
        this.callbacks.onDoubleClick(hit, gx, gy);
        return;
      }
      this.callbacks.onPick(hit, gx, gy);
    } catch (err) {
      console.warn('pick error', err);
    }
  };

  private onPointerUp = () => {
    this.dragging = false;
  };

  private onPointerMove = (e: { global: { x: number; y: number } }) => {
    if (!this.dragging) return;
    const dx = e.global.x - this.lastPtr.x;
    const dy = e.global.y - this.lastPtr.y;
    this.camera.x += dx;
    this.camera.y += dy;
    this.lastPtr = { x: e.global.x, y: e.global.y };
  };

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const z = this.camera.zoom || 1;
    return {
      x: (sx - this.camera.x) / z,
      y: (sy - this.camera.y) / z,
    };
  }

  private rotateOffset(
    ox: number,
    oy: number,
    rot: 0 | 1 | 2 | 3,
  ): { x: number; y: number } {
    let x = ox;
    let y = oy;
    for (let i = 0; i < rot; i++) {
      const nx = -y;
      const ny = x;
      x = nx;
      y = ny;
    }
    return { x, y };
  }

  /**
   * Pick Sims or any object under/near the click — footprint cells, slot approach
   * tiles, and nearest interactable within 1.5 tiles.
   */
  private hitTest(
    gx: number,
    gy: number,
    worldX?: number,
    worldY?: number,
  ): EntityId | null {
    const world = this.hitWorld;
    if (!world) return null;
    try {
      const placeId = world.neighborhood?.activePlaceId ?? world.lot.id;
      // 1) Sims — exact tile or near click in world space
      let bestSim: { id: EntityId; d: number } | null = null;
      for (const sim of allSims(world)) {
        if (sim.presence !== 'on_lot') continue;
        if (sim.placeId !== placeId) continue;
        const sx = Math.floor(sim.transform.x);
        const sy = Math.floor(sim.transform.y);
        if (sx === gx && sy === gy) return sim.id;
        if (worldX !== undefined && worldY !== undefined) {
          const d = Math.hypot(sim.transform.x - worldX, sim.transform.y - worldY);
          if (d < 0.85 && (!bestSim || d < bestSim.d)) {
            bestSim = { id: sim.id, d };
          }
        }
      }
      if (bestSim) return bestSim.id;

      // 2) Object footprint occupancy map
      if (gx >= 0 && gy >= 0 && gx < world.lot.width && gy < world.lot.height) {
        const idx = gy * world.lot.width + gx;
        const objs = world.lot.objectsAt.get(idx);
        if (objs?.length) {
          // Prefer interactable objects on the stack
          for (let i = objs.length - 1; i >= 0; i--) {
            const id = objs[i]!;
            const o = world.entities.get(id);
            if (o?.kind !== 'object') continue;
            const def = this.content.objects.find((d) => d.id === o.defId);
            if (def && def.interactions.length > 0) return id;
          }
          return objs[objs.length - 1]!;
        }
      }

      // 3) Footprint / approach / adjacency for every object (covers slots in front)
      let bestObj: { id: EntityId; d: number } | null = null;
      for (const obj of allObjects(world)) {
        if (obj.placeId && obj.placeId !== placeId) continue;
        const def = this.content.objects.find((d) => d.id === obj.defId);
        const fw = Math.max(1, obj.footprint.w);
        const fh = Math.max(1, obj.footprint.h);
        const ox = obj.transform.x;
        const oy = obj.transform.y;

        // Inside footprint
        if (gx >= ox && gx < ox + fw && gy >= oy && gy < oy + fh) {
          const d = Math.abs(gx - ox) + Math.abs(gy - oy);
          if (!bestObj || d < bestObj.d) bestObj = { id: obj.id, d };
          continue;
        }

        // Slot approach tiles
        if (def) {
          for (const slot of def.slots) {
            const off = this.rotateOffset(slot.offset.x, slot.offset.y, obj.transform.rot);
            const ax = Math.round(ox + off.x);
            const ay = Math.round(oy + off.y);
            if (ax === gx && ay === gy) {
              return obj.id;
            }
          }
        }

        // Chebyshev proximity (click next to furniture)
        const cx = ox + (fw - 1) / 2;
        const cy = oy + (fh - 1) / 2;
        const cheb = Math.max(Math.abs(gx - cx), Math.abs(gy - cy));
        if (cheb <= 1.6 && def && def.interactions.length > 0) {
          const d = Math.abs(gx - cx) + Math.abs(gy - cy);
          if (!bestObj || d < bestObj.d) bestObj = { id: obj.id, d: d + 0.5 };
        }
      }
      if (bestObj) return bestObj.id;
    } catch {
      return null;
    }
    return null;
  }

  /** Static camera + jump only when focus leaves the frame (or forceSnap). */
  private updateCamera(world: World): void {
    if (this.dragging) return;
    const force = this.forceSnap;
    this.forceSnap = false;
    this.reframeIfOffscreen(world, force);
  }

  /** Cheap lot fingerprint for static rebuilds */
  private lotRevision(world: World): number {
    // Include place id so switching city views rebuilds static geometry
    let h = 0;
    const pid = world.neighborhood?.activePlaceId ?? world.lot.id;
    for (let i = 0; i < pid.length; i++) h = (h * 33 + pid.charCodeAt(i)) | 0;
    h = (h * 31 + world.lot.width * 31 + world.lot.height) | 0;
    h = (h * 31 + world.lot.walls.length) | 0;
    let objCount = 0;
    for (const e of world.entities.values()) {
      if (e.kind === 'object') {
        objCount++;
        h = (h * 31 + e.id + e.transform.x * 7 + e.transform.y * 13) | 0;
      }
    }
    h = (h * 31 + objCount) | 0;
    return h;
  }

  private clearContainer(c: Container): void {
    const children = c.removeChildren();
    for (const ch of children) {
      try {
        ch.destroy({ children: true });
      } catch {
        /* ignore */
      }
    }
  }

  private rebuildStatic(world: World, ambient: number): void {
    this.clearContainer(this.staticLayer);

    const lot = world.lot;
    // Floor — single Graphics batch for speed
    const floorG = new Graphics();
    for (let y = 0; y < lot.height; y++) {
      for (let x = 0; x < lot.width; x++) {
        const cover = lot.floorCover[y * lot.width + x] ?? 1;
        const { sx, sy } = gridToScreen(x, y);
        // 1 grass · 2 wood · 3 stone · 4 sand · 5 tile · 6 exit · 7 asphalt · 8 sidewalk · 9 crosswalk
        const base =
          cover === 2
            ? 0xc4a574 // wood
            : cover === 3
              ? 0x8b8b8b // stone
              : cover === 4
                ? 0xc2b280 // sand
                : cover === 5
                  ? 0xb0b8c0 // tile
                  : cover === 6
                    ? 0xf59e0b // exit pad
                    : cover === 7
                      ? 0x3a3a42 // asphalt
                      : cover === 8
                        ? 0xb8bcc4 // sidewalk
                        : cover === 9
                          ? 0xe8e8ec // crosswalk stripes
                          : 0x3d8b40; // grass
        const col = shade(
          base,
          ambient *
            (world.weather === 'rain' && (cover === 1 || cover === 7 || cover === 8)
              ? 0.7
              : 1),
        );
        floorG.poly([
          sx,
          sy,
          sx + TILE_W / 2,
          sy + TILE_H / 2,
          sx,
          sy + TILE_H,
          sx - TILE_W / 2,
          sy + TILE_H / 2,
        ]);
        floorG.fill({ color: col });
      }
    }
    this.staticLayer.addChild(floorG);

    // Walls
    const wallG = new Graphics();
    for (const w of lot.walls) {
      const { sx, sy } = gridToScreen(w.x, w.y);
      const h = w.kind === 'door' ? 18 : 28;
      const color =
        w.kind === 'door' ? 0x8b4513 : w.kind === 'window' ? 0x87ceeb : 0xd9cfc0;
      if (w.dir === 'h') {
        wallG.rect(sx - TILE_W / 2, sy - h, TILE_W, h);
      } else {
        wallG.rect(sx - 4, sy - h + TILE_H / 4, 8, h);
      }
      wallG.fill({ color: shade(color, ambient) });
    }
    this.staticLayer.addChild(wallG);

    // Objects (batched-ish: one graphics + optional minimal labels for named furniture only)
    const objG = new Graphics();
    const labelRoot = new Container();
    const placeId = world.neighborhood?.activePlaceId ?? world.lot.id;
    for (const obj of allObjects(world)) {
      if (obj.placeId && obj.placeId !== placeId) continue;
      const def = this.content.objects.find((o) => o.id === obj.defId);
      const color = parseColor(def?.color ?? '#888888');
      const { sx, sy } = gridToScreen(obj.transform.x, obj.transform.y);
      const w = Math.max(1, obj.footprint.w) * (TILE_W / 2);
      const h = Math.max(1, obj.footprint.h) * (TILE_H / 2);
      objG.roundRect(sx - w / 2, sy - 20 - h / 2, w, 20 + h / 2, 3);
      objG.fill({ color: shade(color, ambient) });
      // labels only for non-decor (keeps node count low)
      if (def && !def.id.startsWith('object.decor_') && def.category !== 'decor') {
        try {
          const label = new Text({
            text: (def.nameKey ?? '?').slice(0, 8),
            style: { fontSize: 9, fill: 0xffffff },
          });
          label.x = sx - 14;
          label.y = sy - 26;
          labelRoot.addChild(label);
        } catch {
          /* Text may fail if font not ready — ignore */
        }
      }
    }
    this.staticLayer.addChild(objG);
    this.staticLayer.addChild(labelRoot);
  }

  private rebuildDynamic(world: World, ambient: number): void {
    this.clearContainer(this.dynamicLayer);

    type DrawItem = { z: number; node: Container | Graphics };
    const items: DrawItem[] = [];

    const placeId = world.neighborhood?.activePlaceId ?? world.lot.id;
    for (const obj of allObjects(world)) {
      if (obj.placeId && obj.placeId !== placeId) continue;
      if (world.ui.targetEntityId !== obj.id) continue;
      const { sx, sy } = gridToScreen(obj.transform.x, obj.transform.y);
      const g = new Graphics();
      const w = Math.max(1, obj.footprint.w) * (TILE_W / 2);
      const h = Math.max(1, obj.footprint.h) * (TILE_H / 2);
      g.roundRect(sx - w / 2 - 2, sy - 22 - h / 2, w + 4, 24 + h / 2, 4);
      g.stroke({ width: 2, color: 0x00ff88 });
      items.push({
        z: depthKey(obj.transform.x, obj.transform.y, 250, obj.id),
        node: g,
      });
    }

    for (const sim of allSims(world)) {
      // Only draw Sims in this place (at-work shown on their work/home entry)
      let drawX = sim.transform.x;
      let drawY = sim.transform.y;
      if (sim.presence !== 'on_lot') {
        if (sim.placeId !== placeId) continue;
        const entry =
          world.lots[sim.placeId]?.entryMarkers[0] ??
          world.lot.entryMarkers[0] ?? { x: 14, y: 21 };
        drawX = entry.x;
        drawY = entry.y;
      } else if (sim.placeId !== placeId) {
        continue;
      }
      if (!Number.isFinite(drawX) || !Number.isFinite(drawY)) continue;
      const { sx, sy } = gridToScreen(drawX, drawY);
      const c = new Container();
      const body = new Graphics();
      const skin = SKIN[sim.visual.skinTone] ?? 0xc68642;
      const clothes = OUTFIT[sim.visual.outfitPreset] ?? 0x3498db;
      const alpha = sim.presence === 'on_lot' ? 1 : 0.55;
      body.ellipse(sx, sy + 8, 12, 6);
      body.fill({ color: 0x000000, alpha: 0.25 * alpha });
      body.roundRect(sx - 10, sy - 36, 20, 28, 4);
      body.fill({ color: shade(clothes, ambient), alpha });
      body.circle(sx, sy - 42, 10);
      body.fill({ color: shade(skin, ambient), alpha });
      if (world.ui.selectedSimId === sim.id) {
        body.circle(sx, sy - 60, 5);
        body.fill({ color: 0x00ff88 });
      }
      if (world.ui.targetEntityId === sim.id) {
        body.circle(sx, sy - 60, 5);
        body.fill({ color: 0xffaa00 });
      }
      c.addChild(body);
      try {
        const label =
          sim.presence === 'on_lot'
            ? String(sim.identity.firstName || 'Sim').slice(0, 12)
            : `${String(sim.identity.firstName || 'Sim').slice(0, 8)} (work)`;
        const name = new Text({
          text: label,
          style: { fontSize: 11, fill: 0xffffff, fontWeight: 'bold' },
        });
        name.x = sx - name.width / 2;
        name.y = sy - 70;
        c.addChild(name);
      } catch {
        /* ignore text failures */
      }
      const moodG = new Graphics();
      const mc =
        sim.mood.value > 60 ? 0x2ecc71 : sim.mood.value > 35 ? 0xf1c40f : 0xe74c3c;
      moodG.poly([sx, sy - 78, sx + 5, sy - 73, sx, sy - 68, sx - 5, sy - 73]);
      moodG.fill({ color: mc });
      c.addChild(moodG);
      items.push({
        z: depthKey(drawX, drawY, 300, sim.id),
        node: c,
      });
    }

    items.sort((a, b) => a.z - b.z);
    for (const it of items) this.dynamicLayer.addChild(it.node);
  }

  render(world: World): void {
    if (!this.ready || this.destroyed) return;
    try {
      this.hitWorld = world;
      this.updateCamera(world);
      this.root.position.set(this.camera.x, this.camera.y);
      this.root.scale.set(this.camera.zoom);

      const day = daylightFactor(world.clock.minuteOfDay);
      const tintMul = world.weather === 'rain' ? 0.85 : 1;
      const ambient = 0.35 + day * 0.65 * tintMul;
      // Bucket daylight so we don't rebuild static every minute
      const dayBucket = Math.floor(world.clock.minuteOfDay / 60);
      const rev = this.lotRevision(world);
      const needStatic =
        rev !== this.lastLotRevision ||
        world.weather !== this.lastWeather ||
        dayBucket !== this.lastDayBucket;

      if (needStatic) {
        this.rebuildStatic(world, ambient);
        this.lastLotRevision = rev;
        this.lastWeather = world.weather;
        this.lastDayBucket = dayBucket;
      }

      this.rebuildDynamic(world, ambient);

      // Night veil (cheap overlay, part of dynamic)
      if (ambient < 0.75) {
        const overlay = new Graphics();
        const w = world.lot.width * TILE_W;
        const h = world.lot.height * TILE_H;
        overlay.rect(-w, -h, w * 3, h * 3);
        overlay.fill({
          color: 0x0a0a20,
          alpha: Math.max(0, 0.55 - ambient * 0.5),
        });
        this.dynamicLayer.addChild(overlay);
      }
    } catch (e) {
      console.warn('WorldView.render error', e);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.ready = false;
    this.hitWorld = null;
    try {
      const canvas = this.app.canvas;
      if (this.wheelHandler) {
        canvas.removeEventListener('wheel', this.wheelHandler);
      }
      if (this.contextHandler) {
        canvas.removeEventListener('contextmenu', this.contextHandler);
      }
      this.app.stage.off('pointerdown', this.onPointerDown);
      this.app.stage.off('pointerup', this.onPointerUp);
      this.app.stage.off('pointerupoutside', this.onPointerUp);
      this.app.stage.off('pointermove', this.onPointerMove);
    } catch {
      /* ignore */
    }
    try {
      this.clearContainer(this.staticLayer);
      this.clearContainer(this.dynamicLayer);
      this.app.destroy(true, { children: true });
    } catch (e) {
      console.warn('WorldView.destroy', e);
    }
  }
}

function shade(color: number, ambient: number): number {
  const a = Math.max(0, Math.min(1, ambient));
  const r = ((color >> 16) & 0xff) * a;
  const g = ((color >> 8) & 0xff) * a;
  const b = (color & 0xff) * a;
  return (
    (Math.min(255, Math.max(0, r)) << 16) |
    (Math.min(255, Math.max(0, g)) << 8) |
    Math.min(255, Math.max(0, b))
  );
}

function parseColor(css: string): number {
  if (!css) return 0x888888;
  if (css.startsWith('#') && css.length >= 7) {
    const n = parseInt(css.slice(1, 7), 16);
    return Number.isFinite(n) ? n : 0x888888;
  }
  return 0x888888;
}
