// FILE: ServerEditorDialog.tsx
// Purpose: Add / edit dialog for a registered server: label-left form rows, choice cards, command preview.
// Layer: Settings UI components (servers)

import type { LocalKeyCandidate, ServerPermissionTier, ServerRecord } from "@synara/contracts";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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
import { Textarea } from "~/components/ui/textarea";
import { CentralIcon } from "~/lib/central-icons";
import { LoaderCircleIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

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

const AUTH_TYPES: ReadonlyArray<{ value: ServerFormValues["authType"]; icon: string }> = [
  { value: "agent", icon: "console" },
  { value: "keyPath", icon: "key-1" },
  { value: "importedKey", icon: "file-lock" },
  { value: "password", icon: "keyhole" },
];
const TIERS: ReadonlyArray<ServerPermissionTier> = ["read-only", "approve-each", "full"];
const TAG_PATTERN = /^[\p{L}\p{N}_-]{1,32}$/u;

/** One form row: label and helper on the left, control on the right (stacked below `md`). */
function FormRow({
  label,
  hint,
  htmlFor,
  children,
  error,
  errorId,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  error?: string | undefined;
  errorId?: string;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-x-8">
      <div className="space-y-0.5 md:pt-2">
        <label
          htmlFor={htmlFor}
          className="block text-[13px] font-medium text-[var(--color-text-foreground)]"
        >
          {label}
        </label>
        {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="min-w-0 space-y-1.5">
        {children}
        {error ? (
          <p id={errorId} role="alert" className="text-[11px] text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ChoiceCard({
  selected,
  icon,
  label,
  onClick,
}: {
  selected: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "servers-press flex min-h-[4.25rem] flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs transition-[border-color,background-color,color,box-shadow] duration-150",
        selected
          ? "border-[var(--color-text-foreground)] bg-[var(--color-background-elevated-primary-opaque)] text-[var(--color-text-foreground)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
          : "border-[color:var(--color-border)] bg-transparent text-muted-foreground hover:border-[color:var(--color-border-focus)] hover:text-[var(--color-text-foreground)]",
      )}
    >
      <CentralIcon name={icon} className="size-4" />
      <span className="font-medium">{label}</span>
    </button>
  );
}

function RadioRow({
  selected,
  label,
  hint,
  onClick,
}: {
  selected: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="servers-press flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--color-background-elevated-secondary)]"
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected ? "border-[var(--color-text-foreground)]" : "border-[color:var(--color-border)]",
        )}
      >
        <span
          className={cn(
            "size-2 rounded-full bg-[var(--color-text-foreground)] transition-transform duration-150",
            selected ? "scale-100" : "scale-0",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] text-[var(--color-text-foreground)]">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </button>
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
    const value = draft.trim().replace(/,+$/, "");
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

  const keyListId = `${idPrefix}-keys`;
  const id = (suffix: string) => `${idPrefix}-${suffix}`;

  return (
    <Dialog open={editor !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogPopup className="max-w-3xl gap-0 p-0">
        <DialogHeader className="gap-1 px-6 pt-5 pb-4 pr-12">
          <DialogTitle className="text-base">
            {isEdit ? t("servers.form.editTitle") : t("servers.form.addTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs">{t("servers.subtitle")}</DialogDescription>
        </DialogHeader>

        <DialogPanel className="max-h-[min(72vh,680px)] border-t border-[color:var(--color-border)] px-6 py-5">
          <form
            className="space-y-6"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <FormRow
              label={t("servers.form.name")}
              hint={t("servers.form.nameHint")}
              htmlFor={id("name")}
              error={errorText("name")}
              errorId={id("name-error")}
            >
              <Input
                id={id("name")}
                value={values.name}
                aria-invalid={Boolean(errorText("name"))}
                onChange={(event) => set("name", event.target.value)}
              />
            </FormRow>

            <FormRow
              label={t("servers.form.host")}
              hint={t("servers.form.hostHint")}
              htmlFor={id("host")}
              error={errorText("host") ?? errorText("port")}
              errorId={id("host-error")}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
                <Input
                  id={id("host")}
                  value={values.host}
                  placeholder="203.0.113.10"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errorText("host"))}
                  onChange={(event) => set("host", event.target.value)}
                />
                <Input
                  id={id("port")}
                  aria-label={t("servers.form.port")}
                  inputMode="numeric"
                  value={values.port}
                  className="font-mono"
                  aria-invalid={Boolean(errorText("port"))}
                  onChange={(event) => set("port", event.target.value)}
                />
              </div>
            </FormRow>

            <FormRow
              label={t("servers.form.username")}
              hint={t("servers.form.usernameHint")}
              htmlFor={id("user")}
              error={errorText("username")}
              errorId={id("user-error")}
            >
              <Input
                id={id("user")}
                value={values.username}
                placeholder="root"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                aria-invalid={Boolean(errorText("username"))}
                onChange={(event) => set("username", event.target.value)}
              />
            </FormRow>

            <FormRow label={t("servers.form.authLabel")} hint={t("servers.form.authHint")}>
              <div
                role="radiogroup"
                aria-label={t("servers.form.authLabel")}
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {AUTH_TYPES.map((option) => (
                  <ChoiceCard
                    key={option.value}
                    selected={values.authType === option.value}
                    icon={option.icon}
                    label={t(`servers.form.auth.${option.value}`)}
                    onClick={() => set("authType", option.value)}
                  />
                ))}
              </div>
              <div key={values.authType} className="servers-fields-enter space-y-4 pt-2">
                <p className="text-[11px] text-muted-foreground">
                  {t(`servers.form.auth.${values.authType}Hint`)}
                </p>
                {values.authType === "keyPath" ? (
                  <>
                    <div className="space-y-1.5">
                      <label
                        htmlFor={id("keypath")}
                        className="block text-xs text-[var(--color-text-foreground)]"
                      >
                        {t("servers.form.keyPath")}
                      </label>
                      <Input
                        id={id("keypath")}
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
                      {errorText("keyPath") ? (
                        <p role="alert" className="text-[11px] text-destructive">
                          {errorText("keyPath")}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor={id("passphrase")}
                        className="block text-xs text-[var(--color-text-foreground)]"
                      >
                        {t("servers.form.passphrase")}
                      </label>
                      <Input
                        id={id("passphrase")}
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
                    <div className="space-y-1.5">
                      <label
                        htmlFor={id("key")}
                        className="block text-xs text-[var(--color-text-foreground)]"
                      >
                        {t("servers.form.importKey")}
                      </label>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2.5 text-[11px] text-muted-foreground transition-colors hover:border-[color:var(--color-border-focus)]",
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
                        <span className="flex items-center gap-2">
                          <CentralIcon name="cloud-upload" className="size-4" />
                          <span>{t("servers.form.importKeyDrop")}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {keyType ? (
                            <Badge variant="success" className="py-0 text-[10px] font-normal">
                              {t("servers.form.importKeyDetected", { type: keyType })}
                            </Badge>
                          ) : null}
                          {isEdit && values.keepPrivateKey && !values.privateKey ? (
                            <span>{t("servers.form.importKeyKeep")}</span>
                          ) : null}
                          <span className="rounded-md border border-[color:var(--color-border)] px-2 py-1 text-[var(--color-text-foreground)]">
                            {t("servers.form.importKeyChoose")}
                          </span>
                        </span>
                        <input type="file" className="sr-only" onChange={readKeyFile} />
                      </label>
                      <Textarea
                        id={id("key")}
                        rows={4}
                        spellCheck={false}
                        value={values.privateKey}
                        className="min-w-0 font-mono text-[11px] break-all"
                        placeholder={t("servers.form.importKeyPlaceholder")}
                        onChange={(event) => set("privateKey", event.target.value)}
                      />
                      {errorText("privateKey") ? (
                        <p role="alert" className="text-[11px] text-destructive">
                          {errorText("privateKey")}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor={id("passphrase2")}
                        className="block text-xs text-[var(--color-text-foreground)]"
                      >
                        {t("servers.form.passphrase")}
                      </label>
                      <Input
                        id={id("passphrase2")}
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
                  <div className="space-y-1.5">
                    <label
                      htmlFor={id("password")}
                      className="block text-xs text-[var(--color-text-foreground)]"
                    >
                      {t("servers.form.password")}
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id={id("password")}
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
                    {errorText("password") ? (
                      <p role="alert" className="text-[11px] text-destructive">
                        {errorText("password")}
                      </p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      {isEdit && values.keepPassword && !values.password
                        ? t("servers.form.passwordKeep")
                        : t("servers.form.passwordHint")}
                    </p>
                  </div>
                ) : null}
              </div>
            </FormRow>

            <FormRow
              label={t("servers.form.tags")}
              hint={t("servers.form.tagsHint")}
              error={errorText("tags")}
              errorId={id("tags-error")}
            >
              <TagInput
                tags={values.tags}
                onChange={(tags) => set("tags", tags)}
                placeholder={t("servers.form.tagsPlaceholder")}
                removeLabel={t("servers.actions.remove")}
                invalid={Boolean(errorText("tags"))}
              />
            </FormRow>

            <FormRow label={t("servers.form.tier")} hint={t("servers.form.tierHint")}>
              <div
                role="radiogroup"
                aria-label={t("servers.form.tier")}
                className="-mx-2 space-y-0.5"
              >
                {TIERS.map((tier) => (
                  <RadioRow
                    key={tier}
                    selected={values.permissionTier === tier}
                    label={t(`servers.tier.${tier}`)}
                    hint={t(`servers.tier.hint.${tier}`)}
                    onClick={() => set("permissionTier", tier)}
                  />
                ))}
              </div>
            </FormRow>

            <FormRow
              label={t("servers.form.notes")}
              hint={t("servers.form.notesHint")}
              htmlFor={id("notes")}
            >
              <Textarea
                id={id("notes")}
                rows={2}
                value={values.notes}
                onChange={(event) => set("notes", event.target.value)}
              />
            </FormRow>

            <div className="rounded-lg border border-[color:var(--color-border)] bg-[var(--color-background-elevated-secondary)] px-3 py-2.5">
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                {t("servers.form.preview")}
              </p>
              <pre
                key={preview}
                className="servers-fields-enter mt-1 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-[var(--color-text-foreground)]"
              >
                {preview}
              </pre>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("servers.form.previewHint")}
              </p>
            </div>
          </form>
        </DialogPanel>

        <DialogFooter className="border-t border-[color:var(--color-border)] px-6 py-4">
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
