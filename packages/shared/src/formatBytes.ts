// FILE: formatBytes.ts
// Purpose: Small shared byte-size labels for attachment prompts and chips.
// Layer: Shared runtime utility
// Exports: formatBytes

// Formats byte counts for compact summaries. UI callers pass the selected app locale;
// locale-neutral protocol/prompt callers retain the stable English default.
export function formatBytes(bytes: number, locale = "en"): string {
  const normalized = Number.isFinite(bytes) ? Math.max(0, Math.floor(bytes)) : 0;
  const format = (value: number, maximumFractionDigits: number) =>
    new Intl.NumberFormat(locale, {
      maximumFractionDigits,
      minimumFractionDigits: 0,
    }).format(value);
  if (normalized < 1024) {
    return `${format(normalized, 0)} B`;
  }
  const kib = normalized / 1024;
  if (kib < 1024) {
    return `${format(kib, 1)} KB`;
  }
  const mib = kib / 1024;
  if (mib < 1024) {
    return `${format(mib, 1)} MB`;
  }
  return `${format(mib / 1024, 1)} GB`;
}
