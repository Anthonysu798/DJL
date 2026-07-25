// FILE: SkillsSettingsPanel.tsx
// Purpose: Settings → Skills panel. Lists every skill from the unified cross-provider
// catalog (~/.synara/skills plus each provider's skills folder), shows which provider
// a skill comes from, and lets the user enable/disable each one. Disabled skills are
// hidden from the composer skill picker on every provider.

import type { ProviderKind, ServerSettings } from "@synara/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ProviderIcon } from "~/components/ProviderIcon";
import { SettingsRow, SettingsSection } from "~/components/settings/SettingsPanelPrimitives";
import { Switch } from "~/components/ui/switch";
import { SettingsLoadError, settingsLoadErrorDetail } from "./SettingsLoadError";
import { SkillCubeIcon } from "~/lib/icons";
import { ensureNativeApi } from "~/nativeApi";
import {
  providerDiscoveryQueryKeys,
  skillsCatalogQueryOptions,
} from "~/lib/providerDiscoveryReactQuery";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import {
  buildSettingsSkillGroups,
  buildSettingsSkillSections,
  providerDisplayName,
  settingsSkillNameKey,
} from "./skillsSettingsModel";

function SkillProviderStack({ providers }: { providers: ReadonlyArray<ProviderKind> }) {
  const { t } = useTranslation("settings");
  if (providers.length === 0) {
    return null;
  }

  const label = providers.map(providerDisplayName).join(", ");
  const stackLabel = t("skills.providerCopies", { count: providers.length, providers: label });
  return (
    <span
      className="inline-flex shrink-0 items-center -space-x-1"
      aria-label={stackLabel}
      title={stackLabel}
    >
      {providers.map((provider) => (
        <span
          key={provider}
          className="inline-flex size-4 items-center justify-center rounded-full border border-background bg-background"
        >
          <ProviderIcon provider={provider} className="size-3" />
        </span>
      ))}
    </span>
  );
}

export function SkillsSettingsPanel() {
  const { t } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const catalogQuery = useQuery(skillsCatalogQueryOptions());
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());

  const disabledSkillNames = useMemo(
    () =>
      new Set(
        (serverSettingsQuery.data?.skills.disabled ?? []).map((name) => settingsSkillNameKey(name)),
      ),
    [serverSettingsQuery.data?.skills.disabled],
  );

  const skillGroups = useMemo(
    () => buildSettingsSkillGroups(catalogQuery.data?.skills ?? [], t),
    [catalogQuery.data?.skills, t],
  );
  const skillSections = useMemo(() => {
    return buildSettingsSkillSections(catalogQuery.data?.skills ?? [], t);
  }, [catalogQuery.data?.skills, t]);

  const setSkillEnabled = (skillName: string, enabled: boolean) => {
    // Read through the query cache (not the render closure) so rapid toggles
    // build on each other instead of clobbering the previous patch.
    const latestSettings = queryClient.getQueryData<ServerSettings>(serverQueryKeys.settings());
    const currentDisabled = latestSettings?.skills.disabled ?? [...disabledSkillNames];
    const key = settingsSkillNameKey(skillName);
    const next = new Set(currentDisabled.map((name) => settingsSkillNameKey(name)));
    if (enabled) {
      next.delete(key);
    } else {
      next.add(key);
    }
    const disabled = [...next].sort();
    if (latestSettings) {
      // Optimistic flip; a failed patch invalidates back to the server state.
      queryClient.setQueryData(serverQueryKeys.settings(), {
        ...latestSettings,
        skills: { disabled },
      });
    }
    void ensureNativeApi()
      .server.updateSettings({ skills: { disabled } })
      .then((nextSettings) => {
        queryClient.setQueryData(serverQueryKeys.settings(), nextSettings);
        // Composer skill pickers are served filtered by these toggles.
        void queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
      })
      .catch(() => {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() });
      });
  };

  const totalSkills = skillGroups.length;
  const enabledSkills = skillGroups.filter((group) => !disabledSkillNames.has(group.key)).length;
  const synaraSkillsDir = catalogQuery.data?.synaraSkillsDir;

  return (
    <div className="space-y-8">
      <SettingsSection title={t("skills.portable.sectionTitle")}>
        <SettingsRow
          title={t("skills.portable.title")}
          description={t("skills.portable.description")}
          status={
            synaraSkillsDir ? (
              <code className="break-all text-[11px] text-muted-foreground">{synaraSkillsDir}</code>
            ) : null
          }
          control={
            <span className="text-xs font-medium text-muted-foreground">
              {catalogQuery.isLoading
                ? t("skills.scanning")
                : t("skills.enabledCount", { enabled: enabledSkills, count: totalSkills })}
            </span>
          }
        />
      </SettingsSection>

      {catalogQuery.isError ? (
        <SettingsSection title={t("skills.title")}>
          <SettingsLoadError
            summary={t("skills.errors.discoveryTitle")}
            detail={settingsLoadErrorDetail(
              catalogQuery.error,
              t("skills.errors.discoveryDescription"),
            )}
            actionLabel={t("actions.retry", { ns: "common" })}
            onAction={() => void catalogQuery.refetch()}
          />
        </SettingsSection>
      ) : null}

      {!catalogQuery.isLoading && !catalogQuery.isError && totalSkills === 0 ? (
        <SettingsSection title={t("skills.title")}>
          <SettingsRow title={t("skills.emptyTitle")} description={t("skills.emptyDescription")} />
        </SettingsSection>
      ) : null}

      {skillSections.map((section) => {
        return (
          <SettingsSection key={section.key} title={section.title}>
            {section.groups.map((group) => {
              const enabled = !disabledSkillNames.has(group.key);
              return (
                <SettingsRow
                  key={group.key}
                  title={
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <SkillCubeIcon
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <span className="truncate">{group.displayName}</span>
                    </span>
                  }
                  description={group.description}
                  status={
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <SkillProviderStack providers={group.providers} />
                        <span className="truncate text-[11px] text-muted-foreground">
                          {group.sources.map((source) => source.originInfo.label).join(" · ")}
                        </span>
                      </span>
                      {group.sources.map((source) => (
                        <code
                          key={source.skill.path}
                          className="truncate text-[11px] text-muted-foreground"
                        >
                          {source.skill.path}
                        </code>
                      ))}
                    </span>
                  }
                  control={
                    <Switch
                      checked={enabled}
                      onCheckedChange={(checked) =>
                        setSkillEnabled(group.primarySkill.name, Boolean(checked))
                      }
                      aria-label={t("skills.enableAriaLabel", { skill: group.displayName })}
                    />
                  }
                />
              );
            })}
          </SettingsSection>
        );
      })}
    </div>
  );
}
