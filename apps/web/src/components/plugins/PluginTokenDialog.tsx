// FILE: PluginTokenDialog.tsx
// Purpose: Connects an app that takes a personal access token instead of a browser sign-in.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ExternalLinkIcon } from "~/lib/icons";
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
import { Input } from "../ui/input";

export function PluginTokenDialog(props: {
  open: boolean;
  appName: string;
  /** The vendor page where the token is created. */
  tokenUrl: string | undefined;
  tokenScopes: ReadonlyArray<string> | undefined;
  pending: boolean;
  /** Why the last token was refused, in the server's words. */
  error: string | undefined;
  onOpenChange: (open: boolean) => void;
  onOpenLink: (url: string) => void;
  onSubmit: (token: string) => void;
}) {
  const { t } = useTranslation("shell");
  const [token, setToken] = useState("");
  const ready = token.trim().length > 0;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!props.pending) props.onOpenChange(open);
      }}
    >
      <DialogPopup surface="solid" className="max-w-lg" showCloseButton={!props.pending}>
        <DialogHeader>
          <DialogTitle>{t("pluginLibrary.connectNamed", { name: props.appName })}</DialogTitle>
          <DialogDescription>
            {t("pluginLibrary.tokenHint", { name: props.appName })}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="plugin-token"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && !props.pending) props.onSubmit(token.trim());
            }}
          >
            {props.tokenUrl ? (
              <div className="space-y-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => props.onOpenLink(props.tokenUrl!)}
                >
                  <ExternalLinkIcon className="size-4" />
                  {t("pluginLibrary.createToken")}
                </Button>
                {props.tokenScopes?.length ? (
                  <p className="text-xs text-muted-foreground">
                    {t("pluginLibrary.tokenScopes", { scopes: props.tokenScopes.join(", ") })}
                  </p>
                ) : null}
              </div>
            ) : null}
            <label className="block space-y-2 text-xs font-medium">
              <span>{t("pluginLibrary.tokenLabel")}</span>
              <Input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                disabled={props.pending}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {props.error ? (
              <p role="alert" className="text-sm text-destructive">
                {props.error}
              </p>
            ) : null}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={props.pending}
            onClick={() => props.onOpenChange(false)}
          >
            {t("pluginLibrary.close")}
          </Button>
          <Button type="submit" form="plugin-token" disabled={!ready || props.pending}>
            {t("pluginLibrary.connect")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
