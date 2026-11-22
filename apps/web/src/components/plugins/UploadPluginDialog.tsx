// FILE: UploadPluginDialog.tsx
// Purpose: Adds a personal plugin from a DJL plugin manifest, chosen as a file or pasted.

import { useRef, useState } from "react";
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
import { Textarea } from "../ui/textarea";

export function UploadPluginDialog(props: {
  open: boolean;
  pending: boolean;
  /** Why the manifest was refused; one wrong field per line. */
  error: string | undefined;
  onOpenChange: (open: boolean) => void;
  onSubmit: (manifest: string) => void;
}) {
  const { t } = useTranslation("shell");
  const fileInput = useRef<HTMLInputElement>(null);
  const [manifest, setManifest] = useState("");
  const [fileName, setFileName] = useState<string>();
  const ready = manifest.trim().length > 0;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!props.pending) props.onOpenChange(open);
      }}
    >
      <DialogPopup surface="solid" className="max-w-xl" showCloseButton={!props.pending}>
        <DialogHeader>
          <DialogTitle>{t("pluginLibrary.uploadPlugin")}</DialogTitle>
          <DialogDescription>{t("pluginLibrary.uploadPluginHint")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="upload-plugin"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && !props.pending) props.onSubmit(manifest);
            }}
          >
            <div className="flex items-center gap-3">
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setFileName(file.name);
                  // The text lands in the box below, so the user sees what is being added.
                  void file.text().then(setManifest);
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={props.pending}
                onClick={() => fileInput.current?.click()}
              >
                {t("pluginLibrary.chooseFile")}
              </Button>
              {fileName ? (
                <span className="min-w-0 truncate text-xs text-muted-foreground">{fileName}</span>
              ) : null}
            </div>
            <label className="block space-y-2 text-xs font-medium">
              <span>{t("pluginLibrary.manifestJson")}</span>
              <Textarea
                value={manifest}
                onChange={(event) => setManifest(event.target.value)}
                disabled={props.pending}
                spellCheck={false}
                className="min-h-48 font-mono text-xs"
                placeholder='{ "id": "my-plugin", "name": "my-plugin", "displayName": "My plugin", ... }'
              />
            </label>
            {props.error ? (
              <p role="alert" className="whitespace-pre-line text-sm text-destructive">
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
          <Button type="submit" form="upload-plugin" disabled={!ready || props.pending}>
            {t("pluginLibrary.addPlugin")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
