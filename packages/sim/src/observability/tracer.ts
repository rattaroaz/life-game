import { RingBuffer } from './ringBuffer.js';
import type { LogFields, ObsCategory, SpanRecord } from './types.js';

function nowPerf(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

let spanSeq = 0;

export class Tracer {
  private open = new Map<string, SpanRecord>();
  readonly completed: RingBuffer<SpanRecord>;

  constructor(spanBufferSize: number) {
    this.completed = new RingBuffer<SpanRecord>(spanBufferSize);
  }

  start(name: string, category: ObsCategory, fields?: LogFields, parentId?: string): string {
    const id = `span_${++spanSeq}_${Math.floor(nowPerf())}`;
    const span: SpanRecord = {
      id,
      name,
      category,
      startMs: nowPerf(),
      parentId,
      fields,
      status: 'open',
    };
    this.open.set(id, span);
    return id;
  }

  /** Time a synchronous function */
  time<T>(name: string, category: ObsCategory, fn: () => T, fields?: LogFields): T {
    const id = this.start(name, category, fields);
    try {
      const result = fn();
      this.end(id, 'ok');
      return result;
    } catch (e) {
      this.end(id, 'error', e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  end(id: string, status: 'ok' | 'error' = 'ok', errorMessage?: string): number {
    const span = this.open.get(id);
    if (!span) return 0;
    span.endMs = nowPerf();
    span.durationMs = span.endMs - span.startMs;
    span.status = status;
    if (errorMessage) span.errorMessage = errorMessage;
    this.open.delete(id);
    this.completed.push(span);
    return span.durationMs;
  }

  /** Active open span count (leaks if not ended). */
  openCount(): number {
    return this.open.size;
  }
}
