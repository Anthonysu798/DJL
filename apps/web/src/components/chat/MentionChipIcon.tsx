// FILE: MentionChipIcon.tsx
// Purpose: Shared icon renderer for mention chips. Keeps file, folder, plugin
//          and server glyphs identical between Lexical composer chips and React
//          sent-message chips.
// Layer: UI shared component/helper
// Exports: MentionChipIcon, createMentionChipIconElement

import { memo, useEffect, useState } from "react";
import { getFileIconName, inferEntryKindFromPath } from "~/file-icons";
import { resolveMentionChipKind, type MentionChipKind } from "~/lib/composerMentions";
import { CentralIcon, createCentralIconElement } from "~/lib/central-icons";
import { PluginIcon } from "~/lib/icons";
import { pluginLogoSite, whenPluginLogosKnown } from "~/lib/pluginLogos";
import { probeSiteFavicon, resolveSiteFaviconUrl } from "~/lib/siteFavicon";
import { cn } from "~/lib/utils";
import { SiteFavicon } from "../SiteFavicon";
import { COMPOSER_INLINE_MENTION_CHIP_ICON_CLASS_NAME } from "../composerInlineChip";
import { FolderClosed } from "../FolderClosed";
import type { ProviderMentionReference } from "@synara/contracts";

export type { MentionChipKind };

const SERVER_MENTION_CHIP_ICON_NAME = "server";

function composerMentionChipCentralIconName(path: string, kind: MentionChipKind = "path"): string {
  if (kind === "plugin" || path.startsWith("plugin://")) {
    return "puzzle";
  }
  if (kind === "server") {
    return SERVER_MENTION_CHIP_ICON_NAME;
  }
  if (inferEntryKindFromPath(path) === "directory") {
    return "folder-2";
  }
  return getFileIconName(path);
}

// A logo is a full-colour image, so it gets a soft corner instead of the glyphs' mask.
const PLUGIN_LOGO_CLASS_NAME = "rounded-[3px] object-contain";

/** A plugin chip's icon: the plugin's own logo once the catalog is known, else the plugin mark. */
function PluginMentionIcon(props: { name: string; className: string }) {
  const [site, setSite] = useState(() => pluginLogoSite(props.name));
  useEffect(() => {
    let live = true;
    void whenPluginLogosKnown().then(() => {
      if (live) setSite(pluginLogoSite(props.name));
    });
    return () => {
      live = false;
    };
  }, [props.name]);
  const mark = <PluginIcon className={props.className} />;
  return site ? (
    <SiteFavicon
      url={site}
      className={cn(props.className, PLUGIN_LOGO_CLASS_NAME)}
      fallback={mark}
    />
  ) : (
    mark
  );
}

// `theme` is retained for call-site compatibility but no longer affects icon
// selection (Central icons are theme-agnostic `currentColor` glyphs).
// `className` lets callers size the glyph per surface (composer token vs timeline
// echo) while keeping the file/folder/plugin selection logic in one place.
export const MentionChipIcon = memo(function MentionChipIcon(props: {
  path: string;
  theme: "light" | "dark";
  kind?: MentionChipKind;
  mentionReferences?: ReadonlyArray<ProviderMentionReference>;
  className?: string;
}) {
  const className = props.className ?? COMPOSER_INLINE_MENTION_CHIP_ICON_CLASS_NAME;
  const resolvedKind = resolveMentionChipKind(props.path, {
    ...(props.kind ? { kind: props.kind } : {}),
    ...(props.mentionReferences ? { mentionReferences: props.mentionReferences } : {}),
  });
  if (resolvedKind === "plugin") {
    return <PluginMentionIcon name={props.path} className={className} />;
  }
  if (resolvedKind === "server") {
    return <CentralIcon name={SERVER_MENTION_CHIP_ICON_NAME} className={className} />;
  }
  const kind = inferEntryKindFromPath(props.path);
  if (kind === "directory") {
    return <FolderClosed className={className} />;
  }
  // Masked Central glyph painted with `bg-current`, so the file icon inherits the
  // chip's text color (it shares the filename's color) instead of a per-filetype
  // tint. `getFileIconName` already falls back to the bracket glyph when unknown.
  return <CentralIcon name={getFileIconName(props.path)} className={className} />;
});

// Lexical composer only — use a single masked Central icon (same as skill chips)
// so @ tokens align with / and $ tokens. User-message bubbles keep MentionChipIcon.
export function createMentionChipIconElement(
  path: string,
  kind: MentionChipKind = "path",
  className: string = COMPOSER_INLINE_MENTION_CHIP_ICON_CLASS_NAME,
): HTMLElement {
  const iconName = composerMentionChipCentralIconName(path, kind);
  const icon =
    createCentralIconElement(iconName, className) ??
    createCentralIconElement("code-brackets", className) ??
    document.createElement("span");
  if (kind === "plugin") {
    // Starts as the plugin mark and becomes the plugin's own logo once that has loaded.
    void whenPluginLogosKnown().then(async () => {
      const site = pluginLogoSite(path);
      if (!site) return;
      const src = resolveSiteFaviconUrl(site);
      if ((await probeSiteFavicon(src)) !== "ok") return;
      // Repainted in place: the editor undoes elements added to a chip behind its back,
      // but leaves style changes alone.
      icon.style.removeProperty("-webkit-mask");
      icon.style.removeProperty("mask");
      icon.style.setProperty(
        "background",
        `url(${JSON.stringify(src)}) center / contain no-repeat`,
      );
      icon.style.setProperty("border-radius", "3px");
    });
  }
  return icon;
}
