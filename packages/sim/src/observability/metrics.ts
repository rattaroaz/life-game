import type { HistogramSnapshot, MetricKind, MetricSnapshot } from './types.js';

const HIST_MAX_SAMPLES = 256;

export class Counter {
  constructor(
    public readonly name: string,
    public value = 0,
    public readonly labels?: Record<string, string>,
  ) {}

  inc(by = 1): void {
    this.value += by;
  }

  reset(): void {
    this.value = 0;
  }
}

export class Gauge {
  constructor(
    public readonly name: string,
    public value = 0,
    public readonly labels?: Record<string, string>,
  ) {}

  set(v: number): void {
    this.value = v;
  }

  add(by: number): void {
    this.value += by;
  }
}

/** Rolling window histogram for latency-like measurements (ms). */
export class Histogram {
  private samples: number[] = [];
  private write = 0;
  private filled = 0;
  sum = 0;
  min = Number.POSITIVE_INFINITY;
  max = Number.NEGATIVE_INFINITY;

  constructor(
    public readonly name: string,
    public readonly labels?: Record<string, string>,
    private readonly maxSamples = HIST_MAX_SAMPLES,
  ) {
    this.samples = new Array(maxSamples).fill(0);
  }

  observe(v: number): void {
    if (!Number.isFinite(v)) return;
    const prev = this.samples[this.write]!;
    if (this.filled === this.maxSamples) {
      this.sum -= prev;
    } else {
      this.filled += 1;
    }
    this.samples[this.write] = v;
    this.write = (this.write + 1) % this.maxSamples;
    this.sum += v;
    this.min = Math.min(this.min, v);
    this.max = Math.max(this.max, v);
  }

  snapshot(): HistogramSnapshot {
    if (this.filled === 0) {
      return { count: 0, sum: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
    }
    const arr = this.samples.slice(0, this.filled).sort((a, b) => a - b);
    const pct = (p: number) => {
      const i = Math.min(arr.length - 1, Math.max(0, Math.ceil((p / 100) * arr.length) - 1));
      return arr[i]!;
    };
    return {
      count: this.filled,
      sum: this.sum,
      min: arr[0]!,
      max: arr[arr.length - 1]!,
      avg: this.sum / this.filled,
      p50: pct(50),
      p95: pct(95),
      p99: pct(99),
    };
  }

  reset(): void {
    this.samples.fill(0);
    this.write = 0;
    this.filled = 0;
    this.sum = 0;
    this.min = Number.POSITIVE_INFINITY;
    this.max = Number.NEGATIVE_INFINITY;
  }
}

export class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();

  private key(name: string, labels?: Record<string, string>): string {
    if (!labels) return name;
    const parts = Object.keys(labels)
      .sort()
      .map((k) => `${k}=${labels[k]}`);
    return `${name}{${parts.join(',')}}`;
  }

  counter(name: string, labels?: Record<string, string>): Counter {
    const k = this.key(name, labels);
    let c = this.counters.get(k);
    if (!c) {
      c = new Counter(name, 0, labels);
      this.counters.set(k, c);
    }
    return c;
  }

  gauge(name: string, labels?: Record<string, string>): Gauge {
    const k = this.key(name, labels);
    let g = this.gauges.get(k);
    if (!g) {
      g = new Gauge(name, 0, labels);
      this.gauges.set(k, g);
    }
    return g;
  }

  histogram(name: string, labels?: Record<string, string>): Histogram {
    const k = this.key(name, labels);
    let h = this.histograms.get(k);
    if (!h) {
      h = new Histogram(name, labels);
      this.histograms.set(k, h);
    }
    return h;
  }

  inc(name: string, by = 1, labels?: Record<string, string>): void {
    this.counter(name, labels).inc(by);
  }

  set(name: string, value: number, labels?: Record<string, string>): void {
    this.gauge(name, labels).set(value);
  }

  observe(name: string, value: number, labels?: Record<string, string>): void {
    this.histogram(name, labels).observe(value);
  }

  snapshot(): MetricSnapshot[] {
    const out: MetricSnapshot[] = [];
    for (const c of this.counters.values()) {
      out.push({ name: c.name, kind: 'counter' as MetricKind, value: c.value, labels: c.labels });
    }
    for (const g of this.gauges.values()) {
      out.push({ name: g.name, kind: 'gauge' as MetricKind, value: g.value, labels: g.labels });
    }
    for (const h of this.histograms.values()) {
      const hist = h.snapshot();
      out.push({
        name: h.name,
        kind: 'histogram',
        value: hist.avg,
        labels: h.labels,
        histogram: hist,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  resetAll(): void {
    for (const c of this.counters.values()) c.reset();
    for (const g of this.gauges.values()) g.set(0);
    for (const h of this.histograms.values()) h.reset();
  }
}
