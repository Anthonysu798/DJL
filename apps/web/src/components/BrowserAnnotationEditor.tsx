import type { BrowserAnnotationAdjustments, BrowserAnnotationSelection } from "@synara/contracts";
import { useTranslation } from "react-i18next";

import { Button } from "./ui/button";
import { DisclosureRegion } from "./ui/DisclosureRegion";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

const ADJUSTMENT_FIELDS: ReadonlyArray<{
  key: Exclude<keyof BrowserAnnotationAdjustments, "textContent" | "opacity">;
  labelKey: string;
  placeholder: string;
}> = [
  { key: "color", labelKey: "color", placeholder: "#111827" },
  { key: "backgroundColor", labelKey: "background", placeholder: "#ffffff" },
  { key: "fontFamily", labelKey: "fontFamily", placeholder: "Inter, sans-serif" },
  { key: "fontSize", labelKey: "fontSize", placeholder: "16px" },
  { key: "fontWeight", labelKey: "fontWeight", placeholder: "600" },
  { key: "lineHeight", labelKey: "lineHeight", placeholder: "1.5" },
  { key: "letterSpacing", labelKey: "letterSpacing", placeholder: "0.01em" },
  { key: "textAlign", labelKey: "alignment", placeholder: "left" },
  { key: "margin", labelKey: "margin", placeholder: "8px 0" },
  { key: "padding", labelKey: "padding", placeholder: "12px 16px" },
  { key: "gap", labelKey: "gap", placeholder: "8px" },
  { key: "borderRadius", labelKey: "borderRadius", placeholder: "8px" },
];

export function BrowserAnnotationEditor(props: {
  selection: BrowserAnnotationSelection;
  comment: string;
  adjustments: BrowserAnnotationAdjustments;
  adjustmentsValid: boolean;
  adjustOpen: boolean;
  saving: boolean;
  onCommentChange: (comment: string) => void;
  onAdjustOpenChange: (open: boolean) => void;
  onAdjustmentsChange: (adjustments: BrowserAnnotationAdjustments) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation("workspace");
  const setAdjustment = <K extends keyof BrowserAnnotationAdjustments>(
    key: K,
    value: BrowserAnnotationAdjustments[K] | undefined,
  ) => {
    const next = { ...props.adjustments };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    props.onAdjustmentsChange(next);
  };

  return (
    <section
      aria-label={t("browser.annotation.editor")}
      className="absolute bottom-3 left-3 right-3 z-20 rounded-xl border border-border bg-popover/95 p-3 shadow-xl backdrop-blur"
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="truncate font-medium">
          {props.selection.target.kind === "element"
            ? `${props.selection.target.tagName} · ${props.selection.target.accessibleName || props.selection.target.textPreview || props.selection.target.selector}`
            : t("browser.annotation.selectedArea")}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {t("browser.annotation.saveShortcut")}
        </span>
      </div>
      <Textarea
        autoFocus
        aria-label={t("browser.annotation.comment")}
        value={props.comment}
        maxLength={10_000}
        placeholder={t("browser.annotation.commentPlaceholder")}
        className="min-h-20"
        onChange={(event) => props.onCommentChange(event.target.value)}
      />
      {props.selection.target.kind === "element" ? (
        <div className="mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={props.adjustOpen}
            onClick={() => props.onAdjustOpenChange(!props.adjustOpen)}
          >
            {t("browser.annotation.adjust")}
          </Button>
          <DisclosureRegion open={props.adjustOpen}>
            <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-border p-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <AdjustmentField
                  label={t("browser.annotation.fields.textContent")}
                  value={props.adjustments.textContent ?? ""}
                  placeholder={
                    props.selection.target.textPreview || t("browser.annotation.newText")
                  }
                  onChange={(value) => setAdjustment("textContent", value)}
                  onReset={() => setAdjustment("textContent", undefined)}
                />
                <AdjustmentField
                  label={t("browser.annotation.fields.opacity")}
                  value={props.adjustments.opacity?.toString() ?? ""}
                  placeholder="0–1"
                  type="number"
                  onChange={(value) =>
                    value === ""
                      ? setAdjustment("opacity", undefined)
                      : Number.isFinite(Number(value))
                        ? setAdjustment("opacity", Math.max(0, Math.min(1, Number(value))))
                        : undefined
                  }
                  onReset={() => setAdjustment("opacity", undefined)}
                />
                {ADJUSTMENT_FIELDS.map((field) => (
                  <AdjustmentField
                    key={field.key}
                    label={t(`browser.annotation.fields.${field.labelKey}`)}
                    value={props.adjustments[field.key] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(value) => setAdjustment(field.key, value)}
                    onReset={() => setAdjustment(field.key, undefined)}
                  />
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => props.onAdjustmentsChange({})}
              >
                {t("browser.annotation.resetAll")}
              </Button>
            </div>
          </DisclosureRegion>
          {!props.adjustmentsValid ? (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {t("browser.annotation.invalidAdjustments")}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={props.onCancel}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={props.saving || props.comment.trim().length === 0 || !props.adjustmentsValid}
          onClick={props.onSave}
        >
          {props.saving ? t("common:actions.saving") : t("common:actions.save")}
        </Button>
      </div>
    </section>
  );
}

function AdjustmentField(props: {
  label: string;
  value: string;
  placeholder: string;
  type?: "text" | "number";
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation("workspace");
  return (
    <label className="grid gap-1 text-[11px] text-muted-foreground">
      <span className="flex items-center justify-between gap-2">
        {props.label}
        <button
          type="button"
          className="hover:text-foreground"
          aria-label={t("browser.annotation.resetNamed", { name: props.label })}
          onClick={props.onReset}
        >
          {t("browser.annotation.reset")}
        </button>
      </span>
      <Input
        aria-label={props.label}
        type={props.type ?? "text"}
        min={props.type === "number" ? 0 : undefined}
        max={props.type === "number" ? 1 : undefined}
        step={props.type === "number" ? 0.05 : undefined}
        value={props.value}
        placeholder={props.placeholder}
        className="h-8 text-xs"
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}
