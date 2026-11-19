export function remainingSplashDuration(mountedAt: number): number {
  return Math.max(0, 7_000 - (performance.now() - mountedAt));
}
