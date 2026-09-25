/**
 * Primary/fallback API keys per provider (decision: Key rotation). When the
 * primary is rejected as invalid, the fallback takes over for the rest of the
 * process lifetime and an alert is raised by the caller.
 */
export class KeyRing {
  private useFallback = false;
  constructor(
    private readonly primary: string,
    private readonly fallback: string | null,
  ) {}
  current(): string {
    return this.useFallback && this.fallback ? this.fallback : this.primary;
  }
  /** Returns true if a switch happened. */
  markInvalid(): boolean {
    if (this.useFallback || !this.fallback) return false;
    this.useFallback = true;
    return true;
  }
}
