import { allObjects } from '@lifesim/sim';
import { useGameStore } from '../game/store';

const NEED_COLORS: Record<string, string> = {
  hunger: '#f97316',
  energy: '#3b82f6',
  bladder: '#eab308',
  hygiene: '#06b6d4',
  fun: '#a855f7',
  social: '#ec4899',
};

export function Hud() {
  const hud = useGameStore((s) => s.hud);
  const commands = useGameStore((s) => s.commands);
  const content = useGameStore((s) => s.content);
  const world = useGameStore((s) => s.world);
  const toasts = useGameStore((s) => s.toasts);
  const selectedBuyDef = useGameStore((s) => s.selectedBuyDef);
  const setSelectedBuyDef = useGameStore((s) => s.setSelectedBuyDef);
  const buildKind = useGameStore((s) => s.buildKind);
  const setBuildKind = useGameStore((s) => s.setBuildKind);
  const reproject = useGameStore((s) => s.reproject);

  if (!hud || !commands) return null;

  // All placeable interactable objects for the lot (clickable via list too)
  const placeId = hud.placeId ?? world?.neighborhood?.activePlaceId;
  const interactables =
    world && hud.mode === 'live'
      ? allObjects(world)
          .filter((o) => !o.placeId || o.placeId === placeId)
          .map((o) => {
            const def = content.objects.find((d) => d.id === o.defId);
            if (!def || def.interactions.length === 0) return null;
            return { id: o.id, name: def.nameKey, defId: o.defId, count: def.interactions.length };
          })
          .filter(Boolean) as { id: number; name: string; defId: string; count: number }[]
      : [];

  const needBar = (label: string, value: number) => (
    <div className="need-row" key={label}>
      <span>{label}</span>
      <div className="need-bar">
        <i
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            background: NEED_COLORS[label] ?? '#94a3b8',
          }}
        />
      </div>
      <span>{Math.round(value)}</span>
    </div>
  );

  return (
    <>
      <div className="mode-bar">
        {(['live', 'build', 'buy'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={hud.mode === m ? 'active' : ''}
            onClick={() => {
              commands.setMode(m);
              if (m === 'live') commands.setPaused(false);
              reproject();
            }}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="hud-left">
        <div className="section-title" style={{ marginTop: 0 }}>
          {hud.clockLabel}{' '}
          <span style={{ color: '#94a3b8', fontWeight: 400 }}>
            Day {hud.dayNumber + 1} / {hud.weather}
          </span>
        </div>
        <div style={{ marginTop: 6, color: '#4ade80' }}>
          ${' '}
          {hud.funds.toLocaleString()}
        </div>
        <div style={{ marginTop: 4, fontSize: 13, color: '#5eead4' }}>
          {'@ '}
          {hud.placeName ? hud.placeName : 'Home'}
        </div>

        <div className="section-title">
          City map{' '}
          <span style={{ fontWeight: 400, color: '#64748b', fontSize: 11 }}>
            ({(hud.places ?? []).length} places)
          </span>
        </div>
        <div className="interaction-list" style={{ maxHeight: 220, overflow: 'auto' }}>
          {(hud.places ?? [])
            .slice()
            .sort((a, b) => {
              const order = (k: string) =>
                k === 'home' || k === 'residential'
                  ? 0
                  : k === 'street' || k === 'plaza' || k === 'park'
                    ? 1
                    : 2;
              const d = order(a.kind) - order(b.kind);
              return d !== 0 ? d : a.name.localeCompare(b.name);
            })
            .map((p) => (
            <button
              key={p.id}
              type="button"
              className={hud.placeId === p.id ? 'active' : ''}
              title={p.description}
              onClick={() => {
                // View place + send selected Sim there
                commands.viewPlace(p.id);
                if (hud.selectedSim) {
                  commands.travelTo(p.id, hud.selectedSim.id);
                }
                const w = useGameStore.getState().world;
                const view = (
                  window as unknown as {
                    __lifesimView?: {
                      snapToEntity: (w: unknown, id: number | null) => void;
                      forceSnap?: boolean;
                    };
                  }
                ).__lifesimView;
                if (w && view) {
                  view.snapToEntity(w, w.ui.selectedSimId);
                }
                reproject();
              }}
            >
              {p.name}
              <span style={{ color: '#64748b', marginLeft: 6, fontSize: 10 }}>{p.kind}</span>
            </button>
          ))}
        </div>

        <div className="section-title">Household</div>
        <div className="sim-strip">
          {hud.householdSims.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`sim-chip ${hud.selectedSim?.id === s.id ? 'selected' : ''}`}
              onClick={() => {
                commands.selectSim(s.id);
                // View their place + snap camera
                if (s.placeId) commands.viewPlace(s.placeId);
                const w = useGameStore.getState().world;
                const view = (
                  window as unknown as {
                    __lifesimView?: { snapToEntity: (w: unknown, id: number) => void };
                  }
                ).__lifesimView;
                if (w && view) view.snapToEntity(w, s.id);
                reproject();
              }}
            >
              <span
                className="dot"
                style={{
                  background:
                    s.mood > 60 ? '#4ade80' : s.mood > 35 ? '#facc15' : '#f87171',
                }}
              />
              <div style={{ flex: 1 }}>
                <div>{s.name}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  {s.presence === 'at_work'
                    ? 'At work'
                    : `${(s as { placeName?: string }).placeName ?? ''} · Mood ${Math.round(s.mood)}`}
                </div>
              </div>
            </button>
          ))}
        </div>

        {hud.selectedSim && (
          <>
            <div className="section-title">Needs — {hud.selectedSim.name}</div>
            {Object.entries(hud.selectedSim.needs).map(([k, v]) => needBar(k, v))}

            <div className="section-title">Skills</div>
            <div style={{ fontSize: 12, color: '#cbd5e1' }}>
              {Object.entries(hud.selectedSim.skills).map(([k, v]) => (
                <div key={k}>
                  {k}: {v.toFixed(1)}
                </div>
              ))}
            </div>

            <div className="section-title">Career</div>
            {hud.selectedSim.career.trackId ? (
              <div style={{ fontSize: 12 }}>
                {content.careers.find((c) => c.id === hud.selectedSim!.career.trackId)?.nameKey}
                {' · L'}
                {hud.selectedSim.career.level + 1}
                {' · perf '}
                {Math.round(hud.selectedSim.career.performance)}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {content.careers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      commands.joinCareer(hud.selectedSim!.id, c.id);
                      reproject();
                    }}
                  >
                    Join {c.nameKey}
                  </button>
                ))}
              </div>
            )}

            <div className="section-title">Queue / Action</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              {hud.selectedSim.action.kind}
              {hud.selectedSim.queue.length > 0 &&
                ` · queued: ${hud.selectedSim.queue.map((q) => q.interactionId.split('.').pop()).join(', ')}`}
            </div>
            <button
              type="button"
              style={{ marginTop: 6, width: '100%' }}
              onClick={() => {
                commands.cancelAction(hud.selectedSim!.id);
                reproject();
              }}
            >
              Cancel action
            </button>
          </>
        )}
      </div>

      <div className="hud-right">
        {hud.mode === 'buy' && (
          <>
            <div className="section-title">Buy catalog</div>
            <div className="catalog-grid">
              {content.objects
                .filter((o) => !o.id.startsWith('object.decor_') || Number(o.id.split('_')[1]) <= 8)
                .map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`catalog-item ${selectedBuyDef === o.id ? 'active' : ''}`}
                    onClick={() => setSelectedBuyDef(o.id)}
                  >
                    <div>{o.nameKey}</div>
                    <div className="price">${o.price}</div>
                  </button>
                ))}
            </div>
            <p className="help-hint">Select an item, then click the lot to place. Funds deducted on place.</p>
          </>
        )}

        {hud.mode === 'build' && (
          <>
            <div className="section-title">Build tools</div>
            {(['wall', 'door', 'window', 'erase'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={buildKind === k ? 'active' : ''}
                style={{ width: '100%', marginBottom: 4 }}
                onClick={() => setBuildKind(k)}
              >
                {k}
              </button>
            ))}
            <p className="help-hint">Click tiles to place horizontal wall edges / doors / windows. Nav rebuilds automatically.</p>
          </>
        )}

        {hud.mode === 'live' && (
          <>
            {hud.target ? (
              <>
                <div className="section-title">
                  {hud.target.kind === 'object' ? 'Object' : 'Sim'} — {hud.target.label}
                </div>
                <div className="interaction-list">
                  {hud.target.availableInteractions.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      disabled={!it.enabled || !hud.selectedSim}
                      onClick={() => {
                        if (!hud.selectedSim) return;
                        commands.enqueueInteraction(
                          hud.selectedSim.id,
                          it.id,
                          hud.target!.id,
                        );
                        reproject();
                      }}
                    >
                      {it.labelKey}
                      {it.failReasonKey ? ` (${it.failReasonKey})` : ''}
                    </button>
                  ))}
                </div>
                {hud.target.availableInteractions.length === 0 && (
                  <p className="help-hint">No interactions on this target.</p>
                )}
                <button
                  type="button"
                  style={{ width: '100%', marginTop: 8 }}
                  onClick={() => {
                    commands.setWorldTarget(null);
                    reproject();
                  }}
                >
                  Clear target
                </button>
              </>
            ) : (
              <p className="help-hint">
                Single-click: select. Double-click ground/object: walk there.
                Pick objects below for actions.
              </p>
            )}

            <div className="section-title">Objects on lot</div>
            <div className="interaction-list" style={{ maxHeight: 220, overflow: 'auto' }}>
              {interactables.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={hud.target?.id === o.id ? 'active' : ''}
                  onClick={() => {
                    commands.setWorldTarget(o.id);
                    reproject();
                  }}
                >
                  {o.name}
                  <span style={{ color: '#94a3b8', marginLeft: 6 }}>({o.count})</span>
                </button>
              ))}
              {interactables.length === 0 && (
                <p className="help-hint">No interactable objects placed.</p>
              )}
            </div>
          </>
        )}
      </div>

      <div className="hud-bottom">
        <button type="button" onClick={() => { commands.setSpeed(0); reproject(); }}>
          ⏸
        </button>
        <button
          type="button"
          className={hud.speed === 1 ? 'active' : ''}
          onClick={() => { commands.setSpeed(1); reproject(); }}
        >
          1×
        </button>
        <button
          type="button"
          className={hud.speed === 2 ? 'active' : ''}
          onClick={() => { commands.setSpeed(2); reproject(); }}
        >
          2×
        </button>
        <button
          type="button"
          className={hud.speed === 3 ? 'active' : ''}
          onClick={() => { commands.setSpeed(3); reproject(); }}
        >
          3×
        </button>
        <span style={{ color: '#94a3b8', fontSize: 12, marginLeft: 8 }}>
          Space pause · 1/2/3 speed · WASD pan · wheel zoom
        </span>
      </div>

      <div className="toast-stack">
        {toasts.map((t, i) => (
          <div className="toast" key={`${t}-${i}`}>
            {t}
          </div>
        ))}
      </div>
    </>
  );
}
