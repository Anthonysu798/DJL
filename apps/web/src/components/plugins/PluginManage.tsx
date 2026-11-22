// FILE: PluginManage.tsx
// Purpose: An added plugin's settings: sign in or out of each app, uninstall, and its details.

import type {
  InstalledPlugin,
  PluginAppInput,
  PluginCatalogEntry,
  PluginsSnapshot,
} from "@djl/contracts";
import { useTranslation } from "react-i18next";

import { ChevronRightIcon } from "~/lib/icons";
import { Button } from "../ui/button";
import { PluginAppRow } from "./PluginAppRow";
import { connectionOf } from "./PluginDetail";
import { PluginGlyph } from "./PluginGlyph";

export function PluginManageView(props: {
  snapshot: PluginsSnapshot;
  plugin: PluginCatalogEntry;
  installed: InstalledPlugin;
  pending: boolean;
  error: string | undefined;
  onBack: () => void;
  onViewDetails: () => void;
  onUninstall: () => void;
  onConnect: (input: PluginAppInput) => void;
  onDisconnect: (input: PluginAppInput) => void;
  onOpenLink: (url: string) => void;
}) {
  const { t, i18n } = useTranslation("shell");
  const { plugin, snapshot } = props;
  const usesSignIn = plugin.apps.some((app) => app.auth === "oauth");
  const link = (url: string | undefined, label: string) =>
    url ? (
      <button
        type="button"
        className="text-left underline-offset-4 hover:underline"
        onClick={() => props.onOpenLink(url)}
      >
        {label}
      </button>
    ) : null;
  const about: ReadonlyArray<readonly [string, React.ReactNode]> = [
    [
      t("pluginLibrary.added"),
      new Date(props.installed.installedAt).toLocaleDateString(i18n.language, {
        dateStyle: "medium",
      }),
    ],
    [t("pluginLibrary.developer"), plugin.developer],
    [t("pluginLibrary.version"), plugin.version],
    [t("pluginLibrary.website"), link(plugin.websiteUrl, plugin.websiteUrl ?? "")],
    [
      t("pluginLibrary.privacyPolicy"),
      link(plugin.privacyPolicyUrl, t("pluginLibrary.viewPrivacyPolicy")),
    ],
    [
      t("pluginLibrary.termsOfService"),
      link(plugin.termsOfServiceUrl, t("pluginLibrary.viewTerms")),
    ],
    [
      t("pluginLibrary.authorization"),
      usesSignIn
        ? t("pluginLibrary.authorizationOAuth")
        : plugin.apps.some((app) => app.auth === "apiKey")
          ? t("pluginLibrary.authorizationToken")
          : t("pluginLibrary.authorizationNone"),
    ],
  ];

  return (
    <div className="mx-auto w-full max-w-[900px] px-6 pb-16 pt-6 sm:px-10">
      <nav className="mb-8 flex items-center gap-2 text-sm" aria-label={t("pluginLibrary.plugins")}>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={props.onBack}
        >
          {t("pluginLibrary.plugins")}
        </button>
        <ChevronRightIcon className="size-3.5 text-muted-foreground" />
        <span>{plugin.displayName}</span>
      </nav>

      <div className="flex flex-wrap items-center gap-4">
        <PluginGlyph plugin={plugin} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {plugin.displayName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{plugin.shortDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={props.onViewDetails}>
            {t("pluginLibrary.viewDetails")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive-outline"
            disabled={props.pending}
            onClick={props.onUninstall}
          >
            {t("pluginLibrary.uninstall")}
          </Button>
        </div>
      </div>

      {props.error ? (
        <p role="alert" className="mt-6 rounded-lg border border-border p-3 text-sm">
          {props.error}
        </p>
      ) : null}

      <ul className="mt-8 rounded-2xl border border-border/70 bg-muted/30 px-5">
        {plugin.apps.map((app) => (
          <PluginAppRow
            key={app.id}
            plugin={plugin}
            app={app}
            connection={connectionOf(snapshot, plugin, app)}
            pending={props.pending}
            onConnect={() => props.onConnect({ pluginId: plugin.id, appId: app.id })}
            onDisconnect={() => props.onDisconnect({ pluginId: plugin.id, appId: app.id })}
          />
        ))}
      </ul>
      {usesSignIn ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("pluginLibrary.newChatsHint")}</p>
      ) : null}

      <h2 className="mb-3 mt-10 text-base font-medium">{t("pluginLibrary.about")}</h2>
      <dl className="rounded-2xl border border-border/70 bg-muted/30 px-5 text-sm">
        {about.map(([label, value]) =>
          value ? (
            <div
              key={label}
              className="grid grid-cols-[200px_1fr] gap-4 border-b border-border/60 py-4 last:border-b-0"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </div>
  );
}
