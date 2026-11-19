/** Fixed human pause choices resolved by the host; no public timestamp input. */
export function computerUsePauseDeadline(action: "30m" | "1h" | "tomorrow09", now: number): string {
  if (action === "30m" || action === "1h")
    return new Date(now + (action === "30m" ? 1_800_000 : 3_600_000)).toISOString();
  const local = new Date(now);
  // Compatible local-time resolution advances gaps and picks the earlier overlap.
  // Gregorian JS Date arithmetic does not establish Foundation calendar parity.
  return new Date(local.getFullYear(), local.getMonth(), local.getDate() + 1, 9).toISOString();
}
