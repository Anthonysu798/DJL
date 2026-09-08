import type {
  HarnessMaintainToolInput,
  HarnessTool,
  HarnessToolId,
  HarnessToolsResult,
  ServerSettings,
} from "@synara/contracts";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// The server owns scheduling; closing Settings or restarting the renderer must
// not stop updates. Maintenance still uses the controller's shared mutation lock.
export function createAutomaticHarnessUpdater(deps: {
  settings: () => Promise<
    Pick<ServerSettings, "enableAutomaticProviderUpdates" | "enableProviderUpdateChecks">
  >;
  isIdle: () => Promise<boolean>;
  list: () => Promise<HarnessToolsResult>;
  maintain: (input: HarnessMaintainToolInput) => Promise<HarnessTool>;
  report: (id: HarnessToolId | null, succeeded: boolean) => void;
  now?: () => number;
}) {
  let running = false;
  let stopped = false;
  let nextCheckAt = 0;
  const now = deps.now ?? Date.now;
  const enabled = async () => {
    const settings = await deps.settings();
    return settings.enableAutomaticProviderUpdates && settings.enableProviderUpdateChecks;
  };
  return {
    stop() {
      stopped = true;
    },
    async tick() {
      if (stopped || running || now() < nextCheckAt) return;
      running = true;
      try {
        if (!(await enabled()) || !(await deps.isIdle())) return;
        nextCheckAt = now() + CHECK_INTERVAL_MS;
        const { tools } = await deps.list();
        for (const tool of tools) {
          if (
            !tool.installed ||
            !tool.canUpdate ||
            tool.status !== "behind_latest" ||
            !tool.latestVersion
          )
            continue;
          if (stopped || !(await enabled()) || !(await deps.isIdle())) {
            nextCheckAt = 0;
            return;
          }
          try {
            await deps.maintain({ harness: tool.id });
            deps.report(tool.id, true);
          } catch {
            // Do not log installer output or local registry credentials.
            deps.report(tool.id, false);
          }
        }
      } catch {
        nextCheckAt = now() + CHECK_INTERVAL_MS;
        deps.report(null, false);
      } finally {
        running = false;
      }
    },
  };
}
