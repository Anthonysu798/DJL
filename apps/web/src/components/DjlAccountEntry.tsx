import { resetSocialAccountCache, subscribeSocialAccountChanges } from "./marketing/accountCache";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isElectron } from "~/env";
import { ensureNativeApi } from "~/nativeApi";
import { CentralIcon } from "~/lib/central-icons";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuSeparator,
  MenuShortcut,
} from "./ui/menu";
import { UserAvatar } from "./UserAvatar";
import { requestFirstRunTourReplay } from "~/onboarding/firstRunTour";
import { SettingsIcon, CircleQuestionIcon } from "~/lib/icons";
import type { SettingsSectionId } from "~/settingsNavigation";
import { formatShortcutLabel } from "~/keybindings";
import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { isLinuxPlatform } from "~/lib/utils";
import { toastManager } from "./ui/toast";
import {
  CLOUD_ACCOUNT_QUERY_KEY,
  DjlCloudAccountCard,
} from "~/components/settings/DjlCloudAccountCard";

const WELCOME_DISMISSED = "djl.account.welcome.dismissed";
// The desktop app menu opens Settings with CmdOrCtrl+, everywhere but Linux.
const SETTINGS_SHORTCUT = {
  key: ",",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: true,
};

export function DjlAccountEntry(
  props: {
    rail?: boolean;
    onSettings?: (section?: SettingsSectionId) => void;
  } = {},
) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeSocialAccountChanges(queryClient), [queryClient]);
  const status = useQuery({
    queryKey: CLOUD_ACCOUNT_QUERY_KEY,
    queryFn: () => ensureNativeApi().cloud.getStatus(),
    staleTime: 15_000,
  });
  const signedIn = Boolean(status.data?.signedIn && status.data.problem !== "session_expired");
  const previouslySignedIn = useRef(signedIn);
  const signOut = useMutation({
    onMutate: () => queryClient.cancelQueries({ queryKey: CLOUD_ACCOUNT_QUERY_KEY }),
    mutationFn: () => ensureNativeApi().cloud.signOut(),
    onSuccess: async (next) => {
      queryClient.setQueryData(CLOUD_ACCOUNT_QUERY_KEY, next);
      await resetSocialAccountCache(queryClient);
      setOpen(true);
      await ensureNativeApi()
        .server.refreshProviders()
        .catch(() => undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: serverConfigQueryOptions().queryKey }),
        queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all }),
      ]);
    },
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });
  const identity = signedIn
    ? (status.data?.email ?? t("cloud.accountTitle"))
    : t("cloud.signInToDjl");
  const email = signedIn ? status.data?.email : undefined;

  useEffect(() => {
    if (signedIn && !previouslySignedIn.current) changeOpen(false);
    else if (!signedIn && isElectron && status.data && !localStorage.getItem(WELCOME_DISMISSED))
      setOpen(true);
    previouslySignedIn.current = signedIn;
  }, [signedIn, status.data]);

  const changeOpen = (next: boolean) => {
    if (!next) localStorage.setItem(WELCOME_DISMISSED, "true");
    setOpen(next);
  };

  return (
    <>
      {props.rail ? (
        <Menu>
          <MenuTrigger
            data-testid="djl-account-entry"
            data-onboarding-target="tutorial-replay"
            className="djl-desktop-rail-button djl-desktop-account-trigger"
            aria-label={identity}
          >
            <UserAvatar email={email} size={30} />
          </MenuTrigger>
          <MenuPopup
            surface="liquid"
            side="right"
            align="end"
            sideOffset={10}
            className="djl-desktop-account-menu"
          >
            <MenuItem
              onClick={() => setOpen(true)}
              className="djl-account-menu-header"
              data-testid="djl-account-menu-header"
            >
              <UserAvatar email={email} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{identity}</div>
                <div className="truncate text-[13px] text-foreground/65 capitalize">
                  {(signedIn && status.data?.usage?.planId) || t("cloud.name")}
                </div>
              </div>
            </MenuItem>
            <MenuSeparator />
            <MenuGroup>
              <MenuItem onClick={() => props.onSettings?.("usage")}>
                <CentralIcon name="gauge" className="size-4" />
                {t("navigation.items.usage.label")}
                {signedIn && status.data?.credits && (
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {status.data.credits.display.total}
                  </span>
                )}
              </MenuItem>
              <MenuItem onClick={() => setOpen(true)}>
                <CentralIcon name="user" className="size-4" />
                {t("cloud.accountTitle")}
              </MenuItem>
              <MenuItem data-onboarding-target="settings" onClick={() => props.onSettings?.()}>
                <SettingsIcon className="size-4" />
                {t("sidebar.settings", { ns: "shell" })}
                {isElectron && !isLinuxPlatform(navigator.platform) && (
                  <MenuShortcut aria-hidden className="text-xs">
                    {formatShortcutLabel(SETTINGS_SHORTCUT)}
                  </MenuShortcut>
                )}
              </MenuItem>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem onClick={requestFirstRunTourReplay}>
              <CircleQuestionIcon className="size-4" />
              {t("onboarding.settings.title", { ns: "shell" })}
            </MenuItem>
            {signedIn && (
              <>
                <MenuSeparator />
                <MenuItem disabled={signOut.isPending} onClick={() => signOut.mutate()}>
                  <CentralIcon name="door" className="size-4" />
                  {t("cloud.signOut")}
                </MenuItem>
              </>
            )}
          </MenuPopup>
        </Menu>
      ) : (
        <button
          type="button"
          data-testid="djl-account-entry"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-sidebar-accent"
        >
          <CentralIcon name="user" className="size-4 shrink-0" />
          <span className="truncate">{signedIn ? status.data?.email : t("cloud.signInToDjl")}</span>
        </button>
      )}
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogPopup surface="solid" className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {signedIn ? t("cloud.accountTitle") : t("cloud.welcomeTitle")}
            </DialogTitle>
            <DialogDescription>{t("cloud.accountDescription")}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <DjlCloudAccountCard />
          </DialogPanel>
          {!signedIn && (
            <div className="p-4 pt-0 text-center">
              <Button variant="ghost" onClick={() => changeOpen(false)}>
                {t("cloud.continueLocally")}
              </Button>
            </div>
          )}
        </DialogPopup>
      </Dialog>
    </>
  );
}
