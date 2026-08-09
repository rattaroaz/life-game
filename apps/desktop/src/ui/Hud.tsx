import { useState } from 'react';
import { allObjects } from '@lifesim/sim';
import type { WorldView } from '@lifesim/render';
import { runPlayerAction } from '../game/playerAction';
import { useGameStore } from '../game/store';
import { ActivityWindow } from './ActivityWindow';

function getWorldView(): WorldView | undefined {
  return (window as unknown as { __lifesimView?: WorldView }).__lifesimView;
}

const OBJECTS_COLLAPSED_KEY = 'lifesim.objectsOnLotCollapsed';

function loadObjectsCollapsed(): boolean {
  try {
    return localStorage.getItem(OBJECTS_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

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
  const dismissToast = useGameStore((s) => s.dismissToast);
  const selectedBuyDef = useGameStore((s) => s.selectedBuyDef);
  const setSelectedBuyDef = useGameStore((s) => s.setSelectedBuyDef);
  const buildKind = useGameStore((s) => s.buildKind);
  const setBuildKind = useGameStore((s) => s.setBuildKind);
  const reproject = useGameStore((s) => s.reproject);
  const [objectsCollapsed, setObjectsCollapsed] = useState(loadObjectsCollapsed);

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

  const queueLabels = (hud.selectedSim?.queue ?? []).map((q) => {
    if (q.interactionId === '__walk__') return 'Walk';
    if (q.interactionId.startsWith('__travel__:')) return 'Travel';
    return (
      content.interactions.find((i) => i.id === q.interactionId)?.nameKey ??
      q.interactionId.split('.').pop()?.replace(/_/g, ' ') ??
      q.interactionId
    );
  });

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

      {hud.selectedSim && (
        <ActivityWindow
          name={hud.selectedSim.name}
          label={hud.selectedSim.activityLabel}
          detail={hud.selectedSim.activityDetail}
          phase={hud.selectedSim.activityPhase}
          onNameClick={() => {
            const sim = hud.selectedSim;
            if (!sim) return;
            commands.selectSim(sim.id);
            if (sim.placeId) commands.viewPlace(sim.placeId);
            const w = useGameStore.getState().world;
            const view = getWorldView();
            if (w && view) view.snapToEntity(w, sim.id);
            reproject();
          }}
        />
      )}

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
              title={p.description || `View ${p.name}`}
              onClick={() => {
                const go = () => {
                  commands.viewPlace(p.id);
                  if (hud.selectedSim) {
                    commands.travelTo(p.id, hud.selectedSim.id);
                  }
                  const w = useGameStore.getState().world;
                  const view = getWorldView();
                  if (w && view) view.snapToPlace(w, p.id);
                  reproject();
                };
                if (hud.selectedSim) {
                  void runPlayerAction(hud.selectedSim.id, go);
                } else {
                  go();
                }
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
              title={`Focus on ${s.name}`}
              onClick={() => {
                // Click name/chip → select Sim and jump camera back to them
                commands.selectSim(s.id);
                if (s.placeId) commands.viewPlace(s.placeId);
                const w = useGameStore.getState().world;
                const view = getWorldView();
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
                <div className="sim-chip-name">{s.name}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  {s.presence === 'at_work'
                    ? 'At work'
                    : `${s.placeName ?? ''} · Mood ${Math.round(s.mood)}`}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="section-title">
          People{' '}
          <span style={{ fontWeight: 400, color: '#64748b', fontSize: 11 }}>
            (talk)
          </span>
        </div>
        <div className="people-list">
          {(hud.people ?? []).length === 0 && (
            <p className="help-hint" style={{ marginTop: 0 }}>
              No one else around yet — visit the cafe, park, or neighbors.
            </p>
          )}
          {(hud.people ?? []).map((p) => (
            <div key={p.id} className={`person-row ${p.here ? 'here' : ''}`}>
              <button
                type="button"
                className="person-info"
                title={p.bio ?? p.name}
                onClick={() => {
                  commands.setWorldTarget(p.id);
                  commands.viewPlace(p.placeId);
                  const w = useGameStore.getState().world;
                  const view = getWorldView();
                  if (w && view) view.snapToEntity(w, p.id);
                  reproject();
                }}
              >
                <div className="person-name">
                  {p.name}
                  {p.role === 'npc' && <span className="person-tag">NPC</span>}
                </div>
                <div className="person-meta">
                  {p.here ? 'Here' : p.placeName}
                  {p.met ? ` · Friend ${Math.round(p.friendship)}` : ' · strangers'}
                </div>
              </button>
              <button
                type="button"
                className="person-talk"
                disabled={!hud.selectedSim}
                title={
                  hud.selectedSim
                    ? `Talk with ${p.name}`
                    : 'Select a household Sim first'
                }
                onClick={() => {
                  if (!hud.selectedSim) return;
                  const simId = hud.selectedSim.id;
                  void runPlayerAction(simId, () => {
                    commands.talkTo(p.id, simId);
                    const w = useGameStore.getState().world;
                    const view = getWorldView();
                    if (w && view) view.snapToEntity(w, simId);
                    reproject();
                  });
                }}
              >
                Talk
              </button>
            </div>
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

            <div className="section-title">Queue</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              {queueLabels.length > 0 ? queueLabels.join(' → ') : 'Nothing queued'}
            </div>
            <button
              type="button"
              style={{ marginTop: 6, width: '100%' }}
              onClick={() => {
                const simId = hud.selectedSim!.id;
                void runPlayerAction(simId, () => {
                  commands.cancelAction(simId);
                  reproject();
                });
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
                  {hud.target.kind === 'object'
                    ? 'Object'
                    : hud.target.role === 'npc'
                      ? 'NPC'
                      : 'Sim'}{' '}
                  — {hud.target.label}
                </div>
                {hud.target.kind === 'sim' && (
                  <div className="npc-card">
                    {hud.target.bio && <p className="npc-bio">{hud.target.bio}</p>}
                    {hud.target.traits && hud.target.traits.length > 0 && (
                      <div className="npc-meta">
                        Traits: {hud.target.traits.join(', ')}
                      </div>
                    )}
                    {hud.target.aspirationLabel && (
                      <div className="npc-meta">Wants: {hud.target.aspirationLabel}</div>
                    )}
                    {hud.target.relationship && (
                      <div className="npc-rel">
                        <div>
                          Friendship {Math.round(hud.target.relationship.friendship)}
                          {!hud.target.relationship.met && ' · strangers'}
                        </div>
                        <div>Romance {Math.round(hud.target.relationship.romance)}</div>
                      </div>
                    )}
                  </div>
                )}
                <div className="interaction-list">
                  {hud.target.availableInteractions.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      disabled={!it.enabled || !hud.selectedSim}
                      onClick={() => {
                        if (!hud.selectedSim) return;
                        const simId = hud.selectedSim.id;
                        const targetId = hud.target!.id;
                        const interactionId = it.id;
                        void runPlayerAction(simId, () => {
                          commands.enqueueInteraction(simId, interactionId, targetId);
                          reproject();
                        });
                      }}
                    >
                      {it.labelKey}
                      {it.failReasonKey === 'need_friendship'
                        ? ' (need friendship 20)'
                        : it.failReasonKey
                          ? ` (${it.failReasonKey})`
                          : ''}
                    </button>
                  ))}
                </div>
                {hud.target.kind === 'sim' && hud.selectedSim && (
                  <button
                    type="button"
                    className="talk-primary"
                    style={{ width: '100%', marginTop: 6 }}
                    onClick={() => {
                      const simId = hud.selectedSim!.id;
                      const targetId = hud.target!.id;
                      void runPlayerAction(simId, () => {
                        commands.talkTo(targetId, simId);
                        reproject();
                      });
                    }}
                  >
                    Talk with {hud.target.label.split(' ')[0]}
                  </button>
                )}
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
                Click an NPC (or use People → Talk) to converse. Double-click ground to walk.
              </p>
            )}

            <button
              type="button"
              className="section-toggle"
              aria-expanded={!objectsCollapsed}
              onClick={() => {
                setObjectsCollapsed((c) => {
                  const next = !c;
                  try {
                    localStorage.setItem(OBJECTS_COLLAPSED_KEY, next ? '1' : '0');
                  } catch {
                    /* ignore */
                  }
                  return next;
                });
              }}
            >
              <span className="section-title" style={{ margin: 0 }}>
                Objects on lot
                <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 6 }}>
                  ({interactables.length})
                </span>
              </span>
              <span className="section-toggle-chevron" aria-hidden>
                {objectsCollapsed ? '▸' : '▾'}
              </span>
            </button>
            {!objectsCollapsed && (
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
            )}
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
        {toasts.map((t) => (
          <button
            type="button"
            className="toast"
            key={t.id}
            title="Click to dismiss"
            onClick={() => dismissToast(t.id)}
          >
            {t.message}
          </button>
        ))}
      </div>
    </>
  );
}
