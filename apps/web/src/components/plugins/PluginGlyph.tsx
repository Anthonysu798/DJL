import type { PluginCatalogEntry } from "@djl/contracts";

import { PluginIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { SiteFavicon } from "../SiteFavicon";

/** The rounded icon tile for a plugin: its logo, or DJL's plugin mark. */
export function PluginGlyph({
  plugin,
  size = "md",
}: {
  plugin: Pick<PluginCatalogEntry, "websiteUrl" | "iconDomain" | "brandColor">;
  size?: "sm" | "md" | "lg";
}) {
  const iconSize = size === "lg" ? 40 : size === "md" ? 24 : 18;
  // Its own website's icon, or the site named for a plugin that has none.
  const logoSite = plugin.websiteUrl ?? plugin.iconDomain;
  const mark = (
    <PluginIcon
      className="text-foreground/80"
      style={{
        width: iconSize,
        height: iconSize,
        ...(plugin.brandColor ? { color: plugin.brandColor } : {}),
      }}
    />
  );
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center border border-border/70 bg-muted/40",
        size === "lg" ? "size-[72px] rounded-[18px]" : null,
        size === "md" ? "size-11 rounded-xl" : null,
        size === "sm" ? "size-9 rounded-lg" : null,
      )}
    >
      {logoSite ? (
        <SiteFavicon url={logoSite} size={iconSize} className="rounded-[5px]" fallback={mark} />
      ) : (
        mark
      )}
    </span>
  );
}
