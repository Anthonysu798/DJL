// FILE: ThemePackEditor.tsx
// Purpose: Per-variant theme card matching the Codex appearance settings layout.
// Layer: Web settings UI
// Exports: ThemePackEditor

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { HexColorPicker } from "react-colorful";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Select, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import { toastManager } from "./ui/toast";
import { SettingsSelectPopup } from "./settings/SettingsPanelPrimitives";
import { SettingResetButton } from "./settings/SettingControls";
import { copyTextToClipboard } from "../hooks/useCopyToClipboard";
import { type ChromeTheme, type ThemeMode, type ThemeVariant, useTheme } from "../hooks/useTheme";
import { cn } from "../lib/utils";
import {
  SETTINGS_CARD_CLASS_NAME,
  SETTINGS_CARD_ROW_CLASS_NAME,
  SETTINGS_CONTROL_RADIUS_CLASS_NAME,
} from "../settingsPanelStyles";
import {
  CODE_THEME_OPTIONS,
  DEFAULT_THEME_STATE,
  getAvailableCodeThemes,
  getCodeThemeSeed,
  resolveThemePack,
} from "../theme/theme.logic";

type ThemePackEditorProps = {
  isActive?: boolean;
  mode?: ThemeMode;
  variant: ThemeVariant;
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const COLOR_PICKER_COMMIT_DELAY_MS = 220;

export function getThemePackEditorCopy(
  t: TFunction<"settings">,
  options: Pick<ThemePackEditorProps, "variant" | "isActive" | "mode">,
) {
  const translate = (key: string, values?: Record<string, string>) =>
    values === undefined ? t(key) : t(key, values);
  const variant = options.variant;
  const variantLabel = translate(`appearance.themeEditor.variants.${variant}`);
  const title = variantLabel.charAt(0).toLocaleUpperCase() + variantLabel.slice(1);
  const modeLabel =
    options.mode === "system"
      ? translate("appearance.themeEditor.modes.system")
      : translate(`appearance.themeEditor.variants.${options.mode}`);
  const status = options.isActive
    ? options.mode === "system"
      ? translate("appearance.themeEditor.status.systemActive", { variant: variantLabel })
      : translate("appearance.themeEditor.status.active")
    : options.mode === "system"
      ? translate("appearance.themeEditor.status.systemInactive", { variant: variantLabel })
      : translate("appearance.themeEditor.status.lockedInactive", { mode: modeLabel });
  const aria = {
    codeTheme: translate("appearance.themeEditor.aria.codeTheme", { variant: variantLabel }),
    accentColor: translate("appearance.themeEditor.aria.accentColor", { variant: variantLabel }),
    backgroundColor: translate("appearance.themeEditor.aria.backgroundColor", {
      variant: variantLabel,
    }),
    foregroundColor: translate("appearance.themeEditor.aria.foregroundColor", {
      variant: variantLabel,
    }),
    uiFont: translate("appearance.themeEditor.aria.uiFont", { variant: variantLabel }),
    codeFont: translate("appearance.themeEditor.aria.codeFont", { variant: variantLabel }),
    translucentSidebar: translate("appearance.themeEditor.aria.translucentSidebar", {
      variant: variantLabel,
    }),
    contrast: translate("appearance.themeEditor.aria.contrast", { variant: variantLabel }),
    resetColor: (label: string) => translate("appearance.themeEditor.aria.resetColor", { label }),
    hexValue: (label: string) => translate("appearance.themeEditor.aria.hexValue", { label }),
  };
  return {
    title,
    status,
    actions: {
      reset: translate("appearance.themeEditor.actions.reset"),
      import: translate("appearance.themeEditor.actions.import"),
      copy: translate("appearance.themeEditor.actions.copy"),
      cancel: translate("appearance.themeEditor.actions.cancel"),
    },
    rows: {
      accent: translate("appearance.themeEditor.rows.accent"),
      background: translate("appearance.themeEditor.rows.background"),
      foreground: translate("appearance.themeEditor.rows.foreground"),
      uiFont: translate("appearance.themeEditor.rows.uiFont"),
      codeFont: translate("appearance.themeEditor.rows.codeFont"),
      translucentSidebar: translate("appearance.themeEditor.rows.translucentSidebar"),
      contrast: translate("appearance.themeEditor.rows.contrast"),
    },
    aria,
    resetToDefault: translate("appearance.themeEditor.resetToDefault"),
    systemDefault: translate("appearance.themeEditor.systemDefault"),
    toast: {
      copiedTitle: translate("appearance.themeEditor.toast.copiedTitle"),
      copiedDescription: translate("appearance.themeEditor.toast.copiedDescription", {
        variant: variantLabel,
      }),
      copyFailedTitle: translate("appearance.themeEditor.toast.copyFailedTitle"),
      copyFailedDescription: translate("appearance.themeEditor.toast.copyFailedDescription"),
    },
    dialog: {
      title: translate("appearance.themeEditor.dialog.title", { variant: variantLabel }),
      description: translate("appearance.themeEditor.dialog.description", {
        variant: variantLabel,
        prefix: "codex-theme-v1:",
      }),
      placeholder: 'codex-theme-v1:{"codeThemeId":"linear",...}',
      shareStringAriaLabel: translate("appearance.themeEditor.dialog.shareStringAriaLabel"),
      error: translate("appearance.themeEditor.dialog.error"),
      importedTitle: translate("appearance.themeEditor.dialog.importedTitle"),
      importedDescription: translate("appearance.themeEditor.dialog.importedDescription", {
        variant: variantLabel,
      }),
    },
  };
}

export function ThemePackEditor({
  variant,
  isActive = false,
  mode = "system",
}: ThemePackEditorProps) {
  const { t } = useTranslation("settings");
  const copy = getThemePackEditorCopy(t, { variant, isActive, mode });
  const {
    darkTheme,
    lightTheme,
    exportThemeString,
    importThemeString,
    isDefaultThemePack,
    resetThemeVariant,
    setCodeThemeId,
    updateThemePack,
    updateThemeFonts,
  } = useTheme();

  const pack = variant === "dark" ? darkTheme : lightTheme;
  const theme = pack.theme;
  const defaultTheme = resolveThemePack(DEFAULT_THEME_STATE, variant).theme;
  const codeThemes = useMemo(() => {
    const options = getAvailableCodeThemes(variant);
    return options.map((option) => ({
      id: option.id,
      label: option.label,
      previewTheme: getCodeThemeSeed(option.id, variant),
      variants: option.variants,
    }));
  }, [variant]);
  const codeThemeLabel =
    CODE_THEME_OPTIONS.find((option) => option.id === pack.codeThemeId)?.label ?? pack.codeThemeId;
  const isPristine = isDefaultThemePack(variant);

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(exportThemeString(variant));
      toastManager.add({
        type: "success",
        title: copy.toast.copiedTitle,
        description: copy.toast.copiedDescription,
      });
    } catch {
      toastManager.add({
        type: "error",
        title: copy.toast.copyFailedTitle,
        description: copy.toast.copyFailedDescription,
      });
    }
  };

  const handleImport = (value: string) => {
    importThemeString(value, variant);
  };

  return (
    <div className={cn(SETTINGS_CARD_CLASS_NAME, "overflow-hidden")}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:py-3.5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{copy.title}</h3>
          {!isPristine ? (
            <button
              type="button"
              onClick={() => resetThemeVariant(variant)}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)]"
            >
              {copy.actions.reset}
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <ImportThemeDialog copy={copy} onImport={handleImport} />
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded-md px-2 py-1 text-xs text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)]"
          >
            {copy.actions.copy}
          </button>
          <Select
            value={pack.codeThemeId}
            onValueChange={(value) => {
              if (typeof value !== "string") return;
              setCodeThemeId(variant, value);
            }}
          >
            <SelectTrigger
              size="sm"
              className={cn(SETTINGS_CONTROL_RADIUS_CLASS_NAME, "ml-1 min-w-52 gap-2")}
              aria-label={copy.aria.codeTheme}
            >
              <SelectValue className="flex-1 text-left">
                <CodeThemeSelectOption label={codeThemeLabel} theme={theme} />
              </SelectValue>
            </SelectTrigger>
            <SettingsSelectPopup align="end" alignItemWithTrigger={false} className="p-1.5">
              {codeThemes.map((option) => (
                <SelectItem
                  hideIndicator
                  key={option.id}
                  value={option.id}
                  className={cn(SETTINGS_CONTROL_RADIUS_CLASS_NAME, "px-2 py-2")}
                >
                  <CodeThemeSelectOption label={option.label} theme={option.previewTheme} />
                </SelectItem>
              ))}
            </SettingsSelectPopup>
          </Select>
        </div>
      </div>
      <div className="border-b border-[color:var(--color-border)] px-4 pb-3 text-[11px] text-[var(--color-text-foreground-secondary)]">
        {copy.status}
      </div>

      <div className="divide-y divide-[color:var(--color-border)]">
        <ThemeRow label={copy.rows.accent}>
          <ColorPill
            color={theme.accent}
            ariaLabel={copy.aria.accentColor}
            resetAriaLabel={copy.aria.resetColor(copy.aria.accentColor)}
            resetTitle={copy.resetToDefault}
            hexValueAriaLabel={copy.aria.hexValue(copy.aria.accentColor)}
            onChange={(next) => updateThemePack(variant, { accent: next })}
            onReset={
              theme.accent !== defaultTheme.accent
                ? () =>
                    updateThemePack(variant, {
                      accent: defaultTheme.accent,
                    })
                : undefined
            }
          />
        </ThemeRow>

        <ThemeRow label={copy.rows.background}>
          <ColorPill
            color={theme.surface}
            ariaLabel={copy.aria.backgroundColor}
            resetAriaLabel={copy.aria.resetColor(copy.aria.backgroundColor)}
            resetTitle={copy.resetToDefault}
            hexValueAriaLabel={copy.aria.hexValue(copy.aria.backgroundColor)}
            onChange={(next) => updateThemePack(variant, { surface: next })}
            onReset={
              theme.surface !== defaultTheme.surface
                ? () =>
                    updateThemePack(variant, {
                      surface: defaultTheme.surface,
                    })
                : undefined
            }
          />
        </ThemeRow>

        <ThemeRow label={copy.rows.foreground}>
          <ColorPill
            color={theme.ink}
            ariaLabel={copy.aria.foregroundColor}
            resetAriaLabel={copy.aria.resetColor(copy.aria.foregroundColor)}
            resetTitle={copy.resetToDefault}
            hexValueAriaLabel={copy.aria.hexValue(copy.aria.foregroundColor)}
            onChange={(next) => updateThemePack(variant, { ink: next })}
            onReset={
              theme.ink !== defaultTheme.ink
                ? () =>
                    updateThemePack(variant, {
                      ink: defaultTheme.ink,
                    })
                : undefined
            }
          />
        </ThemeRow>

        <ThemeRow label={copy.rows.uiFont}>
          <div className="flex flex-col items-end gap-1">
            <FontInput
              value={theme.fonts.ui ?? ""}
              placeholder={copy.systemDefault}
              ariaLabel={copy.aria.uiFont}
              onChange={(next) => updateThemeFonts(variant, { ui: next.length > 0 ? next : null })}
            />
          </div>
        </ThemeRow>

        <ThemeRow label={copy.rows.codeFont}>
          <div className="flex flex-col items-end gap-1">
            <FontInput
              value={theme.fonts.code ?? ""}
              placeholder='"JetBrains Mono"'
              ariaLabel={copy.aria.codeFont}
              mono
              onChange={(next) =>
                updateThemeFonts(variant, { code: next.length > 0 ? next : null })
              }
            />
          </div>
        </ThemeRow>

        <ThemeRow label={copy.rows.translucentSidebar}>
          <Switch
            checked={!theme.opaqueWindows}
            onCheckedChange={(checked) => updateThemePack(variant, { opaqueWindows: !checked })}
            aria-label={copy.aria.translucentSidebar}
          />
        </ThemeRow>

        <ThemeRow label={copy.rows.contrast}>
          <ContrastSlider
            value={theme.contrast}
            onChange={(next) => updateThemePack(variant, { contrast: next })}
            ariaLabel={copy.aria.contrast}
          />
        </ThemeRow>
      </div>
    </div>
  );
}

// ── Row primitive ─────────────────────────────────────────────────────────

function ThemeRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        SETTINGS_CARD_ROW_CLASS_NAME,
        "flex min-h-12 items-center justify-between gap-3",
      )}
    >
      <span className="text-sm text-foreground/90">{label}</span>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

// ── Color pill ────────────────────────────────────────────────────────────

function ColorPill({
  color,
  ariaLabel,
  resetAriaLabel,
  resetTitle,
  hexValueAriaLabel,
  onChange,
  onReset,
}: {
  color: string;
  ariaLabel: string;
  resetAriaLabel: string;
  resetTitle: string;
  hexValueAriaLabel: string;
  onChange: (next: string) => void;
  onReset?: (() => void) | undefined;
}) {
  const commitTimerRef = useRef<number | null>(null);
  const pendingCommitRef = useRef<string | null>(null);
  const colorRef = useRef(color);
  const [draftHex, setDraftHex] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const normalizedDraftHex = draftHex?.trim().toLowerCase() ?? null;
  const previewColor =
    normalizedDraftHex && HEX_COLOR_RE.test(normalizedDraftHex) ? normalizedDraftHex : color;
  const inputValue = draftHex ?? color;
  const textColor = useReadableTextColor(previewColor);
  const ringColor = useReadableTextColor(previewColor, 0.32);

  useEffect(() => {
    colorRef.current = color;
    setDraftHex((current) => (current === color ? null : current));
  }, [color]);

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current === null) {
      return;
    }
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
  }, []);

  const commitColor = useCallback(
    (next: string | null = pendingCommitRef.current) => {
      clearCommitTimer();
      pendingCommitRef.current = null;
      if (!next || next === colorRef.current) {
        return;
      }
      onChange(next);
    },
    [clearCommitTimer, onChange],
  );

  const scheduleCommit = useCallback(
    (next: string) => {
      pendingCommitRef.current = next;
      clearCommitTimer();
      commitTimerRef.current = window.setTimeout(() => {
        commitColor(next);
      }, COLOR_PICKER_COMMIT_DELAY_MS);
    },
    [clearCommitTimer, commitColor],
  );

  useEffect(
    () => () => {
      clearCommitTimer();
    },
    [clearCommitTimer],
  );

  // Dragging updates only this local preview; the real theme store is committed
  // after a short idle delay so CSS-var projection stays smooth.
  const handleValidDraft = (next: string) => {
    const normalized = next.trim().toLowerCase();
    setDraftHex(normalized);
    scheduleCommit(normalized);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setIsOpen(nextOpen);
    if (!nextOpen) {
      commitColor();
      setDraftHex(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {onReset ? (
        <button
          type="button"
          onClick={() => {
            clearCommitTimer();
            pendingCommitRef.current = null;
            setDraftHex(null);
            onReset();
          }}
          className="rounded-md p-1 text-[var(--color-text-foreground-tertiary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)]"
          aria-label={resetAriaLabel}
          title={resetTitle}
        >
          <ResetGlyph />
        </button>
      ) : null}
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                SETTINGS_CONTROL_RADIUS_CLASS_NAME,
                "group relative flex h-8 min-w-44 items-center gap-2 overflow-hidden border px-2 pr-3 text-left transition-[transform,box-shadow] hover:scale-[1.005] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              )}
              // borderColor rides the readable color so a near-white fill still shows
              // a crisp edge against the (also near-white) settings card.
              style={{ backgroundColor: previewColor, color: textColor, borderColor: ringColor }}
              aria-label={ariaLabel}
            />
          }
        >
          <span
            aria-hidden
            className="block size-5 shrink-0 rounded-full border"
            style={{ borderColor: ringColor }}
          />
          <span className="font-system-ui flex-1 text-[12px] uppercase">{previewColor}</span>
        </PopoverTrigger>
        <PopoverPopup
          align="end"
          side="bottom"
          sideOffset={8}
          className="p-0 [&_[data-slot=popover-viewport]]:p-0"
        >
          <div className="theme-color-picker flex w-56 flex-col gap-3 p-3">
            <HexColorPicker color={previewColor} onChange={handleValidDraft} />
            <input
              type="text"
              value={inputValue}
              onChange={(event) => {
                const next = event.target.value;
                setDraftHex(next);
                if (HEX_COLOR_RE.test(next.trim())) {
                  handleValidDraft(next);
                }
              }}
              onBlur={() => {
                commitColor();
                setDraftHex(null);
              }}
              spellCheck={false}
              maxLength={7}
              className={cn(
                SETTINGS_CONTROL_RADIUS_CLASS_NAME,
                "h-8 border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] px-2 text-center font-chat-code text-xs uppercase outline-none focus:border-[color:var(--color-border-focus)]",
              )}
              aria-label={hexValueAriaLabel}
            />
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}

function CodeThemeBadge({ theme }: { theme: ChromeTheme }) {
  return (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold leading-none"
      style={{
        backgroundColor: theme.surface,
        borderColor: mixColor(theme.surface, theme.ink, 0.16),
        color: theme.accent,
      }}
    >
      Aa
    </span>
  );
}

function CodeThemeSelectOption({ label, theme }: { label: string; theme: ChromeTheme }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <CodeThemeBadge theme={theme} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-[var(--color-text-foreground)]">{label}</div>
      </div>
    </div>
  );
}

// ── Font input ────────────────────────────────────────────────────────────

function FontInput({
  value,
  placeholder,
  ariaLabel,
  mono = false,
  onChange,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  mono?: boolean;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      value={draft ?? value}
      placeholder={placeholder}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        onChange(next);
      }}
      onBlur={() => setDraft(null)}
      spellCheck={false}
      aria-label={ariaLabel}
      className={cn(SETTINGS_CONTROL_RADIUS_CLASS_NAME, "w-56", mono && "font-chat-code")}
    />
  );
}

// ── Slider ────────────────────────────────────────────────────────────────

function ContrastSlider({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  ariaLabel: string;
}) {
  const id = useId();
  const fillPct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={ariaLabel}
        className="theme-slider h-1.5 w-44 cursor-pointer appearance-none rounded-full bg-transparent focus-visible:outline-none"
        style={{
          background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${fillPct}%, var(--input) ${fillPct}%, var(--input) 100%)`,
        }}
      />
      <span className="w-7 text-right font-chat-code text-xs text-muted-foreground tabular-nums">
        {value}
      </span>
    </div>
  );
}

// ── Import dialog ─────────────────────────────────────────────────────────

function ImportThemeDialog({
  copy,
  onImport,
}: {
  copy: ReturnType<typeof getThemePackEditorCopy>;
  onImport: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    try {
      onImport(value);
      toastManager.add({
        type: "success",
        title: copy.dialog.importedTitle,
        description: copy.dialog.importedDescription,
      });
      setValue("");
      setError(null);
      setOpen(false);
    } catch {
      setError(copy.dialog.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)]"
          >
            {copy.actions.import}
          </button>
        }
      />
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.dialog.title}</DialogTitle>
          <p className="text-xs text-muted-foreground">{copy.dialog.description}</p>
        </DialogHeader>
        <DialogPanel>
          <Textarea
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            placeholder={copy.dialog.placeholder}
            spellCheck={false}
            rows={5}
            className="font-chat-code text-[11px]"
            aria-label={copy.dialog.shareStringAriaLabel}
          />
          {error ? <p className="mt-2 text-xs text-destructive-foreground">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" type="button" size="sm">
                {copy.actions.cancel}
              </Button>
            }
          />
          <Button
            type="button"
            size="sm"
            disabled={value.trim().length === 0}
            onClick={handleSubmit}
          >
            {copy.actions.import}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function ResetGlyph() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 10 9 10" />
    </svg>
  );
}

function useReadableTextColor(hex: string, alpha = 1): string {
  const rgb = parseHex(hex);
  if (!rgb) {
    return alpha === 1 ? "#ffffff" : `rgba(255,255,255,${alpha})`;
  }
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  if (luminance > 0.6) {
    return alpha === 1 ? "#1a1c1f" : `rgba(26,28,31,${alpha})`;
  }
  return alpha === 1 ? "#ffffff" : `rgba(255,255,255,${alpha})`;
}

function mixColor(fromHex: string, toHex: string, amount: number): string {
  const from = parseHex(fromHex);
  const to = parseHex(toHex);
  if (!from || !to) return fromHex;
  const clamped = Math.max(0, Math.min(1, amount));
  const r = Math.round(from.r + (to.r - from.r) * clamped);
  const g = Math.round(from.g + (to.g - from.g) * clamped);
  const b = Math.round(from.b + (to.b - from.b) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (!HEX_COLOR_RE.test(hex)) return null;
  const value = hex.slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}
