/** Fixed-capacity ring buffer for logs/events/spans */

export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private length = 0;

  constructor(public readonly capacity: number) {
    if (capacity < 1) throw new Error('RingBuffer capacity must be >= 1');
    this.buf = new Array(capacity);
  }

  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length += 1;
  }

  /** Oldest → newest */
  toArray(): T[] {
    const out: T[] = [];
    if (this.length === 0) return out;
    const start =
      this.length < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.length; i++) {
      const idx = (start + i) % this.capacity;
      out.push(this.buf[idx]!);
    }
    return out;
  }

  /** Newest first */
  recent(n: number): T[] {
    const all = this.toArray();
    return all.slice(Math.max(0, all.length - n)).reverse();
  }

  clear(): void {
    this.buf = new Array(this.capacity);
    this.head = 0;
    this.length = 0;
  }

  get size(): number {
    return this.length;
  }
}
