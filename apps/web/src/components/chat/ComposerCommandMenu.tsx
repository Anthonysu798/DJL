import { MCP_MENTION_PREFIX } from "@djl/contracts";
import {
  type ProjectEntry,
  type ModelSlug,
  type ProviderNativeCommandDescriptor,
  type ProviderMentionReference,
  type ProviderKind,
  type ProviderPluginDescriptor,
  type ProviderSkillDescriptor,
  type ServerRecord,
} from "@djl/contracts";
import { PROVIDER_DISPLAY_NAMES } from "@djl/contracts";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { type ComposerTriggerKind } from "../../composer-logic";
import { type ComposerSlashCommand } from "../../composerSlashCommands";
import {
  BotIcon,
  BrainIcon,
  BugIcon,
  ChangesIcon,
  ClockIcon,
  DeviceLaptopIcon,
  EraserIcon,
  FastModeIcon,
  GitBranchIcon,
  GitForkIcon,
  InfoIcon,
  ListTodoIcon,
  type LucideIcon,
  MessageCircleIcon,
  Minimize2,
  PluginIcon,
  SkillCubeIcon,
  TemporaryThreadIcon,
  TerminalIcon,
  WorktreeIcon,
} from "~/lib/icons";
import { CentralIcon } from "~/lib/central-icons";
import { formatSkillScope } from "~/lib/providerDiscovery";
import { resolveSkillOrigin, type SkillGroupKey } from "~/lib/skillOrigin";
import { cn } from "~/lib/utils";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../ui/command";
import { FileEntryIcon } from "./FileEntryIcon";
import { ProviderIcon } from "../ProviderIcon";
import { SiteFavicon } from "../SiteFavicon";
import {
  COMPOSER_COMMAND_MENU_GLIDING_ITEM_CLASS_NAME,
  COMPOSER_COMMAND_MENU_HIGHLIGHT_CLASS_NAME,
  COMPOSER_COMMAND_MENU_SURFACE_CLASS_NAME,
} from "./composerPickerStyles";

function humanizeProviderCommandName(command: string): string {
  return command
    .split(/[-_]/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function commandMenuTitle(
  item: Extract<ComposerCommandItem, { type: "slash-command" | "provider-native-command" }>,
): string {
  switch (item.command) {
    case "clear":
      return "Clear";
    case "compact":
      return "Compact Context";
    case "model":
      return "Model";
    case "fast":
      return "Fast Mode";
    case "plan":
      return "Plan Mode";
    case "default":
      return "Default Mode";
    case "review":
      return "Code Review";
    case "fork":
      return "Fork";
    case "side":
      return "Sidechat";
    case "status":
      return "Status";
    case "subagents":
      return "Subagents";
    default:
      return humanizeProviderCommandName(item.command);
  }
}

// Where a skill comes from, beside its name: "Claude · superpowers", "Codex", "Built-in".
function skillOriginLabel(skill: ProviderSkillDescriptor, t: TFunction): string {
  const origin = resolveSkillOrigin(skill);
  const where = origin.plugin ?? (origin.project ? t("commandMenu.skillOrigin.project") : null);
  const withDetail = (name: string) => (where ? `${name} · ${where}` : name);
  switch (origin.kind) {
    case "builtin":
      return t("commandMenu.groups.builtIn");
    case "claude":
      return withDetail("Claude");
    case "codex":
      return withDetail(PROVIDER_DISPLAY_NAMES.codex);
    case "shared":
      return origin.project
        ? t("commandMenu.skillOrigin.project")
        : t("commandMenu.skillOrigin.shared");
    case "djl":
      return "DJL";
    default:
      return formatSkillScope(skill.scope);
  }
}

function commandMenuTrailingMeta(item: ComposerCommandItem, t: TFunction): string | null {
  if (item.type === "agent") {
    return "delegate task to subagent";
  }

  if (item.type === "plugin") {
    return item.mention.path.startsWith(MCP_MENTION_PREFIX) ? "MCP" : "Plugin";
  }

  if (item.type === "server") {
    return item.tierLabel;
  }

  if (item.type === "local-root") {
    return "Local";
  }

  if (item.type === "skill") {
    return skillOriginLabel(item.skill, t);
  }

  if (item.type === "model") {
    return "Model";
  }

  if (item.type === "slash-command" || item.type === "provider-native-command") {
    return `/${item.command}`;
  }

  // Right-align the parent path so many same-named entries (e.g. worktrees) stay
  // distinguishable without crowding the name column.
  if (item.type === "path") {
    return item.description.length > 0 ? item.description : null;
  }

  return null;
}

function commandMenuSecondaryText(item: ComposerCommandItem): string | null {
  if (item.type === "slash-command" || item.type === "provider-native-command") {
    return item.description;
  }

  if (item.type === "agent" || item.type === "handoff-model") {
    return item.description;
  }

  if (
    item.type === "plugin" ||
    item.type === "skill" ||
    item.type === "local-root" ||
    item.type === "server"
  ) {
    return item.description;
  }

  return null;
}

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "local-root";
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
      source: "app" | "shared";
    }
  | {
      id: string;
      type: "provider-native-command";
      provider: ProviderKind;
      command: ProviderNativeCommandDescriptor["name"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "fork-target";
      target: "local" | "worktree";
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "review-target";
      target: "changes" | "base-branch";
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "model" | "handoff-model";
      provider: ProviderKind;
      model: ModelSlug;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "plugin";
      plugin: ProviderPluginDescriptor;
      mention: ProviderMentionReference;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      skill: ProviderSkillDescriptor;
      /** Picker section; the provider's own skills are "suggested". */
      group: SkillGroupKey;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "server";
      server: ServerRecord;
      mention: ProviderMentionReference;
      label: string;
      /** `user@host`, rendered in mono. */
      description: string;
      /** Localized permission tier, shown as the trailing badge. */
      tierLabel: string;
    }
  | {
      id: string;
      type: "agent";
      provider: ProviderKind;
      alias: string;
      color: string;
      label: string;
      description: string;
    };

type ComposerCommandGroupModel = {
  id: string;
  labelKey: string | null;
  labelValues?: Record<string, string>;
  items: ComposerCommandItem[];
};

const SKILL_GROUP_LABEL_KEYS: Record<SkillGroupKey, string> = {
  suggested: "commandMenu.groups.suggestedSkills",
  builtin: "commandMenu.groups.builtIn",
  claude: "commandMenu.groups.claudeSkills",
  codex: "commandMenu.groups.codexSkills",
  shared: "commandMenu.groups.sharedSkills",
  other: "commandMenu.groups.otherSkills",
};

// `$` results arrive ordered by group (see orderSkillsByGroup), so consecutive runs map
// straight to sections and the keyboard order matches what is on screen.
function groupSkillItems(
  items: ComposerCommandItem[],
  provider: ProviderKind | undefined,
): ComposerCommandGroupModel[] {
  const groups: ComposerCommandGroupModel[] = [];
  for (const item of items) {
    const key: SkillGroupKey | "other-items" = item.type === "skill" ? item.group : "other-items";
    const last = groups.at(-1);
    if (last?.id === key) {
      last.items.push(item);
      continue;
    }
    groups.push({
      id: key,
      labelKey: key === "other-items" ? null : SKILL_GROUP_LABEL_KEYS[key],
      ...(key === "suggested" && provider
        ? { labelValues: { provider: PROVIDER_DISPLAY_NAMES[provider] } }
        : {}),
      items: [item],
    });
  }
  // A single section needs no heading.
  if (groups.length === 1 && groups[0]) groups[0].labelKey = null;
  return groups;
}

const COMPOSER_COMMAND_GROUP_LABEL_CLASSNAME =
  "px-2 pt-1.5 pb-1 text-[11px] font-normal text-muted-foreground/60";

export function groupCommandItems(
  items: ComposerCommandItem[],
  triggerKind: ComposerTriggerKind | null,
  groupSlashCommandSections: boolean,
  provider?: ProviderKind,
): ComposerCommandGroupModel[] {
  if (triggerKind === "skill") {
    return groupSkillItems(items, provider);
  }
  if (triggerKind === "mention") {
    const handoffItems = items.filter((item) => item.type === "handoff-model");
    const pluginItems = items.filter(
      (item) => item.type === "plugin" && !item.mention.path.startsWith(MCP_MENTION_PREFIX),
    );
    const mcpItems = items.filter(
      (item) => item.type === "plugin" && item.mention.path.startsWith(MCP_MENTION_PREFIX),
    );
    const serverItems = items.filter((item) => item.type === "server");
    const localItems = items.filter((item) => item.type === "local-root" || item.type === "path");
    const agentItems = items.filter((item) => item.type === "agent");
    const otherItems = items.filter(
      (item) =>
        item.type !== "handoff-model" &&
        item.type !== "plugin" &&
        item.type !== "server" &&
        item.type !== "local-root" &&
        item.type !== "path" &&
        item.type !== "agent",
    );

    const groups: ComposerCommandGroupModel[] = [];
    if (handoffItems.length > 0) {
      groups.push({
        id: "agent-models",
        labelKey: "commandMenu.groups.agentModels",
        items: handoffItems,
      });
    }
    if (pluginItems.length > 0) {
      groups.push({ id: "plugins", labelKey: "commandMenu.groups.plugins", items: pluginItems });
    }
    if (mcpItems.length > 0) {
      groups.push({ id: "mcp", labelKey: "commandMenu.groups.mcp", items: mcpItems });
    }
    if (serverItems.length > 0) {
      groups.push({ id: "servers", labelKey: "commandMenu.groups.servers", items: serverItems });
    }
    if (localItems.length > 0) {
      groups.push({ id: "local", labelKey: "commandMenu.groups.local", items: localItems });
    }
    if (agentItems.length > 0) {
      groups.push({ id: "subagents", labelKey: "commandMenu.groups.subagents", items: agentItems });
    }
    if (otherItems.length > 0) {
      groups.push({ id: "other", labelKey: null, items: otherItems });
    }
    return groups;
  }

  if (triggerKind !== "slash-command" || !groupSlashCommandSections) {
    return [{ id: "default", labelKey: null, items }];
  }

  const builtInItems = items.filter((item) => item.type === "slash-command");
  const providerItems = items.filter((item) => item.type === "provider-native-command");
  const skillItems = items.filter((item) => item.type === "skill");
  const otherItems = items.filter(
    (item) =>
      item.type !== "slash-command" &&
      item.type !== "provider-native-command" &&
      item.type !== "skill",
  );

  const groups: ComposerCommandGroupModel[] = [];
  if (builtInItems.length > 0) {
    groups.push({ id: "built-in", labelKey: "commandMenu.groups.builtIn", items: builtInItems });
  }
  if (providerItems.length > 0) {
    groups.push({ id: "provider", labelKey: "commandMenu.groups.provider", items: providerItems });
  }
  if (skillItems.length > 0) {
    groups.push({ id: "skills", labelKey: "commandMenu.groups.skills", items: skillItems });
  }
  if (otherItems.length > 0) {
    groups.push({ id: "other", labelKey: null, items: otherItems });
  }
  return groups;
}

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  groupSlashCommandSections?: boolean;
  emptyStateText?: string;
  activeItemId: string | null;
  /** The chat's provider: its own skills lead the `$` list under "For <provider>". */
  provider?: ProviderKind;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const { t } = useTranslation("chat");
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const groups = useMemo(
    () =>
      groupCommandItems(
        props.items,
        props.triggerKind,
        props.groupSlashCommandSections ?? true,
        props.provider,
      ),
    [props.groupSlashCommandSections, props.items, props.provider, props.triggerKind],
  );
  // Rows rise in once when the menu opens; rows that appear while typing just appear.
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setEntering(false), 360);
    return () => window.clearTimeout(timer);
  }, []);
  // One highlight that glides between rows instead of each row flashing its own fill.
  const [highlight, setHighlight] = useState<{
    top: number;
    height: number;
    glide: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    const node = props.activeItemId ? itemRefs.current[props.activeItemId] : null;
    if (!node) {
      setHighlight(null);
      return;
    }
    setHighlight((previous) => ({
      top: node.offsetTop,
      height: node.offsetHeight,
      glide: previous !== null,
    }));
  }, [props.activeItemId, props.items]);

  useEffect(() => {
    if (!props.activeItemId) {
      return;
    }

    itemRefs.current[props.activeItemId]?.scrollIntoView({
      block: "nearest",
    });
  }, [props.activeItemId]);
  let rowIndex = 0;

  return (
    <Command
      autoHighlight={false}
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        props.onHighlightedItemChange(
          typeof highlightedValue === "string" ? highlightedValue : null,
        );
      }}
    >
      <div className={cn(COMPOSER_COMMAND_MENU_SURFACE_CLASS_NAME, "command-menu-enter")}>
        <CommandList className="max-h-72 scroll-py-1 p-1">
          <div className="relative">
            <div
              aria-hidden="true"
              className={COMPOSER_COMMAND_MENU_HIGHLIGHT_CLASS_NAME}
              data-glide={highlight?.glide ? "true" : "false"}
              style={{
                transform: `translateY(${highlight?.top ?? 0}px)`,
                height: highlight?.height ?? 0,
                opacity: highlight ? 1 : 0,
              }}
            />
            {groups.map((group, groupIndex) => (
              <div key={group.id}>
                {groupIndex > 0 ? <CommandSeparator className="my-0.5" /> : null}
                <CommandGroup>
                  {group.labelKey ? (
                    <CommandGroupLabel className={COMPOSER_COMMAND_GROUP_LABEL_CLASSNAME}>
                      {group.labelValues ? t(group.labelKey, group.labelValues) : t(group.labelKey)}
                    </CommandGroupLabel>
                  ) : null}
                  {group.items.map((item) => (
                    <ComposerCommandMenuItem
                      key={item.id}
                      item={item}
                      resolvedTheme={props.resolvedTheme}
                      isActive={props.activeItemId === item.id}
                      enterIndex={entering && rowIndex < 8 ? rowIndex++ : null}
                      itemRef={(node) => {
                        itemRefs.current[item.id] = node;
                      }}
                      onHighlight={props.onHighlightedItemChange}
                      onSelect={props.onSelect}
                    />
                  ))}
                </CommandGroup>
              </div>
            ))}
          </div>
          {props.triggerKind === "mention" ? (
            <>
              {groups.length > 0 ? <CommandSeparator className="my-0.5" /> : null}
              {/* This footer is informational copy, not a selectable result group. */}
              <div className="pt-0.5 pb-2">
                <p
                  className={cn(
                    COMPOSER_COMMAND_GROUP_LABEL_CLASSNAME,
                    "px-2 py-0 font-medium text-muted-foreground text-xs",
                  )}
                >
                  {t("commandMenu.files")}
                </p>
                <p className="px-2 pt-0.5 text-[11px] text-muted-foreground/55">
                  {t("commandMenu.searchFilesHint")}
                </p>
              </div>
            </>
          ) : null}
        </CommandList>
        {props.items.length === 0 && (
          <p className="px-2 py-1.5 text-muted-foreground/50 text-[11px]">
            {props.isLoading
              ? props.triggerKind === "mention"
                ? t("commandMenu.searchingMentions")
                : props.triggerKind === "skill"
                  ? t("commandMenu.loadingSkills")
                  : t("commandMenu.loadingCommands")
              : (props.emptyStateText ??
                (props.triggerKind === "mention"
                  ? t("commandMenu.noMatchingMention")
                  : props.triggerKind === "skill"
                    ? t("commandMenu.noMatchingSkill")
                    : t("commandMenu.noMatchingCommand")))}
          </p>
        )}
      </div>
    </Command>
  );
});

// Single icon column shared by every menu row. Rows differ only by the glyph,
// its color, and the name — slot geometry stays constant so files, folders,
// skills, plugins, commands, and agents line up identically.
const COMPOSER_COMMAND_ITEM_ICON_SLOT_CLASSNAME =
  "flex size-4 shrink-0 items-center justify-center text-muted-foreground/60";

// Files mirror the recap / diff changed-files treatment (FileEntryIcon at
// size-3.5 with the same dimmed foreground) so a file reads identically whether
// it appears in a turn summary or in the composer.
const COMPOSER_COMMAND_ITEM_FILE_ICON_CLASSNAME =
  "size-3.5 text-[var(--color-text-foreground)] opacity-70 dark:opacity-80";

const COMPOSER_COMMAND_ITEM_GLYPH_CLASSNAME = "size-3.5";

// Reuse the app's existing icon components for each concept so the command menu
// stays coherent with how plan/fork/review/model/etc. appear everywhere else.
// Don't introduce bespoke glyphs here — map to the shared `~/lib/icons` exports.
const SLASH_COMMAND_ICONS: Record<string, LucideIcon> = {
  clear: EraserIcon,
  compact: Minimize2,
  model: BrainIcon,
  fast: FastModeIcon,
  plan: ListTodoIcon,
  default: MessageCircleIcon,
  review: BugIcon,
  fork: GitForkIcon,
  side: TemporaryThreadIcon,
  status: InfoIcon,
  subagents: BotIcon,
  automation: ClockIcon,
};

function commandMenuSlashGlyph(command: string, fallback: LucideIcon): ReactNode {
  const Icon = SLASH_COMMAND_ICONS[command] ?? fallback;
  return <Icon className={COMPOSER_COMMAND_ITEM_GLYPH_CLASSNAME} />;
}

function commandMenuItemGlyph(item: ComposerCommandItem, theme: "light" | "dark"): ReactNode {
  const cls = COMPOSER_COMMAND_ITEM_GLYPH_CLASSNAME;
  switch (item.type) {
    case "path":
      return (
        <FileEntryIcon
          pathValue={item.path}
          kind={item.pathKind}
          theme={theme}
          className={
            item.pathKind === "directory" ? cls : COMPOSER_COMMAND_ITEM_FILE_ICON_CLASSNAME
          }
        />
      );
    case "local-root":
      return <DeviceLaptopIcon className={cls} />;
    case "fork-target":
      return item.target === "local" ? (
        <DeviceLaptopIcon className={cls} />
      ) : (
        <WorktreeIcon className={cls} />
      );
    case "review-target":
      return item.target === "changes" ? (
        <ChangesIcon className={cls} />
      ) : (
        <GitBranchIcon className={cls} />
      );
    case "slash-command":
      return commandMenuSlashGlyph(item.command, TerminalIcon);
    case "provider-native-command":
      // Provider native commands surface skills (e.g. Claude exposes skills as
      // slash commands), so default to the skill block glyph used for skill
      // tokens in the composer/timeline — named commands still keep their icon.
      return commandMenuSlashGlyph(item.command, SkillCubeIcon);
    case "handoff-model":
      return <ProviderIcon provider={item.provider} className={cls} />;
    case "model":
      return <BrainIcon className={cls} />;
    case "agent":
      return <BotIcon className={cls} />;
    case "plugin": {
      // A plugin shows its own logo; one without a site keeps the plugin mark in its colour.
      const { websiteUrl, brandColor } = item.plugin.interface ?? {};
      const mark = (
        <PluginIcon className={cls} style={brandColor ? { color: brandColor } : undefined} />
      );
      return websiteUrl ? <SiteFavicon url={websiteUrl} size={14} fallback={mark} /> : mark;
    }
    case "server":
      return <CentralIcon name="server" className={cls} />;
    case "skill": {
      // Claude and Codex skills carry their maker's logo; DJL and shared skills the skill mark.
      const origin = resolveSkillOrigin(item.skill);
      return origin.provider ? (
        <ProviderIcon provider={origin.provider} className={cls} />
      ) : (
        <SkillCubeIcon className={cls} />
      );
    }
    default:
      return null;
  }
}

const ComposerCommandItemIcon = memo(function ComposerCommandItemIcon(props: {
  item: ComposerCommandItem;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
}) {
  return (
    <span
      className={cn(
        COMPOSER_COMMAND_ITEM_ICON_SLOT_CLASSNAME,
        "command-menu-glyph",
        props.isActive && "text-foreground/80",
      )}
    >
      {commandMenuItemGlyph(props.item, props.resolvedTheme)}
    </span>
  );
});

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  /** Position in the opening stagger, or null once the menu has settled. */
  enterIndex: number | null;
  itemRef: (node: HTMLElement | null) => void;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const secondaryText = commandMenuSecondaryText(props.item);
  const { t } = useTranslation("chat");
  const trailingMeta =
    props.item.type === "handoff-model"
      ? t("commandMenu.continueWithContext")
      : commandMenuTrailingMeta(props.item, t);

  return (
    <CommandItem
      ref={props.itemRef}
      value={props.item.id}
      data-active={props.isActive ? "true" : undefined}
      title={props.item.type === "skill" ? (props.item.skill.description ?? undefined) : undefined}
      className={cn(
        COMPOSER_COMMAND_MENU_GLIDING_ITEM_CLASS_NAME,
        props.enterIndex !== null && "command-menu-row-enter",
      )}
      style={
        props.enterIndex !== null
          ? ({ "--row-index": props.enterIndex } as CSSProperties)
          : undefined
      }
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      <ComposerCommandItemIcon
        item={props.item}
        resolvedTheme={props.resolvedTheme}
        isActive={props.isActive}
      />
      <div className="min-w-0 flex flex-1 items-center gap-3">
        <div className="min-w-0 flex flex-1 items-center gap-1.5 overflow-hidden">
          <span
            className={cn(
              "shrink-0 text-[11.5px] font-medium text-foreground/80 transition-colors duration-150",
              props.isActive && "text-foreground",
            )}
          >
            {props.item.type === "slash-command" || props.item.type === "provider-native-command"
              ? commandMenuTitle(props.item)
              : props.item.label}
          </span>
          {secondaryText ? (
            <span
              className={cn(
                "truncate text-[11px] text-muted-foreground/55 transition-colors duration-150",
                props.isActive && "text-muted-foreground/80",
                props.item.type === "server" && "font-mono",
              )}
            >
              {secondaryText}
            </span>
          ) : null}
        </div>
        {trailingMeta ? (
          <span
            className={cn(
              "shrink-0 pl-2 text-right text-[10.5px] text-muted-foreground/42 transition-colors duration-150",
              props.isActive && "text-muted-foreground/70",
            )}
          >
            {trailingMeta}
          </span>
        ) : null}
      </div>
    </CommandItem>
  );
});
