// FILE: shortcutsSheet.ts
// Purpose: Build the shortcut reference sections shown by the keyboard shortcuts sheet.
// Layer: UI helper
// Depends on: keybinding label resolution, project script command mapping, and platform helpers.

import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@synara/contracts";
import { isMacPlatform } from "./lib/utils";
import { shortcutLabelForCommand } from "./keybindings";
import { commandForProjectScript } from "./projectScripts";
import type { ProjectScript } from "./types";
import type { AppTranslate } from "./i18n/AppTranslate";

export interface ShortcutSheetContext {
  terminalFocus: boolean;
  terminalOpen: boolean;
  terminalWorkspaceOpen: boolean;
  [key: string]: boolean;
}

export interface ShortcutSheetEntry {
  id: string;
  label: string;
  description: string;
  shortcutLabel: string;
}

export interface ShortcutSheetSection {
  id: string;
  title: string;
  description: string;
  tone?: "default" | "muted";
  entries: ShortcutSheetEntry[];
}

interface BuildShortcutSheetSectionsOptions {
  keybindings: ResolvedKeybindingsConfig;
  projectScripts: ReadonlyArray<ProjectScript>;
  platform: string;
  context: ShortcutSheetContext;
  translate: AppTranslate;
}

interface ShortcutDefinition {
  command: KeybindingCommand | readonly KeybindingCommand[];
  translationKey: string;
}

const AVAILABLE_NOW_DEFINITIONS: readonly ShortcutDefinition[] = [
  { command: "sidebar.addProject", translationKey: "addProject" },
  { command: "sidebar.search", translationKey: "search" },
  { command: "sidebar.importThread", translationKey: "importThread" },
  { command: "chat.new", translationKey: "newThread" },
  { command: "chat.newLatestProject", translationKey: "newLatestProject" },
  { command: ["chat.newChat", "chat.newLocal"], translationKey: "newChat" },
  { command: "chat.newTerminal", translationKey: "newTerminal" },
  { command: "chat.newClaude", translationKey: "newClaude" },
  { command: "chat.newCodex", translationKey: "newCodex" },
  { command: "chat.newCursor", translationKey: "newCursor" },
  { command: "chat.newGemini", translationKey: "newGemini" },
  { command: "chat.split", translationKey: "split" },
  { command: "view.recent.previous", translationKey: "previousRecent" },
  { command: "view.recent.next", translationKey: "nextRecent" },
  { command: "modelPicker.toggle", translationKey: "modelPicker" },
  { command: "model.next", translationKey: "nextModel" },
  { command: "model.previous", translationKey: "previousModel" },
  { command: "traitsPicker.toggle", translationKey: "traitsPicker" },
  { command: "composer.focus.toggle", translationKey: "focusComposer" },
  { command: "terminal.toggle", translationKey: "toggleTerminal" },
  { command: "diff.toggle", translationKey: "toggleDiff" },
  { command: "browser.toggle", translationKey: "toggleBrowser" },
  { command: "chat.visible.previous", translationKey: "previousVisible" },
  { command: "chat.visible.next", translationKey: "nextVisible" },
  { command: "editor.openFavorite", translationKey: "openFavoriteEditor" },
] as const;

const THREAD_JUMP_DEFINITIONS: readonly ShortcutDefinition[] = Array.from(
  { length: 9 },
  (_, index) => ({
    command: `thread.jump.${index + 1}` as KeybindingCommand,
    translationKey: "jumpVisible",
  }),
);

const WORKSPACE_DEFINITIONS: readonly ShortcutDefinition[] = [
  { command: "terminal.workspace.newFullWidth", translationKey: "openWorkspace" },
  { command: "terminal.workspace.terminal", translationKey: "focusTerminal" },
  { command: "terminal.workspace.chat", translationKey: "focusChat" },
  { command: "terminal.workspace.closeActive", translationKey: "closeWorkspacePanel" },
] as const;

function modSlashLabel(platform: string): string {
  return isMacPlatform(platform) ? "⌘/" : "Ctrl+/";
}

function definitionToEntry(
  definition: ShortcutDefinition,
  keybindings: ResolvedKeybindingsConfig,
  platform: string,
  context: ShortcutSheetContext,
  translate: BuildShortcutSheetSectionsOptions["translate"],
): ShortcutSheetEntry | null {
  const commands = Array.isArray(definition.command) ? definition.command : [definition.command];
  const shortcutLabel = commands.reduce<string | null>((resolved, command) => {
    if (resolved) return resolved;
    return shortcutLabelForCommand(keybindings, command, {
      platform,
      context,
    });
  }, null);
  if (!shortcutLabel) return null;
  const number =
    definition.translationKey === "jumpVisible" ? commands[0]?.split(".").at(-1) : null;
  return {
    id: commands[0] ?? definition.translationKey,
    label: translate(`shortcutSheet.entries.${definition.translationKey}.label`, { number }),
    description: translate(`shortcutSheet.entries.${definition.translationKey}.description`, {
      number,
    }),
    shortcutLabel,
  };
}

function definitionsToEntries(
  definitions: ReadonlyArray<ShortcutDefinition>,
  keybindings: ResolvedKeybindingsConfig,
  platform: string,
  context: ShortcutSheetContext,
  translate: BuildShortcutSheetSectionsOptions["translate"],
): ShortcutSheetEntry[] {
  return definitions
    .map((definition) => definitionToEntry(definition, keybindings, platform, context, translate))
    .filter((entry): entry is ShortcutSheetEntry => entry !== null);
}

export function buildShortcutSheetSections(
  options: BuildShortcutSheetSectionsOptions,
): ShortcutSheetSection[] {
  const sections: ShortcutSheetSection[] = [];

  const currentEntries: ShortcutSheetEntry[] = [
    {
      id: "shortcuts.show",
      label: options.translate("shortcutSheet.entries.show.label"),
      description: options.translate("shortcutSheet.entries.show.description"),
      shortcutLabel: modSlashLabel(options.platform),
    },
    ...definitionsToEntries(
      AVAILABLE_NOW_DEFINITIONS,
      options.keybindings,
      options.platform,
      options.context,
      options.translate,
    ),
  ];

  const sidebarToggle = definitionToEntry(
    {
      command: "sidebar.toggle",
      translationKey: "toggleSidebar",
    },
    options.keybindings,
    options.platform,
    options.context,
    options.translate,
  );
  if (sidebarToggle) {
    currentEntries.splice(1, 0, sidebarToggle);
  }

  const currentNavigationEntries = options.context.terminalWorkspaceOpen
    ? definitionsToEntries(
        WORKSPACE_DEFINITIONS,
        options.keybindings,
        options.platform,
        options.context,
        options.translate,
      )
    : definitionsToEntries(
        THREAD_JUMP_DEFINITIONS,
        options.keybindings,
        options.platform,
        options.context,
        options.translate,
      );

  sections.push({
    id: "available-now",
    title: options.translate("shortcutSheet.sections.available.title"),
    description: options.context.terminalWorkspaceOpen
      ? options.translate("shortcutSheet.sections.available.workspaceDescription")
      : options.translate("shortcutSheet.sections.available.chatDescription"),
    entries: [...currentEntries, ...currentNavigationEntries],
  });

  const alternateContext: ShortcutSheetContext = options.context.terminalWorkspaceOpen
    ? { ...options.context, terminalWorkspaceOpen: false }
    : {
        ...options.context,
        terminalOpen: true,
        terminalWorkspaceOpen: true,
      };
  const alternateDefinitions = options.context.terminalWorkspaceOpen
    ? THREAD_JUMP_DEFINITIONS
    : WORKSPACE_DEFINITIONS;
  const alternateEntries = definitionsToEntries(
    alternateDefinitions,
    options.keybindings,
    options.platform,
    alternateContext,
    options.translate,
  );
  if (alternateEntries.length > 0) {
    sections.push({
      id: "alternate-context",
      title: options.translate(
        options.context.terminalWorkspaceOpen
          ? "shortcutSheet.sections.alternate.outsideTitle"
          : "shortcutSheet.sections.alternate.insideTitle",
      ),
      description: options.context.terminalWorkspaceOpen
        ? options.translate("shortcutSheet.sections.alternate.outsideDescription")
        : options.translate("shortcutSheet.sections.alternate.insideDescription"),
      tone: "muted",
      entries: alternateEntries,
    });
  }

  const projectScriptEntries = options.projectScripts
    .map((script) => {
      const shortcutLabel = shortcutLabelForCommand(
        options.keybindings,
        commandForProjectScript(script.id),
        options.platform,
      );
      if (!shortcutLabel) return null;
      return {
        id: script.id,
        label: script.runOnWorktreeCreate
          ? options.translate("shortcutSheet.projectScript.setupLabel", { name: script.name })
          : script.name,
        description: script.runOnWorktreeCreate
          ? options.translate("shortcutSheet.projectScript.setupDescription")
          : options.translate("shortcutSheet.projectScript.runDescription"),
        shortcutLabel,
      } satisfies ShortcutSheetEntry;
    })
    .filter((entry): entry is ShortcutSheetEntry => entry !== null);

  if (projectScriptEntries.length > 0) {
    sections.push({
      id: "project-scripts",
      title: options.translate("shortcutSheet.sections.projectScripts.title"),
      description: options.translate("shortcutSheet.sections.projectScripts.description"),
      entries: projectScriptEntries,
    });
  }

  return sections;
}

// Match a single entry against a free-text query on the human-readable label, the
// description, and the rendered shortcut label, so a user can search by action name
// ("terminal"), intent ("split"), or even the key combo itself ("⌘N" / "ctrl+n").
function shortcutSheetEntryMatchesQuery(entry: ShortcutSheetEntry, needle: string): boolean {
  return (
    entry.label.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle) ||
    entry.shortcutLabel.toLowerCase().includes(needle)
  );
}

// Filter each section's entries against a free-text query, dropping sections that end up
// empty. Shared by the keyboard-shortcuts dialog (Mod+/) and the settings reference panel
// so the two surfaces search identically.
export function filterShortcutSheetSections(
  sections: ShortcutSheetSection[],
  query: string,
): ShortcutSheetSection[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return sections;
  return sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) => shortcutSheetEntryMatchesQuery(entry, trimmed)),
    }))
    .filter((section) => section.entries.length > 0);
}
