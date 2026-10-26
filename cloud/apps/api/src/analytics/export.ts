import type { AnalyticsReport } from "@synara/contracts/cloud";

export function csvCell(value: string | number): string {
  const raw = String(value);
  const safe = /^(?:[\t\r]|\s*[=+@-])/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function analyticsRows(report: AnalyticsReport): (string | number)[][] {
  const rows: (string | number)[][] = [["metric", "value", "source", "observed_at"]];
  rows.push(
    ["registered_accounts", report.accounts.registered, "cloud", report.asOf],
    ["active_accounts", report.activity.activeAccounts, "cloud-and-opt-in-apps", report.asOf],
    ["active_installations", report.activity.activeInstallations, "opt-in-apps", report.asOf],
    ["cloud_requests", report.cloud.requests, "cloud", report.asOf],
  );
  for (const row of report.downloads)
    rows.push([row.name ?? row.dimension, row.count, row.source, row.observedAt]);
  rows.push(
    ["environment", report.environment, "cloud", report.asOf],
    ["range_since", report.since, "cloud", report.asOf],
    ["include_test", String(report.includeTest), "opt-in-apps", report.asOf],
  );
  for (const [metric, value] of Object.entries(report.cloud))
    rows.push([`cloud.${metric}`, value, "cloud", report.asOf]);
  for (const row of report.platforms) {
    rows.push(
      [`platform.${row.platform}.active_accounts`, row.activeAccounts, "opt-in-apps", report.asOf],
      [
        `platform.${row.platform}.active_installations`,
        row.activeInstallations,
        "opt-in-apps",
        report.asOf,
      ],
    );
  }
  for (const row of report.features)
    rows.push([`feature.${row.feature}.actions`, row.actions, "opt-in-apps", report.asOf]);
  for (const row of report.versions)
    rows.push([
      `version.${row.platform}.${row.appVersion}`,
      row.activeInstallations,
      "opt-in-apps",
      report.asOf,
    ]);
  for (const row of report.history)
    rows.push(["daily.active_accounts", row.activeAccounts, "cloud-and-opt-in-apps", row.day]);
  for (const row of report.downloadHistory)
    rows.push(["observed_download_increments", row.downloads, row.source, row.day]);
  return rows;
}
export function analyticsCsv(report: AnalyticsReport): string {
  const rows = analyticsRows(report);
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
