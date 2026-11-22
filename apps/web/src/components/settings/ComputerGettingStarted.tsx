import { Schema } from "effect";
import { useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Button } from "~/components/ui/button";
import { SettingsCard, SettingsRow, SettingsSectionShell } from "./SettingsPanelPrimitives";
import { useTranslation } from "~/i18n";

const STORAGE_KEY = "djl:computer-getting-started:v1";

/** Introduce Computer where it is enabled, without opening another startup dialog. */
export function ComputerGettingStarted({
  appSnapAvailable,
}: {
  readonly appSnapAvailable: boolean;
}) {
  const { t } = useTranslation();

  const [acknowledged, setAcknowledged] = useLocalStorage(STORAGE_KEY, false, Schema.Boolean);
  const [requestedOpen, setRequestedOpen] = useState(false);
  const open = !acknowledged || requestedOpen;
  const dismiss = () => {
    setRequestedOpen(false);
    if (!acknowledged) setAcknowledged(true);
  };

  return (
    <SettingsSectionShell
      title={t("settings:gettingStarted")}
      action={
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={open}
          onClick={() => (open ? dismiss() : setRequestedOpen(true))}
        >
          <DisclosureChevron open={open} />
          {open ? t("settings:hideGuide") : t("settings:showGuide")}
        </Button>
      }
    >
      <DisclosureRegion open={open}>
        <SettingsCard>
          <SettingsRow
            settingId="setting-ask-for-a-task"
            title={t("settings:askForATask")}
            description={t("settings:typeComputerUseFollowedByYourTaskForExample")}
          />
          <SettingsRow
            settingId="setting-approve-the-task"
            title={t("settings:approveTheTask")}
            description={t("settings:ifAskedApproveComputerForTheTaskUseThe")}
          />
          <SettingsRow
            settingId="setting-follow-and-stop"
            title={t("settings:followAndStop")}
            description={t("settings:watchThePreviewWhileTheAgentWorksUseStop")}
          />
        </SettingsCard>
        {appSnapAvailable ? (
          <p className="mt-3 px-2 text-ui-sm text-muted-foreground">
            {t("settings:appSnapIsSeparateItAttachesAWindowImageWithout")}
          </p>
        ) : null}
        {!acknowledged ? (
          <Button className="mt-3" size="sm" variant="outline" onClick={dismiss}>
            {t("common:whatsNew_gotIt")}
          </Button>
        ) : null}
      </DisclosureRegion>
    </SettingsSectionShell>
  );
}
