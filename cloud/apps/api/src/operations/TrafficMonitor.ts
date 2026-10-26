import type { Redis } from "ioredis";

/** Counts and response-header latency only; no paths, addresses, headers or content. */
export class TrafficMonitor {
  private pending = new Map<number, { requests: number; errors: number; latency: number }>();
  private timer: ReturnType<typeof setInterval>;
  private flushing: Promise<void> | null = null;
  constructor(
    private readonly redis: Redis,
    private readonly now = Date.now,
  ) {
    this.timer = setInterval(() => {
      void this.flush().catch(() => undefined);
    }, 5000);
    this.timer.unref();
  }
  record(status: number, latencyMs: number) {
    const bucket = Math.floor(this.now() / 300_000) * 300;
    const value = this.pending.get(bucket) ?? { requests: 0, errors: 0, latency: 0 };
    value.requests++;
    value.errors += status >= 400 ? 1 : 0;
    value.latency += Math.max(0, latencyMs);
    this.pending.set(bucket, value);
  }
  async flush(): Promise<void> {
    if (this.flushing) await this.flushing;
    if (this.pending.size === 0) return;
    const rows = this.pending;
    this.pending = new Map();
    this.flushing = (async () => {
      const pipe = this.redis.pipeline();
      for (const [at, values] of rows) {
        const key = "operations:traffic:" + at;
        pipe.hincrby(key, "requests", values.requests);
        pipe.hincrby(key, "errors", values.errors);
        pipe.hincrbyfloat(key, "latency", values.latency);
        pipe.expire(key, 8 * 86400);
      }
      const result = await pipe.exec();
      if (!result || result.some(([error]) => error))
        throw new Error("Traffic metrics unavailable.");
    })();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }
  async snapshot(range: "hour" | "day" | "week") {
    await this.flush();
    const seconds = { hour: 3600, day: 86400, week: 7 * 86400 }[range];
    const end = Math.floor(this.now() / 300_000) * 300;
    const start = end - seconds + 300;
    const pipe = this.redis.pipeline();
    for (let at = start; at <= end; at += 300)
      pipe.hmget("operations:traffic:" + at, "requests", "errors", "latency");
    const result = await pipe.exec();
    if (!result || result.some(([error]) => error)) throw new Error("Traffic metrics unavailable.");
    const groups = new Map<
      number,
      { at: number; requests: number; errors: number; latency: number }
    >();
    let requests = 0,
      errors = 0,
      latency = 0;
    const step = Math.ceil(seconds / 120 / 300) * 300;
    result.forEach(([, raw], i) => {
      const row = raw as (string | null)[];
      const n = Number(row[0] ?? 0),
        e = Number(row[1] ?? 0),
        l = Number(row[2] ?? 0);
      requests += n;
      errors += e;
      latency += l;
      const at = Math.floor((start + i * 300) / step) * step;
      const group = groups.get(at) ?? { at, requests: 0, errors: 0, latency: 0 };
      group.requests += n;
      group.errors += e;
      group.latency += l;
      groups.set(at, group);
    });
    return {
      requests,
      errors,
      averageLatencyMs: requests ? latency / requests : 0,
      history: [...groups.values()].map((g) => ({
        at: g.at,
        requests: g.requests,
        errors: g.errors,
        averageLatencyMs: g.requests ? g.latency / g.requests : 0,
      })),
    };
  }
  async close() {
    clearInterval(this.timer);
    await this.flush().catch(() => undefined);
  }
}
