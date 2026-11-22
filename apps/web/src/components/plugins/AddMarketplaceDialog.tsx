// FILE: AddMarketplaceDialog.tsx
// Purpose: Adds a marketplace: a JSON list of plugin manifests served at an https address.

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

export function AddMarketplaceDialog(props: {
  open: boolean;
  pending: boolean;
  error: string | undefined;
  onOpenChange: (open: boolean) => void;
  onSubmit: (url: string) => void;
}) {
  const { t } = useTranslation("shell");
  const [url, setUrl] = useState("");
  const ready = url.trim().length > 0;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!props.pending) props.onOpenChange(open);
      }}
    >
      <DialogPopup surface="solid" className="max-w-lg" showCloseButton={!props.pending}>
        <DialogHeader>
          <DialogTitle>{t("pluginLibrary.addMarketplace")}</DialogTitle>
          <DialogDescription>{t("pluginLibrary.addMarketplaceHint")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="add-marketplace"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && !props.pending) props.onSubmit(url.trim());
            }}
          >
            <label className="block space-y-2 text-xs font-medium">
              <span>{t("pluginLibrary.marketplaceUrl")}</span>
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/plugins.json"
                disabled={props.pending}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
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
          <Button type="submit" form="add-marketplace" disabled={!ready || props.pending}>
            {t("pluginLibrary.add")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
