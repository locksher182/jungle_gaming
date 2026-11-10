export class MetricsCollector {
  private static instance = new MetricsCollector();

  private counters = new Map<string, number>();
  private timings = new Map<string, number[]>();

  public static getInstance(): MetricsCollector {
    return this.instance;
  }

  public increment(metric: string, tags: Record<string, string> = {}): void {
    const key = this.buildKey(metric, tags);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  public recordTiming(metric: string, durationMs: number, tags: Record<string, string> = {}): void {
    const key = this.buildKey(metric, tags);
    const list = this.timings.get(key) ?? [];
    list.push(durationMs);
    this.timings.set(key, list);
  }

  public getCounter(metric: string, tags: Record<string, string> = {}): number {
    const key = this.buildKey(metric, tags);
    return this.counters.get(key) ?? 0;
  }

  public reset(): void {
    this.counters.clear;
    this.timings.clear();
  }

  private buildKey(metric: string, tags: Record<string, string>): string {
    const sortedTags = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return sortedTags ? `${metric}{${sortedTags}}` : metric;
  }
}
