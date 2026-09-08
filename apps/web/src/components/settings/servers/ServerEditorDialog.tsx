// FILE: ServerEditorDialog.tsx
// Purpose: Add / edit dialog for a registered server with a live command preview.
// Layer: Settings UI components (servers)

import type { LocalKeyCandidate, ServerPermissionTier, ServerRecord } from "@synara/contracts";
import { useEffect, useId, useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { LoaderCircleIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { SegmentedControl } from "./SegmentedControl";
import {
  detectPrivateKeyType,
  emptyServerForm,
  formFromRecord,
  previewSshCommand,
  validateServerForm,
  type ServerFormErrors,
  type ServerFormValues,
} from "./serverPanelModel";

export type ServerEditorMode = { mode: "create" } | { mode: "edit"; record: ServerRecord };

export interface ServerEditorDialogProps {
  editor: ServerEditorMode | null;
  localKeys: ReadonlyArray<LocalKeyCandidate>;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: ServerFormValues, mode: ServerEditorMode) => void;
}

const AUTH_TYPES: ReadonlyArray<ServerFormValues["authType"]> = [
  "agent",
  "keyPath",
  "importedKey",
  "password",
];
const TIERS: ReadonlyArray<ServerPermissionTier> = ["read-only", "approve-each", "full"];
const TAG_PATTERN = /^[\p{L}\p{N}_-]{1,32}$/u;

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-[11px] text-destructive">
      {message}
    </p>
  );
}

function TagInput({
  tags,
  onChange,
  placeholder,
  removeLabel,
  invalid,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
  removeLabel: string;
  invalid: boolean;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const value = draft.trim();
    if (!value) return;
    if (!tags.includes(value)) onChange([...tags, value]);
    setDraft("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && draft.length === 0 && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };
  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-transparent px-2 py-1.5 sm:min-h-8",
        invalid ? "border-destructive/60" : "border-[color:var(--color-border)]",
      )}
    >
      {tags.map((tag) => (
        <Badge
          key={tag}
          variant="outline"
          className="servers-chip-enter gap-1 py-0 pr-1 pl-1.5 text-[11px] font-normal"
        >
          <span className={cn(!TAG_PATTERN.test(tag) && "text-destructive")}>{tag}</span>
          <button
            type="button"
            aria-label={`${removeLabel} ${tag}`}
            className="servers-press rounded-sm text-muted-foreground hover:text-[var(--color-text-foreground)]"
            onClick={() => onChange(tags.filter((item) => item !== tag))}
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        className="min-w-24 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
      />
    </div>
  );
}

function PreviewPane({ command, hint, title }: { command: string; hint: string; title: string }) {
  return (
    <aside className="space-y-2 rounded-lg border border-[color:var(--color-border)] bg-[var(--color-background-elevated-secondary)] p-3 md:sticky md:top-0">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <pre
        key={command}
        className="servers-fields-enter font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-[var(--color-text-foreground)]"
      >
        {command}
      </pre>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </aside>
  );
}

export function ServerEditorDialog({
  editor,
  localKeys,
  saving,
  onClose,
  onSubmit,
}: ServerEditorDialogProps) {
  const { t } = useTranslation("settings");
  const idPrefix = useId();
  const [values, setValues] = useState<ServerFormValues>(emptyServerForm);
  const [touched, setTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isEdit = editor?.mode === "edit";

  useEffect(() => {
    if (!editor) return;
    setValues(editor.mode === "edit" ? formFromRecord(editor.record) : emptyServerForm());
    setTouched(false);
    setShowPassword(false);
  }, [editor]);

  const errors: ServerFormErrors = useMemo(
    () => validateServerForm(values, isEdit ? "edit" : "create"),
    [values, isEdit],
  );
  const hasErrors = Object.keys(errors).length > 0;
  const visibleErrors = touched ? errors : {};
  const set = <K extends keyof ServerFormValues>(key: K, value: ServerFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const errorText = (key: keyof ServerFormErrors) => {
    const code = visibleErrors[key];
    return code ? t(`servers.errors.${code}`) : undefined;
  };

  const keyType = values.privateKey ? detectPrivateKeyType(values.privateKey) : null;
  const preview = previewSshCommand(values);

  const submit = () => {
    setTouched(true);
    if (hasErrors || !editor) return;
    onSubmit(values, editor);
  };

  const readKeyFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") set("privateKey", reader.result);
    });
    reader.readAsText(file);
    event.target.value = "";
  };

  const authOptions = AUTH_TYPES.map((value) => ({
    value,
    label: t(`servers.form.auth.${value}`),
  }));
  const tierOptions = TIERS.map((value) => ({ value, label: t(`servers.tier.${value}`) }));
  const keyListId = `${idPrefix}-keys`;

  return (
    <Dialog open={editor !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogPopup className="max-w-2xl gap-0 p-0">
        <DialogHeader className="gap-1 p-4 pr-12">
          <DialogTitle className="text-base">
            {isEdit ? t("servers.form.editTitle") : t("servers.form.addTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs">{t("servers.subtitle")}</DialogDescription>
        </DialogHeader>

        <DialogPanel className="max-h-[min(70vh,640px)] px-4 py-3">
          <form
            className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            noValidate
          >
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-name`}>{t("servers.form.name")}</Label>
                <Input
                  id={`${idPrefix}-name`}
                  value={values.name}
                  aria-invalid={Boolean(errorText("name"))}
                  onChange={(event) => set("name", event.target.value)}
                />
                <FieldError id={`${idPrefix}-name-error`} message={errorText("name")} />
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
                <div className="grid gap-2">
                  <Label htmlFor={`${idPrefix}-host`}>{t("servers.form.host")}</Label>
                  <Input
                    id={`${idPrefix}-host`}
                    value={values.host}
                    placeholder="203.0.113.10"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={Boolean(errorText("host"))}
                    onChange={(event) => set("host", event.target.value)}
                  />
                  <FieldError id={`${idPrefix}-host-error`} message={errorText("host")} />
                  {!errorText("host") ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t("servers.form.hostHint")}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${idPrefix}-port`}>{t("servers.form.port")}</Label>
                  <Input
                    id={`${idPrefix}-port`}
                    inputMode="numeric"
                    value={values.port}
                    className="font-mono"
                    aria-invalid={Boolean(errorText("port"))}
                    onChange={(event) => set("port", event.target.value)}
                  />
                  <FieldError id={`${idPrefix}-port-error`} message={errorText("port")} />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-user`}>{t("servers.form.username")}</Label>
                <Input
                  id={`${idPrefix}-user`}
                  value={values.username}
                  placeholder="root"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  aria-invalid={Boolean(errorText("username"))}
                  onChange={(event) => set("username", event.target.value)}
                />
                <FieldError id={`${idPrefix}-user-error`} message={errorText("username")} />
              </div>

              <div className="grid gap-2">
                <Label>{t("servers.form.authLabel")}</Label>
                <SegmentedControl
                  value={values.authType}
                  options={authOptions}
                  onChange={(authType) => set("authType", authType)}
                  ariaLabel={t("servers.form.authLabel")}
                />
                <div key={values.authType} className="servers-fields-enter grid gap-3 pt-1">
                  {values.authType === "agent" ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t("servers.form.auth.agentHint")}
                    </p>
                  ) : null}
                  {values.authType === "keyPath" ? (
                    <>
                      <div className="grid gap-2">
                        <Label htmlFor={`${idPrefix}-keypath`}>{t("servers.form.keyPath")}</Label>
                        <Input
                          id={`${idPrefix}-keypath`}
                          list={keyListId}
                          value={values.keyPath}
                          placeholder={t("servers.form.keyPathPlaceholder")}
                          spellCheck={false}
                          className="font-mono"
                          aria-invalid={Boolean(errorText("keyPath"))}
                          onChange={(event) => set("keyPath", event.target.value)}
                        />
                        <datalist id={keyListId}>
                          {localKeys.map((key) => (
                            <option key={key.path} value={key.path}>
                              {key.label}
                            </option>
                          ))}
                        </datalist>
                        <FieldError
                          id={`${idPrefix}-keypath-error`}
                          message={errorText("keyPath")}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`${idPrefix}-passphrase`}>
                          {t("servers.form.passphrase")}
                        </Label>
                        <Input
                          id={`${idPrefix}-passphrase`}
                          type="password"
                          autoComplete="off"
                          value={values.passphrase}
                          onChange={(event) => set("passphrase", event.target.value)}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          {isEdit && values.keepPassphrase && !values.passphrase
                            ? t("servers.form.passphraseKeep")
                            : t("servers.form.passphraseHint")}
                        </p>
                      </div>
                    </>
                  ) : null}
                  {values.authType === "importedKey" ? (
                    <>
                      <div className="grid gap-2">
                        <Label htmlFor={`${idPrefix}-key`}>{t("servers.form.importKey")}</Label>
                        <label
                          className={cn(
                            "flex cursor-pointer flex-col gap-2 rounded-lg border border-dashed p-3 text-[11px] text-muted-foreground transition-colors hover:border-primary/50",
                            errorText("privateKey")
                              ? "border-destructive/60"
                              : "border-[color:var(--color-border)]",
                          )}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const file = event.dataTransfer.files?.[0];
                            if (!file) return;
                            void file.text().then((text) => set("privateKey", text));
                          }}
                        >
                          <span>{t("servers.form.importKeyDrop")}</span>
                          <span className="flex items-center gap-2">
                            <span className="rounded-md border border-[color:var(--color-border)] px-2 py-1 text-[var(--color-text-foreground)]">
                              {t("servers.form.importKeyChoose")}
                            </span>
                            {keyType ? (
                              <Badge variant="success" className="py-0 text-[10px] font-normal">
                                {t("servers.form.importKeyDetected", { type: keyType })}
                              </Badge>
                            ) : null}
                            {isEdit && values.keepPrivateKey && !values.privateKey ? (
                              <span>{t("servers.form.importKeyKeep")}</span>
                            ) : null}
                          </span>
                          <input type="file" className="sr-only" onChange={readKeyFile} />
                        </label>
                        <Textarea
                          id={`${idPrefix}-key`}
                          rows={4}
                          spellCheck={false}
                          value={values.privateKey}
                          className="min-w-0 font-mono text-[11px] break-all"
                          placeholder={t("servers.form.importKeyPlaceholder")}
                          onChange={(event) => set("privateKey", event.target.value)}
                        />
                        <FieldError
                          id={`${idPrefix}-key-error`}
                          message={errorText("privateKey")}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`${idPrefix}-passphrase2`}>
                          {t("servers.form.passphrase")}
                        </Label>
                        <Input
                          id={`${idPrefix}-passphrase2`}
                          type="password"
                          autoComplete="off"
                          value={values.passphrase}
                          onChange={(event) => set("passphrase", event.target.value)}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          {t("servers.form.passphraseHint")}
                        </p>
                      </div>
                    </>
                  ) : null}
                  {values.authType === "password" ? (
                    <div className="grid gap-2">
                      <Label htmlFor={`${idPrefix}-password`}>{t("servers.form.password")}</Label>
                      <div className="flex gap-2">
                        <Input
                          id={`${idPrefix}-password`}
                          type={showPassword ? "text" : "password"}
                          autoComplete="off"
                          value={values.password}
                          aria-invalid={Boolean(errorText("password"))}
                          onChange={(event) => set("password", event.target.value)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="servers-press"
                          onClick={() => setShowPassword((value) => !value)}
                        >
                          {showPassword ? t("servers.actions.hide") : t("servers.actions.reveal")}
                        </Button>
                      </div>
                      <FieldError
                        id={`${idPrefix}-password-error`}
                        message={errorText("password")}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        {isEdit && values.keepPassword && !values.password
                          ? t("servers.form.passwordKeep")
                          : t("servers.form.passwordHint")}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2">
                <Label>{t("servers.form.tags")}</Label>
                <TagInput
                  tags={values.tags}
                  onChange={(tags) => set("tags", tags)}
                  placeholder={t("servers.form.tagsPlaceholder")}
                  removeLabel={t("servers.actions.remove")}
                  invalid={Boolean(errorText("tags"))}
                />
                <FieldError id={`${idPrefix}-tags-error`} message={errorText("tags")} />
              </div>

              <div className="grid gap-2">
                <Label>{t("servers.form.tier")}</Label>
                <SegmentedControl
                  value={values.permissionTier}
                  options={tierOptions}
                  onChange={(permissionTier) => set("permissionTier", permissionTier)}
                  ariaLabel={t("servers.form.tier")}
                />
                <p
                  key={values.permissionTier}
                  className="servers-fields-enter text-[11px] text-muted-foreground"
                >
                  {t(`servers.tier.hint.${values.permissionTier}`)}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-notes`}>{t("servers.form.notes")}</Label>
                <Textarea
                  id={`${idPrefix}-notes`}
                  rows={2}
                  value={values.notes}
                  onChange={(event) => set("notes", event.target.value)}
                />
              </div>
            </div>

            <PreviewPane
              title={t("servers.form.preview")}
              hint={t("servers.form.previewHint")}
              command={preview}
            />
          </form>
        </DialogPanel>

        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            className="servers-press"
            onClick={onClose}
            disabled={saving}
          >
            {t("servers.actions.cancel")}
          </Button>
          <Button
            size="sm"
            className="servers-press min-w-24"
            onClick={submit}
            disabled={saving || (touched && hasErrors)}
          >
            {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
            {isEdit ? t("servers.actions.saveChanges") : t("servers.actions.save")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
