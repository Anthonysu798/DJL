// FILE: pluginLogos.ts
// Purpose: Lets a mention chip, which knows only a plugin's "@" name, find that plugin's
//          logo: the site whose icon stands for it in DJL's plugin catalog.
// Layer: Web data helper

import type { PluginsSnapshot } from "@synara/contracts";

import { ensureNativeApi } from "~/nativeApi";

const logoSiteByName = new Map<string, string>();
let markKnown: () => void = () => {};
const known = new Promise<void>((resolve) => {
  markKnown = resolve;
});
let requested = false;

/** Called with every catalog the app loads, so the names stay current. */
export function rememberPluginLogos(snapshot: PluginsSnapshot): void {
  for (const source of snapshot.sources) {
    for (const plugin of source.plugins) {
      const site = plugin.websiteUrl ?? plugin.iconDomain;
      if (site) logoSiteByName.set(plugin.name, site);
    }
  }
  markKnown();
}

/** The logo site of the plugin mentioned as `name`, if the catalog is known and it has one. */
export function pluginLogoSite(name: string): string | undefined {
  return logoSiteByName.get(name);
}

/**
 * Resolves once the catalog has been seen, loading it if nothing else has yet. It stays
 * pending when the catalog cannot be loaded: the chip then keeps the plain plugin mark.
 */
export function whenPluginLogosKnown(): Promise<void> {
  if (!requested) {
    requested = true;
    void Promise.resolve()
      .then(() => ensureNativeApi().plugins.getSnapshot())
      .then(rememberPluginLogos)
      .catch(() => undefined);
  }
  return known;
}
