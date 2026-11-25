// FILE: YourSitesSection.tsx
// Purpose: Settings list of the account's slcor.site sites with open and unpublish actions.
//          Hidden when signed out or when there are no sites yet.
// Layer: Settings UI

import type { CloudSite } from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsSection } from "~/components/settings/SettingsPanelPrimitives";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { sitesListQueryOptions, useSiteActions } from "~/lib/sitesReactQuery";
import { ensureNativeApi } from "~/nativeApi";

export function YourSitesSection() {
  const { t } = useTranslation("chat");
  const sites = useQuery(sitesListQueryOptions());
  const { unpublish } = useSiteActions();
  const [confirm, setConfirm] = useState<CloudSite | null>(null);
  if (!sites.data?.signedIn || sites.data.sites.length === 0) return null;
  const limit = sites.data.limits?.maxSites;

  return (
    <SettingsSection
      title={t("sites.yourSites", { count: sites.data.sites.length, limit: limit ?? "" })}
    >
      {sites.data.sites.map((site) => (
        <div key={site.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm">{site.url.replace(/^https:\/\//, "")}</p>
            <p className="text-xs text-muted-foreground">
              {site.status === "disabled"
                ? t("sites.statusDisabled")
                : site.pendingDeploy?.status === "held"
                  ? t("sites.statusHeld")
                  : site.liveDeploy
                    ? t("sites.statusLive")
                    : t("sites.statusEmpty")}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void ensureNativeApi().shell.openExternal(site.url)}
          >
            {t("sites.openSite")}
          </Button>
          {site.status === "active" ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(site)}>
              {t("sites.unpublish")}
            </Button>
          ) : null}
        </div>
      ))}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? null : setConfirm(null))}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sites.unpublishTitle", {
                address: confirm?.url.replace(/^https:\/\//, "") ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("sites.unpublishDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("sites.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={unpublish.isPending}
              onClick={() => {
                if (confirm) unpublish.mutate(confirm.id, { onSettled: () => setConfirm(null) });
              }}
            >
              {t("sites.unpublish")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}
