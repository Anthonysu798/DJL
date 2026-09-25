/**
 * Per-provider circuit breaker. Opens after `threshold` retryable failures in
 * `windowMs`, stays open for `openMs`, then lets one probe through.
 */
export type BreakerState = "closed" | "open" | "half_open";

export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;
  private probing = false;
  constructor(
    private readonly options = { threshold: 5, windowMs: 30_000, openMs: 20_000 },
    private readonly now: () => number = Date.now,
  ) {}

  state(): BreakerState {
    if (this.openedAt === null) return "closed";
    if (this.now() - this.openedAt < this.options.openMs) return "open";
    return "half_open";
  }

  /** Whether a request may proceed right now. */
  allow(): boolean {
    const s = this.state();
    if (s === "closed") return true;
    if (s === "open") return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  success(): void {
    this.failures = [];
    this.openedAt = null;
    this.probing = false;
  }

  failure(): void {
    const t = this.now();
    this.probing = false;
    if (this.state() === "half_open") {
      this.openedAt = t;
      return;
    }
    this.failures = this.failures.filter((f) => t - f < this.options.windowMs);
    this.failures.push(t);
    if (this.failures.length >= this.options.threshold) this.openedAt = t;
  }
}
