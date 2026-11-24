// FILE: GitWritingModelSetting.tsx
// Purpose: Pick the OpenCode model used for commit messages, PR titles, and branch names.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useAppSettings } from "~/appSettings";
import { Select, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import {
  openCodeModelProvidersQueryOptions,
  providerModelsQueryOptions,
} from "~/lib/providerDiscoveryReactQuery";
import { settingRowAnchorId } from "~/settingsNavigation";
import {
  SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
  SETTINGS_CARD_ROW_TITLE_CLASS_NAME,
} from "~/settingsPanelStyles";
import { SettingsSection, SettingsSelectPopup } from "./SettingsPanelPrimitives";

export function GitWritingModelSetting(props: { cwd?: string | null }) {
  const { t } = useTranslation("settings");
  const cwd = props.cwd ?? null;
  const { settings, updateSettings } = useAppSettings();
  const connectionsQuery = useQuery(openCodeModelProvidersQueryOptions(cwd));
  const connectedCount = connectionsQuery.data?.configuredProviderCount ?? 0;
  const modelsQuery = useQuery(
    providerModelsQueryOptions({ provider: "opencode", cwd, enabled: connectedCount > 0 }),
  );
  const models = useMemo(() => modelsQuery.data?.models ?? [], [modelsQuery.data?.models]);
  const selectedGitModel =
    settings.textGenerationProvider === "opencode" ? settings.textGenerationModel : undefined;

  return (
    <SettingsSection title={t("route.models.sections.generationDefaults")}>
      <div
        id={settingRowAnchorId("git-writing-model")}
        className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <div className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>
            {t("search.entries.behavior.git-writing-model.title")}
          </div>
          <p className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>
            {t("route.models.gitWriting.description")}
          </p>
        </div>
        <Select
          value={selectedGitModel}
          disabled={models.length === 0}
          onValueChange={(model) => {
            if (!model) return;
            updateSettings({ textGenerationProvider: "opencode", textGenerationModel: model });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={t("route.models.gitWriting.ariaLabel")}
          >
            <SelectValue>
              {models.find((model) => model.slug === selectedGitModel)?.name ??
                (models.length > 0
                  ? t("route.models.gitWriting.chooseModel")
                  : t("route.models.gitWriting.configureFirst"))}
            </SelectValue>
          </SelectTrigger>
          <SettingsSelectPopup>
            {models.map((model) => (
              <SelectItem hideIndicator key={model.slug} value={model.slug}>
                {model.name}
              </SelectItem>
            ))}
          </SettingsSelectPopup>
        </Select>
      </div>
    </SettingsSection>
  );
}
