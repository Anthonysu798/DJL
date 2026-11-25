// FILE: HomeStarter.tsx
// Purpose: The new-chat start screen's helpers: the Work / Code switch, topic chips, and the
//          suggested prompts a topic opens. Hovering a suggestion previews it in the message
//          box; choosing one fills it in.
// Layer: Home presentation (state lives in ChatView).

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ArrowUpRightIcon, BriefcaseIcon, CodeIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

export type HomeMode = "work" | "code";

/** Topics per mode, in the order they appear. Keys live under `chat.home.topics`. */
export const HOME_TOPICS: Record<HomeMode, readonly string[]> = {
  work: ["documents", "data", "slides", "research", "email", "planning"],
  code: ["websites", "apps", "fixes", "automation", "review", "docs"],
};

const SUGGESTION_KEYS = ["s1", "s2", "s3", "s4"] as const;

export interface HomeSuggestion {
  readonly label: string;
  readonly prompt: string;
}

export function useHomeSuggestions(topic: string | null): HomeSuggestion[] {
  const { t } = useTranslation("chat");
  if (!topic) return [];
  return SUGGESTION_KEYS.map((key) => ({
    label: t(`home.topics.${topic}.suggestions.${key}.label` as never),
    prompt: t(`home.topics.${topic}.suggestions.${key}.prompt` as never),
  }));
}

/** Work / Code switch: a glass pill with a thumb that slides to the chosen side. */
export function HomeModeToggle(props: {
  mode: HomeMode;
  onChange: (mode: HomeMode) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("chat");
  const rowRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const button = rowRef.current?.querySelector<HTMLElement>(`[data-mode="${props.mode}"]`);
    if (button) setThumb({ left: button.offsetLeft, width: button.offsetWidth });
  }, [props.mode]);

  const option = (mode: HomeMode, label: string, Icon: typeof CodeIcon) => (
    <button
      type="button"
      role="radio"
      data-mode={mode}
      aria-checked={props.mode === mode}
      disabled={props.disabled}
      onClick={() => props.mode !== mode && props.onChange(mode)}
      className={cn(
        "home-mode-option relative z-10 inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-[color,transform] duration-200 active:scale-[0.97] disabled:active:scale-100",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-accent)]",
        props.mode === mode ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon aria-hidden="true" className="home-mode-icon size-4" />
      {label}
    </button>
  );

  return (
    <div
      ref={rowRef}
      role="radiogroup"
      aria-label={t("home.modeLabel")}
      data-onboarding-target="work-mode"
      className="home-mode-toggle relative inline-flex items-center rounded-full p-1"
    >
      {thumb ? (
        <span
          aria-hidden="true"
          className="home-mode-thumb pointer-events-none absolute inset-y-1 rounded-full"
          style={{ width: thumb.width, transform: `translateX(${thumb.left - 4}px)` }}
        />
      ) : null}
      {option("work", t("home.modes.work"), BriefcaseIcon)}
      {option("code", t("home.modes.code"), CodeIcon)}
    </div>
  );
}

/** Topic chips: choosing one opens its suggestions; choosing it again closes them. */
export function HomeTopicChips(props: {
  mode: HomeMode;
  topic: string | null;
  onTopicChange: (topic: string | null) => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <div key={props.mode} className="home-chips flex min-w-0 flex-wrap items-center gap-2">
      {HOME_TOPICS[props.mode].map((topic, index) => {
        const active = props.topic === topic;
        return (
          <button
            key={topic}
            type="button"
            aria-pressed={active}
            onClick={() => props.onTopicChange(active ? null : topic)}
            style={{ animationDelay: `${index * 30}ms` }}
            className={cn(
              "home-chip h-8 shrink-0 rounded-full px-3.5 text-[13px] transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-accent)]",
              active
                ? "bg-foreground text-background shadow-sm"
                : "home-chip-idle text-foreground/80 hover:text-foreground",
            )}
          >
            {t(`home.topics.${topic}.label` as never)}
          </button>
        );
      })}
    </div>
  );
}

/** The suggested prompts for a topic, under the message box. */
export function HomeSuggestions(props: {
  topic: string;
  suggestions: readonly HomeSuggestion[];
  onPreview: (prompt: string | null) => void;
  onPick: (prompt: string) => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <ul
      key={props.topic}
      aria-label={t("home.suggestionsLabel", {
        topic: t(`home.topics.${props.topic}.label` as never),
      })}
      className="flex flex-col items-start gap-2 pt-5"
      onMouseLeave={() => props.onPreview(null)}
    >
      {props.suggestions.map((suggestion, index) => (
        <li
          key={suggestion.label}
          className="home-suggestion"
          style={{ animationDelay: `${40 + index * 45}ms` }}
        >
          <button
            type="button"
            onMouseEnter={() => props.onPreview(suggestion.prompt)}
            onFocus={() => props.onPreview(suggestion.prompt)}
            onBlur={() => props.onPreview(null)}
            onClick={() => props.onPick(suggestion.prompt)}
            className={cn(
              "group/suggestion home-suggestion-button inline-flex max-w-full items-center gap-2 rounded-full px-4 py-2 text-start text-[13px] text-foreground/85 transition-[background-color,color,transform,box-shadow] duration-150 hover:text-foreground active:scale-[0.98]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-accent)]",
            )}
          >
            <span className="min-w-0 truncate">{suggestion.label}</span>
            <ArrowUpRightIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover/suggestion:-translate-y-0.5 group-hover/suggestion:translate-x-0.5 group-hover/suggestion:text-foreground motion-reduce:transition-none"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
