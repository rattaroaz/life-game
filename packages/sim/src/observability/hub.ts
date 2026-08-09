import { Logger } from './logger.js';
import { MetricsRegistry } from './metrics.js';
import { RingBuffer } from './ringBuffer.js';
import { Tracer } from './tracer.js';
import type {
  FramePerfSample,
  LogFields,
  LogLevel,
  ObsCategory,
  ObservabilityConfig,
  ObservabilitySnapshot,
  SimPerfSnapshot,
  TelemetryEvent,
} from './types.js';

function nowPerf(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function newSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULT_CONFIG: ObservabilityConfig = {
  minLevel: 'debug',
  logBufferSize: 500,
  eventBufferSize: 300,
  spanBufferSize: 200,
  console: true,
  systemTiming: true,
  traceSampleRate: 0.25,
  persistSession: false,
};

export class ObservabilityHub {
  readonly sessionId: string;
  readonly startedAt: number;
  private config: ObservabilityConfig;
  readonly logger: Logger;
  readonly metrics: MetricsRegistry;
  readonly tracer: Tracer;
  readonly events: RingBuffer<TelemetryEvent>;
  private frame: FramePerfSample = {
    fps: 0,
    frameMs: 0,
    simTickMs: 0,
    simTicksThisFrame: 0,
    renderMs: 0,
    projectMs: 0,
  };
  private fpsEma = 60;
  private warnings: string[] = [];
  private listeners = new Set<(snap: ObservabilitySnapshot) => void>();
  private lastSnapshotMs = 0;

  // Rolling sim counters (session)
  private pathFails = 0;
  private pathSuccess = 0;
  private actionsFailed = 0;
  private actionsSucceeded = 0;
  private autonomyPicks = 0;
  private lastSystemTimings: Record<string, number> = {};
  private lastTickMs = 0;
  private simTick = 0;

  constructor(config?: Partial<ObservabilityConfig>) {
    this.sessionId = newSessionId();
    this.startedAt = Date.now();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = new Logger(this.sessionId, () => this.config, this.config.logBufferSize);
    this.metrics = new MetricsRegistry();
    this.tracer = new Tracer(this.config.spanBufferSize);
    this.events = new RingBuffer(this.config.eventBufferSize);

    // Seed standard metrics
    this.metrics.counter('sim.ticks');
    this.metrics.counter('sim.path.fail');
    this.metrics.counter('sim.path.ok');
    this.metrics.counter('sim.action.fail');
    this.metrics.counter('sim.action.ok');
    this.metrics.counter('sim.autonomy.pick');
    this.metrics.histogram('sim.tick.ms');
    this.metrics.histogram('frame.ms');
    this.metrics.histogram('render.ms');
    this.metrics.gauge('entities.sims');
    this.metrics.gauge('entities.objects');
    this.metrics.gauge('frame.fps');

    this.logger.info('boot', 'Observability hub started', {
      sessionId: this.sessionId,
      minLevel: this.config.minLevel,
    });
  }

  getConfig(): ObservabilityConfig {
    return { ...this.config };
  }

  configure(patch: Partial<ObservabilityConfig>): void {
    this.config = { ...this.config, ...patch };
    this.logger.info('boot', 'Observability config updated', patch as LogFields);
  }

  setMinLevel(level: LogLevel): void {
    this.configure({ minLevel: level });
  }

  // ---- Logging shortcuts ----
  log(level: LogLevel, category: ObsCategory, message: string, fields?: LogFields): void {
    this.logger.log(level, category, message, fields);
  }

  // ---- Telemetry events (game semantics) ----
  event(type: string, category: ObsCategory, payload?: LogFields): void {
    const ev: TelemetryEvent = {
      ts: nowPerf(),
      wallMs: Date.now(),
      type,
      category,
      payload,
      sessionId: this.sessionId,
    };
    this.events.push(ev);
    this.logger.debug(category, `event:${type}`, payload);
  }

  // ---- Frame / render instrumentation ----
  recordFrame(sample: Partial<FramePerfSample> & { frameMs: number }): void {
    const fpsInst = sample.frameMs > 0 ? 1000 / sample.frameMs : 0;
    this.fpsEma = this.fpsEma * 0.9 + fpsInst * 0.1;
    this.frame = {
      fps: this.fpsEma,
      frameMs: sample.frameMs,
      simTickMs: sample.simTickMs ?? this.frame.simTickMs,
      simTicksThisFrame: sample.simTicksThisFrame ?? 0,
      renderMs: sample.renderMs ?? this.frame.renderMs,
      projectMs: sample.projectMs ?? this.frame.projectMs,
    };
    this.metrics.observe('frame.ms', sample.frameMs);
    this.metrics.set('frame.fps', this.fpsEma);
    if (sample.renderMs != null) this.metrics.observe('render.ms', sample.renderMs);
    if (sample.simTickMs != null && sample.simTicksThisFrame) {
      this.metrics.observe('sim.frame_sim_ms', sample.simTickMs);
    }
  }

  // ---- Sim tick instrumentation ----
  beginSimTick(tick: number): string {
    this.simTick = tick;
    this.lastSystemTimings = {};
    return this.tracer.start('sim.tick', 'sim', { tick });
  }

  recordSystemTime(systemName: string, durationMs: number): void {
    this.lastSystemTimings[systemName] = durationMs;
    if (this.config.systemTiming) {
      this.metrics.observe('sim.system.ms', durationMs, { system: systemName });
    }
  }

  endSimTick(spanId: string, entityCounts: SimPerfSnapshot['entityCounts']): void {
    const ms = this.tracer.end(spanId, 'ok');
    this.lastTickMs = ms;
    this.metrics.observe('sim.tick.ms', ms);
    this.metrics.inc('sim.ticks');
    this.metrics.set('entities.sims', entityCounts.sims);
    this.metrics.set('entities.objects', entityCounts.objects);
    this.metrics.set('entities.relationships', entityCounts.relationships);
  }

  notePathResult(ok: boolean, fields?: LogFields): void {
    if (ok) {
      this.pathSuccess += 1;
      this.metrics.inc('sim.path.ok');
    } else {
      this.pathFails += 1;
      this.metrics.inc('sim.path.fail');
      this.logger.debug('path', 'path failed', fields);
    }
  }

  noteActionResult(ok: boolean, fields?: LogFields): void {
    if (ok) {
      this.actionsSucceeded += 1;
      this.metrics.inc('sim.action.ok');
    } else {
      this.actionsFailed += 1;
      this.metrics.inc('sim.action.fail');
      this.logger.debug('action', 'action failed', fields);
    }
  }

  noteAutonomyPick(fields?: LogFields): void {
    this.autonomyPicks += 1;
    this.metrics.inc('sim.autonomy.pick');
    // reason may be present; keep fields flexible
    this.logger.trace('ai', 'autonomy pick', fields);
  }

  warnOnce(key: string, message: string, category: ObsCategory = 'general'): void {
    if (this.warnings.includes(key)) return;
    this.warnings.push(key);
    if (this.warnings.length > 50) this.warnings.shift();
    this.logger.warn(category, message, { key });
  }

  // ---- Snapshot / export ----
  snapshot(): ObservabilitySnapshot {
    const tickHist = this.metrics.histogram('sim.tick.ms').snapshot();
    const systems: SimPerfSnapshot['systems'] = {};
    for (const [name, ms] of Object.entries(this.lastSystemTimings)) {
      systems[name] = this.metrics.histogram('sim.system.ms', { system: name }).snapshot();
      // also expose last value via avg of hist — fine
      void ms;
    }

    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      uptimeMs: Date.now() - this.startedAt,
      config: this.getConfig(),
      frame: { ...this.frame },
      sim: {
        lastTickMs: this.lastTickMs,
        avgTickMs: tickHist.avg,
        p95TickMs: tickHist.p95,
        systems,
        entityCounts: {
          sims: this.metrics.gauge('entities.sims').value,
          objects: this.metrics.gauge('entities.objects').value,
          relationships: this.metrics.gauge('entities.relationships').value,
        },
        pathFails: this.pathFails,
        pathSuccess: this.pathSuccess,
        actionsFailed: this.actionsFailed,
        actionsSucceeded: this.actionsSucceeded,
        autonomyPicks: this.autonomyPicks,
        tick: this.simTick,
      },
      metrics: this.metrics.snapshot(),
      recentLogs: this.logger.buffer.recent(40),
      recentEvents: this.events.recent(30),
      recentSpans: this.tracer.completed.recent(20),
      warnings: [...this.warnings],
    };
  }

  /** Notify UI subscribers at most ~10 Hz */
  publish(): ObservabilitySnapshot {
    const snap = this.snapshot();
    const t = nowPerf();
    if (t - this.lastSnapshotMs < 100 && this.listeners.size > 0) {
      // still notify but throttle heavy UI if needed — always notify for F3
    }
    this.lastSnapshotMs = t;
    for (const fn of this.listeners) {
      try {
        fn(snap);
      } catch {
        /* ignore */
      }
    }
    return snap;
  }

  subscribe(fn: (snap: ObservabilitySnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  exportJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        snapshot: this.snapshot(),
        logs: this.logger.buffer.toArray(),
        events: this.events.toArray(),
        spans: this.tracer.completed.toArray(),
      },
      null,
      2,
    );
  }

  resetSessionCounters(): void {
    this.pathFails = 0;
    this.pathSuccess = 0;
    this.actionsFailed = 0;
    this.actionsSucceeded = 0;
    this.autonomyPicks = 0;
    this.metrics.resetAll();
    this.logger.info('boot', 'Session counters reset');
  }
}

/** Process-wide hub (browser + node tests). */
let globalHub: ObservabilityHub | null = null;

export function getObs(): ObservabilityHub {
  if (!globalHub) globalHub = new ObservabilityHub();
  return globalHub;
}

export function initObs(config?: Partial<ObservabilityConfig>): ObservabilityHub {
  globalHub = new ObservabilityHub(config);
  return globalHub;
}

export function resetObsForTests(): void {
  globalHub = null;
}
