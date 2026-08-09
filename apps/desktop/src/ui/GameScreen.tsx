import { useEffect, useRef } from 'react';
import { WorldView } from '@lifesim/render';
import { useGameStore } from '../game/store';
import { Hud } from './Hud';

export function GameScreen() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<WorldView | null>(null);
  const world = useGameStore((s) => s.world);
  const content = useGameStore((s) => s.content);
  const commands = useGameStore((s) => s.commands);
  const frame = useGameStore((s) => s.frame);
  const selectedBuyDef = useGameStore((s) => s.selectedBuyDef);
  const buildKind = useGameStore((s) => s.buildKind);
  const reproject = useGameStore((s) => s.reproject);

  useEffect(() => {
    if (!hostRef.current || !world) return;
    let cancelled = false;
    const view = new WorldView(content, {
      onPick(entityId, gx, gy) {
        const w = useGameStore.getState().world;
        const cmd = useGameStore.getState().commands;
        if (!w || !cmd) return;

        if (w.mode === 'buy') {
          const def = useGameStore.getState().selectedBuyDef;
          if (def) {
            cmd.placeObject(def, gx, gy);
            reproject();
          }
          return;
        }
        if (w.mode === 'build') {
          const kind = useGameStore.getState().buildKind;
          if (kind === 'erase') {
            cmd.setWallTool(gx, gy, 'h', null);
            cmd.setWallTool(gx, gy, 'v', null);
          } else {
            cmd.setWallTool(gx, gy, 'h', kind);
          }
          reproject();
          return;
        }

        // live mode
        if (entityId != null) {
          const ent = w.entities.get(entityId);
          if (ent?.kind === 'sim') {
            cmd.selectSim(entityId);
            cmd.setWorldTarget(entityId);
          } else {
            cmd.setWorldTarget(entityId);
          }
        } else {
          cmd.setWorldTarget(null);
        }
        reproject();
      },
    });
    viewRef.current = view;
    void view.mount(hostRef.current).then(() => {
      if (cancelled) view.destroy();
    });

    return () => {
      cancelled = true;
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      frame(dt);
      const w = useGameStore.getState().world;
      if (w && viewRef.current) viewRef.current.render(w);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [frame]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = useGameStore.getState().commands;
      if (!cmd) return;
      if (e.key === '1') cmd.setSpeed(1);
      if (e.key === '2') cmd.setSpeed(2);
      if (e.key === '3') cmd.setSpeed(3);
      if (e.key === '0' || e.key === ' ') {
        e.preventDefault();
        const w = useGameStore.getState().world;
        if (w) cmd.setPaused(!w.clock.paused);
      }
      if (e.key === 'Escape') cmd.setWorldTarget(null);
      // camera pan via WASD on camera
      const view = viewRef.current;
      if (view) {
        const step = 40;
        if (e.key === 'w' || e.key === 'W') view.camera.y += step;
        if (e.key === 's' || e.key === 'S') view.camera.y -= step;
        if (e.key === 'a' || e.key === 'A') view.camera.x += step;
        if (e.key === 'd' || e.key === 'D') view.camera.x -= step;
      }
      reproject();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reproject]);

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">LifeSim</div>
        <div className="spacer" />
        <span style={{ color: '#94a3b8', fontSize: 13 }}>
          {selectedBuyDef ? `Buy: ${selectedBuyDef}` : buildKind ? `Build: ${buildKind}` : 'Live'}
        </span>
        <button type="button" onClick={() => useGameStore.getState().saveGame('slot1')}>
          Save
        </button>
        <button
          type="button"
          onClick={() => useGameStore.setState({ screen: 'menu', world: null, commands: null })}
        >
          Menu
        </button>
      </div>
      <div className="main-stage">
        <div className="canvas-host" ref={hostRef} />
        {commands && <Hud />}
      </div>
    </div>
  );
}
