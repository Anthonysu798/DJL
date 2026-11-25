// FILE: SkillsSettingsPanel.tsx
// Purpose: Settings → Skills panel. Lists every skill from the unified cross-provider
// catalog (~/.djl/skills plus each provider's skills folder), shows which provider
// a skill comes from, and lets the user enable/disable each one. Disabled skills are
// hidden from the composer skill picker on every provider.

import type { ProviderKind, ServerSettings } from "@djl/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ProviderIcon } from "~/components/ProviderIcon";
import { SettingsRow, SettingsSection } from "~/components/settings/SettingsPanelPrimitives";
import {
  SETTINGS_PANEL_SECTION_CLASS_NAME,
  SETTINGS_SECTION_LABEL_CLASS_NAME,
} from "~/settingsPanelStyles";
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
    const disabled = [...next].toSorted();
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
  const djlSkillsDir = catalogQuery.data?.djlSkillsDir;

  return (
    // Container queries: the settings pane's width, not the window's, decides the layout.
    <div className="@container space-y-8">
      <SettingsSection title={t("skills.portable.sectionTitle")}>
        <SettingsRow
          title={t("skills.portable.title")}
          description={t("skills.portable.description")}
          status={
            djlSkillsDir ? (
              <code className="break-all text-[11px] text-muted-foreground">{djlSkillsDir}</code>
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

      {skillSections.map((section) => (
        <section key={section.key} className={SETTINGS_PANEL_SECTION_CLASS_NAME}>
          <h2 className={SETTINGS_SECTION_LABEL_CLASS_NAME}>{section.title}</h2>
          <ul className="grid grid-cols-1 gap-2.5 @2xl:grid-cols-2">
            {section.groups.map((group) => {
              const enabled = !disabledSkillNames.has(group.key);
              return (
                <li
                  key={group.key}
                  className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/60 bg-card/40 p-3.5 transition-[border-color,background-color,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-border hover:bg-card/70 data-[enabled=false]:opacity-70"
                  data-enabled={enabled}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                        <SkillCubeIcon
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-muted-foreground"
                        />
                        <span className="truncate">{group.displayName}</span>
                      </h3>
                      {group.description ? (
                        <p className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                          {group.description}
                        </p>
                      ) : null}
                    </div>
                    <Switch
                      className="mt-0.5 shrink-0"
                      checked={enabled}
                      onCheckedChange={(checked) =>
                        setSkillEnabled(group.primarySkill.name, Boolean(checked))
                      }
                      aria-label={t("skills.enableAriaLabel", { skill: group.displayName })}
                    />
                  </div>
                  <div className="mt-auto flex min-w-0 flex-col gap-1 border-t border-border/50 pt-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <SkillProviderStack providers={group.providers} />
                      <span className="truncate text-[11px] text-muted-foreground">
                        {group.sources.map((source) => source.originInfo.label).join(" · ")}
                      </span>
                    </span>
                    {group.sources.map((source) => (
                      // Long paths trim from the start so the skill's own folder stays visible.
                      <code
                        key={source.skill.path}
                        className="block truncate text-left text-[11px] text-muted-foreground/80 [direction:rtl]"
                        title={source.skill.path}
                      >
                        <bdi>{source.skill.path}</bdi>
                      </code>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
