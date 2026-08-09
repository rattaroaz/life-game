/** Observability type contracts for LifeSim */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

/** Logical domains for filtering */
export type ObsCategory =
  | 'boot'
  | 'sim'
  | 'system'
  | 'ai'
  | 'path'
  | 'action'
  | 'social'
  | 'career'
  | 'build'
  | 'buy'
  | 'save'
  | 'render'
  | 'ui'
  | 'input'
  | 'content'
  | 'perf'
  | 'net'
  | 'general';

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export type LogRecord = {
  ts: number; // performance.now() or Date.now()
  wallMs: number; // Date.now()
  level: LogLevel;
  category: ObsCategory;
  message: string;
  fields?: LogFields;
  spanId?: string;
  sessionId: string;
};

export type MetricKind = 'counter' | 'gauge' | 'histogram';

export type HistogramSnapshot = {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
};

export type MetricSnapshot = {
  name: string;
  kind: MetricKind;
  value: number;
  labels?: Record<string, string>;
  histogram?: HistogramSnapshot;
};

export type SpanRecord = {
  id: string;
  name: string;
  category: ObsCategory;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  parentId?: string;
  fields?: LogFields;
  status: 'open' | 'ok' | 'error';
  errorMessage?: string;
};

export type TelemetryEvent = {
  ts: number;
  wallMs: number;
  type: string;
  category: ObsCategory;
  payload?: LogFields;
  sessionId: string;
};

export type ObservabilityConfig = {
  /** Minimum log level written to sinks */
  minLevel: LogLevel;
  /** Ring buffer capacity for logs */
  logBufferSize: number;
  /** Ring buffer capacity for telemetry events */
  eventBufferSize: number;
  /** Ring buffer capacity for completed spans */
  spanBufferSize: number;
  /** Mirror logs to console */
  console: boolean;
  /** Collect per-system histograms */
  systemTiming: boolean;
  /** Sample rate 0..1 for high-volume trace logs */
  traceSampleRate: number;
  /** Persist recent diagnostics to localStorage (no PII) */
  persistSession: boolean;
};

export type FramePerfSample = {
  fps: number;
  frameMs: number;
  simTickMs: number;
  simTicksThisFrame: number;
  renderMs: number;
  projectMs: number;
};

export type SimPerfSnapshot = {
  lastTickMs: number;
  avgTickMs: number;
  p95TickMs: number;
  systems: Record<string, HistogramSnapshot>;
  entityCounts: { sims: number; objects: number; relationships: number };
  pathFails: number;
  pathSuccess: number;
  actionsFailed: number;
  actionsSucceeded: number;
  autonomyPicks: number;
  tick: number;
};

export type ObservabilitySnapshot = {
  sessionId: string;
  startedAt: number;
  uptimeMs: number;
  config: ObservabilityConfig;
  frame: FramePerfSample;
  sim: SimPerfSnapshot;
  metrics: MetricSnapshot[];
  recentLogs: LogRecord[];
  recentEvents: TelemetryEvent[];
  recentSpans: SpanRecord[];
  warnings: string[];
};
