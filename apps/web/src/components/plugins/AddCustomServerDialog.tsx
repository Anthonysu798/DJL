// FILE: AddCustomServerDialog.tsx
// Purpose: The form for adding a tool server that is not in the directory, by its address.

import type { PluginCustomServerInput } from "@synara/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";

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

export function AddCustomServerDialog(props: {
  open: boolean;
  pending: boolean;
  /** Why the last attempt was refused, in the server's words. */
  error: string | undefined;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: PluginCustomServerInput) => void;
}) {
  const { t } = useTranslation("shell");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const ready = name.trim().length > 0 && url.trim().length > 0;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!props.pending) props.onOpenChange(open);
      }}
    >
      <DialogPopup surface="solid" className="max-w-lg" showCloseButton={!props.pending}>
        <DialogHeader>
          <DialogTitle>{t("pluginLibrary.addServer")}</DialogTitle>
          <DialogDescription>{t("pluginLibrary.addServerHint")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="add-custom-server"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!ready || props.pending) return;
              props.onSubmit({
                name: name.trim(),
                url: url.trim(),
                ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
              });
            }}
          >
            <label className="block space-y-2 text-xs font-medium">
              <span>{t("pluginLibrary.serverName")}</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={props.pending}
                autoComplete="off"
              />
            </label>
            <label className="block space-y-2 text-xs font-medium">
              <span>{t("pluginLibrary.serverUrl")}</span>
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
                disabled={props.pending}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </label>
            <label className="block space-y-2 text-xs font-medium">
              <span>{t("pluginLibrary.accessToken")}</span>
              <Input
                type="password"
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                disabled={props.pending}
                autoComplete="off"
              />
              <span className="block text-[11px] font-normal text-muted-foreground">
                {t("pluginLibrary.accessTokenHint")}
              </span>
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
          <Button type="submit" form="add-custom-server" disabled={!ready || props.pending}>
            {t("pluginLibrary.add")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
