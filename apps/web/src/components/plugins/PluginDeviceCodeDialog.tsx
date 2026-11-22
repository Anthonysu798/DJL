// FILE: PluginDeviceCodeDialog.tsx
// Purpose: Guides a device sign-in (GitHub): the vendor's page is already open and the code is
//          already copied; the user pastes it, approves DJL, and this dialog turns connected
//          on its own.

import type { PluginAppConnection } from "@djl/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckIcon, CopyIcon, ExternalLinkIcon } from "~/lib/icons";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Stepper, StepperDescription, StepperItem, StepperTitle } from "../ui/stepper";

export function PluginDeviceCodeDialog(props: {
  appName: string;
  userCode: string;
  state: PluginAppConnection["state"] | undefined;
  /** Why the sign-in stopped, in the server's words. */
  message: string | undefined;
  retrying: boolean;
  onOpenPage: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("shell");
  const [copied, setCopied] = useState(false);
  const connected = props.state === "connected";
  const failed = props.state === "error" || props.state === "expired";

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup surface="solid" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("pluginLibrary.connectNamed", { name: props.appName })}</DialogTitle>
          <DialogDescription>
            {t("pluginLibrary.deviceHint", { name: props.appName })}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Stepper>
            <StepperItem step={1} state="done">
              <StepperTitle>{t("pluginLibrary.deviceStepCode")}</StepperTitle>
              <div className="mt-2 flex items-center gap-2">
                <code
                  className="rounded-lg border border-border bg-muted/50 px-3 py-1.5 font-mono text-lg font-semibold tracking-[0.2em] text-foreground select-all"
                  data-testid="plugin-device-code"
                >
                  {props.userCode}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(props.userCode)
                      .then(() => setCopied(true))
                      .catch(() => undefined)
                  }
                >
                  {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                  {copied ? t("pluginLibrary.codeCopied") : t("pluginLibrary.copyCode")}
                </Button>
              </div>
            </StepperItem>
            <StepperItem step={2} state={connected ? "done" : failed ? "error" : "loading"}>
              <StepperTitle>
                {t("pluginLibrary.deviceStepApprove", { name: props.appName })}
              </StepperTitle>
              <StepperDescription>
                {failed
                  ? (props.message ?? t("pluginLibrary.deviceFailed"))
                  : connected
                    ? t("pluginLibrary.deviceConnected", { name: props.appName })
                    : t("pluginLibrary.deviceWaiting")}
              </StepperDescription>
            </StepperItem>
          </Stepper>
        </DialogPanel>
        <DialogFooter>
          {connected ? (
            <Button type="button" onClick={props.onClose}>
              {t("pluginLibrary.done")}
            </Button>
          ) : failed ? (
            <>
              <Button type="button" variant="outline" onClick={props.onClose}>
                {t("pluginLibrary.close")}
              </Button>
              <Button type="button" disabled={props.retrying} onClick={props.onRetry}>
                {t("pluginLibrary.tryAgain")}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={props.onClose}>
                {t("pluginLibrary.close")}
              </Button>
              <Button type="button" onClick={props.onOpenPage}>
                <ExternalLinkIcon className="size-4" />
                {t("pluginLibrary.openNamed", { name: props.appName })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
