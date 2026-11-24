// FILE: LocalModelHarnessToggles.tsx
// Purpose: "Use with" switches that decide which harnesses list downloaded Ollama models.

import type { LocalModelHarness } from "@djl/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { Switch } from "../ui/switch";
import { SettingsSection } from "./SettingsPanelPrimitives";

const HARNESSES: ReadonlyArray<{ id: LocalModelHarness; label: string }> = [
  { id: "claudeAgent", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
];

export function LocalModelHarnessToggles() {
  const { t } = useTranslation("settings");
  const client = useQueryClient();
  const serverSettings = useQuery(serverSettingsQueryOptions());
  const save = useMutation({
    mutationFn: async (patch: Partial<Record<LocalModelHarness, boolean>>) => {
      const api = ensureNativeApi();
      const settings = await api.server.updateSettings({ localModels: { harnesses: patch } });
      // OpenCode reads a managed config file that the local-model refresh rewrites.
      if (patch.opencode !== undefined) await api.localModels.refresh().catch(() => undefined);
      return settings;
    },
    onSuccess: async (settings) => {
      client.setQueryData(serverQueryKeys.settings(), settings);
      await client.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
    },
  });
  const harnesses = serverSettings.data?.localModels.harnesses;

  return (
    <SettingsSection title={t("localModels.useWith.title")}>
      <p className="px-4 pt-4 text-xs text-muted-foreground">
        {t("localModels.useWith.description")}
      </p>
      {HARNESSES.map((harness) => (
        <div key={harness.id} className="flex items-center gap-4 px-4 py-3">
          <p className="flex-1 text-sm font-medium">{harness.label}</p>
          <Switch
            aria-label={t("localModels.useWith.toggle", { harness: harness.label })}
            checked={harnesses?.[harness.id] ?? true}
            disabled={!harnesses || save.isPending}
            onCheckedChange={(enabled) => save.mutate({ [harness.id]: enabled })}
          />
        </div>
      ))}
      {save.isError ? (
        <p role="alert" className="px-4 pb-3 text-xs text-destructive">
          {t("localModels.useWith.saveFailed")}
        </p>
      ) : null}
    </SettingsSection>
  );
}
