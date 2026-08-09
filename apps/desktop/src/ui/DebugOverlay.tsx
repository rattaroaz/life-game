import { useEffect, useState } from 'react';
import {
  getObs,
  type LogLevel,
  type ObservabilitySnapshot,
} from '@lifesim/sim';

/**
 * F3 toggles this overlay. Provides live FPS, sim budgets, system timings,
 * counters, recent logs/events, and export of the diagnostic ring buffers.
 */
export function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'perf' | 'logs' | 'events' | 'metrics'>('perf');
  const [snap, setSnap] = useState<ObservabilitySnapshot | null>(null);
  const [level, setLevel] = useState<LogLevel>('debug');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'F4' && open) {
        e.preventDefault();
        downloadExport();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const unsub = getObs().subscribe((s) => setSnap(s));
    setSnap(getObs().snapshot());
    const id = window.setInterval(() => {
      getObs().publish();
    }, 200);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, [open]);

  if (!open || !snap) {
    return (
      <div className="obs-hint" title="Toggle observability overlay">
        F3 debug
      </div>
    );
  }

  const sysEntries = Object.entries(snap.sim.systems).sort(
    (a, b) => (b[1].avg || 0) - (a[1].avg || 0),
  );

  return (
    <div className="obs-overlay">
      <div className="obs-header">
        <strong>Observability</strong>
        <span className="obs-muted">
          {snap.sessionId.slice(0, 16)}… · up {formatMs(snap.uptimeMs)}
        </span>
        <div className="obs-tabs">
          {(['perf', 'logs', 'events', 'metrics'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'active' : ''}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => downloadExport()}>
          Export F4
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {tab === 'perf' && (
        <div className="obs-body">
          <div className="obs-grid">
            <Stat label="FPS" value={snap.frame.fps.toFixed(1)} ok={snap.frame.fps >= 50} />
            <Stat label="Frame ms" value={snap.frame.frameMs.toFixed(2)} ok={snap.frame.frameMs < 20} />
            <Stat label="Sim tick ms" value={snap.sim.lastTickMs.toFixed(2)} ok={snap.sim.lastTickMs < 4} />
            <Stat label="Sim p95" value={snap.sim.p95TickMs.toFixed(2)} ok={snap.sim.p95TickMs < 6} />
            <Stat label="Render ms" value={snap.frame.renderMs.toFixed(2)} />
            <Stat label="Ticks/frame" value={String(snap.frame.simTicksThisFrame)} />
            <Stat label="Sims" value={String(snap.sim.entityCounts.sims)} />
            <Stat label="Objects" value={String(snap.sim.entityCounts.objects)} />
          </div>

          <div className="obs-section">Counters</div>
          <div className="obs-line">
            path ok/fail {snap.sim.pathSuccess}/{snap.sim.pathFails} · action ok/fail{' '}
            {snap.sim.actionsSucceeded}/{snap.sim.actionsFailed} · autonomy picks{' '}
            {snap.sim.autonomyPicks} · tick #{snap.sim.tick}
          </div>

          <div className="obs-section">Systems (avg ms)</div>
          <table className="obs-table">
            <thead>
              <tr>
                <th>System</th>
                <th>avg</th>
                <th>p95</th>
                <th>max</th>
                <th>n</th>
              </tr>
            </thead>
            <tbody>
              {sysEntries.map(([name, h]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className={h.avg > 1 ? 'obs-warn' : ''}>{h.avg.toFixed(3)}</td>
                  <td>{h.p95.toFixed(3)}</td>
                  <td>{h.max.toFixed(3)}</td>
                  <td>{h.count}</td>
                </tr>
              ))}
              {sysEntries.length === 0 && (
                <tr>
                  <td colSpan={5} className="obs-muted">
                    Run live simulation to collect system timings
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="obs-section">Log level</div>
          <select
            value={level}
            onChange={(e) => {
              const v = e.target.value as LogLevel;
              setLevel(v);
              getObs().setMinLevel(v);
            }}
          >
            {(['trace', 'debug', 'info', 'warn', 'error'] as LogLevel[]).map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="button"
            style={{ marginLeft: 8 }}
            onClick={() => getObs().resetSessionCounters()}
          >
            Reset counters
          </button>
        </div>
      )}

      {tab === 'logs' && (
        <div className="obs-body obs-scroll">
          {snap.recentLogs.map((l, i) => (
            <div key={`${l.ts}-${i}`} className={`obs-log obs-${l.level}`}>
              <span className="obs-muted">{formatTime(l.wallMs)}</span>{' '}
              <span className="obs-level">[{l.level}]</span>{' '}
              <span className="obs-cat">[{l.category}]</span> {l.message}
              {l.fields && (
                <span className="obs-muted"> {compactFields(l.fields)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'events' && (
        <div className="obs-body obs-scroll">
          {snap.recentEvents.map((ev, i) => (
            <div key={`${ev.ts}-${i}`} className="obs-log">
              <span className="obs-muted">{formatTime(ev.wallMs)}</span>{' '}
              <strong>{ev.type}</strong> <span className="obs-cat">[{ev.category}]</span>
              {ev.payload && (
                <span className="obs-muted"> {compactFields(ev.payload)}</span>
              )}
            </div>
          ))}
          {snap.recentEvents.length === 0 && (
            <div className="obs-muted">No telemetry events yet</div>
          )}
        </div>
      )}

      {tab === 'metrics' && (
        <div className="obs-body obs-scroll">
          <table className="obs-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Value</th>
                <th>Labels</th>
              </tr>
            </thead>
            <tbody>
              {snap.metrics.map((m, i) => (
                <tr key={`${m.name}-${i}`}>
                  <td>{m.name}</td>
                  <td>{m.kind}</td>
                  <td>
                    {m.kind === 'histogram' && m.histogram
                      ? `avg ${m.histogram.avg.toFixed(3)} (n=${m.histogram.count})`
                      : m.value.toFixed(3)}
                  </td>
                  <td className="obs-muted">
                    {m.labels
                      ? Object.entries(m.labels)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(' ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <div className={`obs-stat ${ok === false ? 'obs-bad' : ok ? 'obs-good' : ''}`}>
      <div className="obs-stat-label">{label}</div>
      <div className="obs-stat-value">{value}</div>
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${s}s`;
}

function formatTime(wallMs: number): string {
  const d = new Date(wallMs);
  return d.toLocaleTimeString();
}

function compactFields(f: Record<string, unknown>): string {
  try {
    return JSON.stringify(f);
  } catch {
    return '';
  }
}

function downloadExport(): void {
  const json = getObs().exportJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lifesim-obs-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  getObs().logger.info('ui', 'Exported observability dump');
}
