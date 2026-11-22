// FILE: CreateSkillDialog.tsx
// Purpose: The form for writing a new skill: a name, when to use it, and the instructions.

import type { PluginCreateSkillInput } from "@synara/contracts";
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
import { Textarea } from "../ui/textarea";

export function CreateSkillDialog(props: {
  open: boolean;
  pending: boolean;
  error: string | undefined;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: PluginCreateSkillInput) => void;
}) {
  const { t } = useTranslation("shell");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const ready = [name, description, instructions].every((value) => value.trim().length > 0);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!props.pending) props.onOpenChange(open);
      }}
    >
      <DialogPopup surface="solid" className="max-w-xl" showCloseButton={!props.pending}>
        <DialogHeader>
          <DialogTitle>{t("pluginLibrary.createSkill")}</DialogTitle>
          <DialogDescription>{t("pluginLibrary.createSkillHint")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="create-skill"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!ready || props.pending) return;
              props.onSubmit({
                name: name.trim(),
                description: description.trim(),
                instructions: instructions.trim(),
              });
            }}
          >
            <label className="block space-y-2 text-xs font-medium">
              <span>{t("pluginLibrary.serverName")}</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="release-notes"
                disabled={props.pending}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="block space-y-2 text-xs font-medium">
              <span>{t("pluginLibrary.skillWhen")}</span>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={props.pending}
                autoComplete="off"
              />
            </label>
            <label className="block space-y-2 text-xs font-medium">
              <span>{t("pluginLibrary.skillInstructions")}</span>
              <Textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                disabled={props.pending}
                rows={9}
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
          <Button type="submit" form="create-skill" disabled={!ready || props.pending}>
            {t("pluginLibrary.createSkill")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
