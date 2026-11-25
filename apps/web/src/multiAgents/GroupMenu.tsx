// FILE: GroupMenu.tsx
// Purpose: The one dropdown Multi agents uses for picking a value (a member's model, who gets
//          messages, who reviews): a small glass chip that opens a liquid-glass menu with roomy
//          rows, an optional identity header, a search box for long lists, and a check on the
//          current choice. The chip flashes a check when the value changes.
// Layer: UI component

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

/** Roomy liquid-glass rows; see `.djl-group-menu` in index.css. */
export const GROUP_MENU_CLASS = "djl-group-menu";
const SEARCH_FROM = 9;
// Keys the menu itself needs while the search box has focus.
const MENU_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab", "Home", "End"]);

export type GroupChoice = {
  value: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  /** Starts a new block: a rule is drawn above this choice. */
  divided?: boolean;
};

/** Who or what a menu is about: icon, name and one quiet line under it. */
export function GroupMenuHeader(props: { icon?: ReactNode; title: string; subtitle?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-2 pt-1.5 pb-2">
      {props.icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-foreground">{props.title}</div>
        {props.subtitle ? (
          <div className="truncate text-xs text-foreground/60">{props.subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}

export function GroupChoiceMenu(props: {
  label: string;
  value: string;
  choices: readonly GroupChoice[];
  onChange: (value: string) => void;
  header?: ReactNode;
  searchPlaceholder?: string;
  testId?: string;
  className?: string;
}) {
  const { t } = useTranslation("shell");
  const [query, setQuery] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const seen = useRef(props.value);
  useEffect(() => {
    if (seen.current === props.value) return;
    seen.current = props.value;
    setConfirmed(true);
    const timer = window.setTimeout(() => setConfirmed(false), 1400);
    return () => window.clearTimeout(timer);
  }, [props.value]);

  const current = props.choices.find((choice) => choice.value === props.value);
  const searchable = props.searchPlaceholder !== undefined && props.choices.length >= SEARCH_FROM;
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? props.choices.filter((choice) => choice.label.toLowerCase().includes(needle))
    : props.choices;

  return (
    <Menu
      onOpenChange={(open) => {
        if (!open) return setQuery("");
        if (searchable) requestAnimationFrame(() => searchRef.current?.focus());
      }}
    >
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            data-testid={props.testId}
            className={cn(
              "glass-control flex h-7 max-w-40 min-w-0 shrink items-center gap-1.5 rounded-full border pr-2 pl-3 text-xs text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97] data-popup-open:text-foreground",
              props.className,
            )}
          />
        }
      >
        {current?.icon}
        <span className="truncate">{current?.label ?? props.value}</span>
        {confirmed ? (
          <CheckIcon className="size-3 shrink-0 animate-[group-pop_360ms_ease-out_1] text-emerald-500 motion-reduce:animate-none" />
        ) : (
          <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
        )}
      </MenuTrigger>
      <MenuPopup
        surface="liquid"
        align="end"
        sideOffset={6}
        className={cn(GROUP_MENU_CLASS, "w-64")}
      >
        {props.header}
        {props.header ? <MenuSeparator /> : null}
        {searchable ? (
          <label className="relative mx-0.5 mb-1.5 block">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground/50"
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={props.searchPlaceholder}
              aria-label={props.searchPlaceholder}
              className="h-8 w-full rounded-[10px] bg-[var(--liquid-row-hover)] font-sans pr-2 pl-8 text-[13px] text-foreground outline-none placeholder:text-foreground/45 focus-visible:ring-1 focus-visible:ring-[color:var(--liquid-rule)] [&::-webkit-search-cancel-button]:hidden"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDownCapture={(event) => {
                if (!MENU_KEYS.has(event.key)) event.stopPropagation();
              }}
            />
          </label>
        ) : null}
        <MenuRadioGroup
          value={props.value}
          onValueChange={(value) => props.onChange(String(value))}
          className="max-h-72 overflow-y-auto overscroll-contain"
        >
          {shown.map((choice) => (
            <Fragment key={choice.value}>
              {choice.divided && !needle ? <MenuSeparator /> : null}
              <MenuRadioItem value={choice.value} title={choice.hint} closeOnClick>
                {choice.icon}
                <span className="min-w-0 flex-1 truncate">{choice.label}</span>
              </MenuRadioItem>
            </Fragment>
          ))}
        </MenuRadioGroup>
        {shown.length === 0 ? (
          <p className="px-2 py-3 text-xs text-foreground/55">{t("multiAgents.members.noMatch")}</p>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
