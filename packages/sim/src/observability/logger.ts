import { RingBuffer } from './ringBuffer.js';
import {
  LOG_LEVEL_RANK,
  type LogFields,
  type LogLevel,
  type LogRecord,
  type ObsCategory,
  type ObservabilityConfig,
} from './types.js';

export type LogSink = (record: LogRecord) => void;

function nowPerf(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class Logger {
  private sinks: LogSink[] = [];
  readonly buffer: RingBuffer<LogRecord>;

  constructor(
    private sessionId: string,
    private getConfig: () => ObservabilityConfig,
    bufferSize: number,
  ) {
    this.buffer = new RingBuffer<LogRecord>(bufferSize);
  }

  addSink(sink: LogSink): void {
    this.sinks.push(sink);
  }

  clearSinks(): void {
    this.sinks = [];
  }

  child(defaultCategory: ObsCategory, defaultFields?: LogFields) {
    const parent = this;
    return {
      trace: (msg: string, fields?: LogFields) =>
        parent.log('trace', defaultCategory, msg, { ...defaultFields, ...fields }),
      debug: (msg: string, fields?: LogFields) =>
        parent.log('debug', defaultCategory, msg, { ...defaultFields, ...fields }),
      info: (msg: string, fields?: LogFields) =>
        parent.log('info', defaultCategory, msg, { ...defaultFields, ...fields }),
      warn: (msg: string, fields?: LogFields) =>
        parent.log('warn', defaultCategory, msg, { ...defaultFields, ...fields }),
      error: (msg: string, fields?: LogFields) =>
        parent.log('error', defaultCategory, msg, { ...defaultFields, ...fields }),
    };
  }

  log(
    level: LogLevel,
    category: ObsCategory,
    message: string,
    fields?: LogFields,
    spanId?: string,
  ): void {
    const cfg = this.getConfig();
    if (LOG_LEVEL_RANK[level] < LOG_LEVEL_RANK[cfg.minLevel]) return;
    if (level === 'trace' && cfg.traceSampleRate < 1) {
      if (Math.random() > cfg.traceSampleRate) return;
    }

    const record: LogRecord = {
      ts: nowPerf(),
      wallMs: Date.now(),
      level,
      category,
      message,
      fields,
      spanId,
      sessionId: this.sessionId,
    };
    this.buffer.push(record);

    if (cfg.console) {
      this.writeConsole(record);
    }
    for (const sink of this.sinks) {
      try {
        sink(record);
      } catch {
        // never throw from observability
      }
    }
  }

  private writeConsole(r: LogRecord): void {
    const prefix = `[${r.level.toUpperCase()}][${r.category}]`;
    const payload = r.fields ? [prefix, r.message, r.fields] : [prefix, r.message];
    switch (r.level) {
      case 'error':
        console.error(...payload);
        break;
      case 'warn':
        console.warn(...payload);
        break;
      case 'debug':
      case 'trace':
        // eslint-disable-next-line no-console
        console.debug(...payload);
        break;
      default:
        // eslint-disable-next-line no-console
        console.info(...payload);
    }
  }

  trace(category: ObsCategory, message: string, fields?: LogFields): void {
    this.log('trace', category, message, fields);
  }
  debug(category: ObsCategory, message: string, fields?: LogFields): void {
    this.log('debug', category, message, fields);
  }
  info(category: ObsCategory, message: string, fields?: LogFields): void {
    this.log('info', category, message, fields);
  }
  warn(category: ObsCategory, message: string, fields?: LogFields): void {
    this.log('warn', category, message, fields);
  }
  error(category: ObsCategory, message: string, fields?: LogFields): void {
    this.log('error', category, message, fields);
  }
}
