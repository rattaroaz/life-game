import { useEffect, useRef, useState } from 'react';
import { WorldView } from '@lifesim/render';
import { getObs } from '@lifesim/sim';
import { useGameStore } from '../game/store';
import { Hud } from './Hud';

export function GameScreen() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<WorldView | null>(null);
  const mountingRef = useRef(false);
  const world = useGameStore((s) => s.world);
  const content = useGameStore((s) => s.content);
  const commands = useGameStore((s) => s.commands);
  const worldEpoch = useGameStore((s) => s.worldEpoch);
  const frame = useGameStore((s) => s.frame);
  const selectedBuyDef = useGameStore((s) => s.selectedBuyDef);
  const buildKind = useGameStore((s) => s.buildKind);
  const reproject = useGameStore((s) => s.reproject);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Mount renderer once per worldEpoch — NOT on every reproject/world identity churn
  useEffect(() => {
    if (!hostRef.current || !world) return;
    if (mountingRef.current) return;
    mountingRef.current = true;
    let cancelled = false;
    const host = hostRef.current;

    const view = new WorldView(content, {
      onPick(entityId, gx, gy) {
        try {
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
        } catch (e) {
          getObs().logger.error('input', 'pick handler failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
      onDoubleClick(entityId, gx, gy) {
        try {
          const w = useGameStore.getState().world;
          const cmd = useGameStore.getState().commands;
          if (!w || !cmd || w.mode !== 'live') return;

          // Double-click object: walk to it and open interactions
          let tx = gx;
          let ty = gy;
          if (entityId != null) {
            const ent = w.entities.get(entityId);
            if (ent?.kind === 'object') {
              cmd.setWorldTarget(entityId);
              // Approach slightly in front of object origin
              tx = Math.round(ent.transform.x);
              ty = Math.round(ent.transform.y) + 1;
            } else if (ent?.kind === 'sim') {
              // Walk next to other sim
              tx = Math.round(ent.transform.x);
              ty = Math.round(ent.transform.y) + 1;
              cmd.setWorldTarget(entityId);
            }
          } else {
            cmd.setWorldTarget(null);
          }

          const ok = cmd.walkTo(tx, ty);
          if (!ok) {
            // try original tile
            cmd.walkTo(gx, gy);
          }
          reproject();
        } catch (e) {
          getObs().logger.error('input', 'double-click walk failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
    });

    void (async () => {
      try {
        await view.mount(host);
        if (cancelled) {
          view.destroy();
          return;
        }
        viewRef.current = view;
        // Expose for HUD “select Sim → snap camera”
        (window as unknown as { __lifesimView?: WorldView }).__lifesimView = view;
        setMounted(true);
        setRenderError(null);
        getObs().logger.info('render', 'WorldView mounted');
        // Initial lock on selected / first Sim
        const w = useGameStore.getState().world;
        if (w) view.snapToEntity(w, w.ui.selectedSimId);
        reproject();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setRenderError(msg);
        getObs().logger.error('render', 'WorldView mount failed', { error: msg });
        try {
          view.destroy();
        } catch {
          /* ignore */
        }
      } finally {
        mountingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      mountingRef.current = false;
      setMounted(false);
      const v = viewRef.current;
      viewRef.current = null;
      const win = window as unknown as { __lifesimView?: WorldView };
      if (win.__lifesimView === v) delete win.__lifesimView;
      try {
        v?.destroy();
      } catch {
        /* ignore */
      }
      // Only clear host if still our canvas
      while (host.firstChild) {
        try {
          host.removeChild(host.firstChild);
        } catch {
          break;
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount only on worldEpoch
  }, [worldEpoch]);

  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    let last = performance.now();
    let alive = true;
    let errorStreak = 0;

    const loop = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      try {
        frame(dt);
        const w = useGameStore.getState().world;
        const view = viewRef.current;
        if (w && view) {
          const rt0 = performance.now();
          view.render(w);
          getObs().metrics.observe('render.ms', performance.now() - rt0);
        }
        errorStreak = 0;
      } catch (e) {
        errorStreak++;
        console.error('frame error', e);
        getObs().logger.error('render', 'frame error', {
          error: e instanceof Error ? e.message : String(e),
          streak: errorStreak,
        });
        // Soft-recover: skip a few frames rather than death spiral
        if (errorStreak > 30) {
          setRenderError(
            e instanceof Error ? e.message : 'Render loop failed repeatedly',
          );
          alive = false;
          return;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [frame, mounted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      try {
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
        const view = viewRef.current;
        if (view) {
          const step = 40;
          if (e.key === 'w' || e.key === 'W') view.camera.y += step;
          if (e.key === 's' || e.key === 'S') view.camera.y -= step;
          if (e.key === 'a' || e.key === 'A') view.camera.x += step;
          if (e.key === 'd' || e.key === 'D') view.camera.x -= step;
        }
        if (['1', '2', '3', '0', ' '].includes(e.key)) reproject();
      } catch {
        /* ignore key handler errors */
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reproject]);

  if (!world || !commands) {
    return (
      <div style={{ padding: 24, color: '#f87171' }}>
        No world loaded.
        <button type="button" onClick={() => useGameStore.setState({ screen: 'menu' })}>
          Menu
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">LifeSim</div>
        <div className="spacer" />
        <span style={{ color: '#94a3b8', fontSize: 13 }}>
          {selectedBuyDef ? `Buy: ${selectedBuyDef}` : `Build: ${buildKind}`}
        </span>
        <button type="button" onClick={() => useGameStore.getState().saveGame('slot1')}>
          Save
        </button>
        <button
          type="button"
          onClick={() =>
            useGameStore.setState({ screen: 'menu', world: null, commands: null })
          }
        >
          Menu
        </button>
      </div>
      <div className="main-stage">
        <div className="canvas-host" ref={hostRef} />
        {renderError && (
          <div
            style={{
              position: 'absolute',
              inset: 12,
              zIndex: 50,
              background: '#450a0a',
              color: '#fecaca',
              padding: 16,
              borderRadius: 12,
            }}
          >
            <strong>Renderer issue</strong>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{renderError}</pre>
            <p>HUD should still work. Try Menu → Quick Start again.</p>
          </div>
        )}
        <Hud />
      </div>
    </div>
  );
}
