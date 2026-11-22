// FILE: PluginDirectory.tsx
// Purpose: The plugin directory: every plugin DJL offers, grouped by category, with one-click add.

import {
  isPluginInstalled,
  type PluginCatalogEntry,
  type PluginsSnapshot,
} from "@synara/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PlusIcon, RefreshCwIcon, SearchIcon, SettingsIcon } from "~/lib/icons";
import { rankProviderDiscoveryItems } from "~/lib/providerDiscovery";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { PluginActionsMenu } from "./PluginActionsMenu";
import { PluginGlyph } from "./PluginGlyph";

interface PluginDirectoryViewProps {
  snapshot: PluginsSnapshot | undefined;
  loading: boolean;
  error: string | undefined;
  /** The plugin whose add or uninstall call is in flight. */
  pendingPluginId: string | undefined;
  onOpen: (pluginId: string) => void;
  onAdd: (pluginId: string) => void;
  onUninstall: (pluginId: string) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onAddServer: () => void;
  onCreateSkill: () => void;
  onAddMarketplace: () => void;
  onUploadPlugin: () => void;
  /** What the last marketplace read left out, if anything. */
  notice: string | undefined;
  onRefreshMarketplace: (sourceId: string) => void;
  onRemoveMarketplace: (sourceId: string) => void;
}

const ALL_SOURCES = "all";

export function PluginDirectoryView(props: PluginDirectoryViewProps) {
  const { t } = useTranslation("shell");
  const [search, setSearch] = useState("");
  const [sourceId, setSourceId] = useState(ALL_SOURCES);
  const { snapshot } = props;
  const marketplaces = snapshot?.sources.filter((source) => source.kind === "marketplace") ?? [];
  const marketplace = marketplaces.find((source) => source.id === sourceId);
  // Marketplace plugins stay in their own tab, so a listing never mixes into DJL's catalog.
  const plugins = marketplace
    ? marketplace.plugins
    : (snapshot?.sources
        .filter((source) => source.kind !== "marketplace")
        .flatMap((source) => source.plugins) ?? []);
  const sections = search.trim()
    ? [
        {
          title: t("pluginLibrary.results"),
          plugins: rankProviderDiscoveryItems(plugins, search, (plugin) => [
            { value: plugin.displayName },
            { value: plugin.shortDescription },
            { value: plugin.category },
          ]),
        },
      ]
    : [
        {
          title: t("pluginLibrary.featured"),
          plugins: plugins.filter((plugin) => plugin.featured),
        },
        ...[...new Set(plugins.map((plugin) => plugin.category))].map((category) => ({
          title: category,
          plugins: plugins.filter((plugin) => plugin.category === category),
        })),
      ];
  const visibleSections = sections.filter((section) => section.plugins.length > 0);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 pb-16 pt-8 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("pluginLibrary.plugins")}
        </h1>
        <div className="flex items-center gap-2">
          <div className="relative w-64 max-w-full">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="rounded-full pl-9"
              aria-label={t("pluginLibrary.searchPlugins")}
              placeholder={t("pluginLibrary.searchPlugins")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("pluginLibrary.refresh")}
            title={t("pluginLibrary.refresh")}
            onClick={props.onRefresh}
          >
            <RefreshCwIcon className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("pluginLibrary.settings")}
            title={t("pluginLibrary.settings")}
            onClick={props.onOpenSettings}
          >
            <SettingsIcon className="size-4" />
          </Button>
          <Menu>
            <MenuTrigger render={<Button type="button" size="sm" variant="outline" />}>
              <PlusIcon className="size-4" />
              {t("pluginLibrary.add")}
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={props.onAddServer}>{t("pluginLibrary.addServer")}</MenuItem>
              <MenuItem onClick={props.onAddMarketplace}>
                {t("pluginLibrary.addMarketplace")}
              </MenuItem>
              <MenuItem onClick={props.onUploadPlugin}>{t("pluginLibrary.uploadPlugin")}</MenuItem>
              <MenuItem onClick={props.onCreateSkill}>{t("pluginLibrary.createSkill")}</MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{t("pluginLibrary.directoryHint")}</p>

      {marketplaces.length > 0 ? (
        <Tabs
          className="mt-6"
          value={marketplace ? marketplace.id : ALL_SOURCES}
          onValueChange={(value) => setSourceId(String(value))}
        >
          <TabsList variant="line">
            <TabsTrigger value={ALL_SOURCES}>{t("pluginLibrary.allSources")}</TabsTrigger>
            {marketplaces.map((source) => (
              <TabsTrigger key={source.id} value={source.id}>
                {source.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      {marketplace ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {marketplace.url}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => props.onRefreshMarketplace(marketplace.id)}
          >
            <RefreshCwIcon className="size-4" />
            {t("pluginLibrary.refreshMarketplace")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive-outline"
            title={t("pluginLibrary.removeMarketplaceHint")}
            onClick={() => props.onRemoveMarketplace(marketplace.id)}
          >
            {t("pluginLibrary.removeMarketplace")}
          </Button>
        </div>
      ) : null}
      {props.notice ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {props.notice}
        </p>
      ) : null}

      {props.error ? (
        <p role="alert" className="mt-6 rounded-lg border border-border p-3 text-sm">
          {props.error}
        </p>
      ) : null}
      {props.loading && !snapshot ? (
        <p role="status" className="mt-10 text-sm text-muted-foreground">
          {t("pluginLibrary.loading")}
        </p>
      ) : null}
      {snapshot && visibleSections.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {t("pluginLibrary.noMatches")}
        </p>
      ) : null}

      {snapshot
        ? visibleSections.map((section) => (
            <section key={section.title} className="mt-10" aria-label={section.title}>
              <h2 className="mb-3 text-base font-medium">{section.title}</h2>
              <ul className="grid gap-x-10 sm:grid-cols-2">
                {section.plugins.map((plugin) => (
                  <PluginRow
                    key={plugin.id}
                    plugin={plugin}
                    installed={isPluginInstalled(snapshot, plugin)}
                    pending={props.pendingPluginId === plugin.id}
                    onOpen={props.onOpen}
                    onAdd={props.onAdd}
                    onUninstall={props.onUninstall}
                  />
                ))}
              </ul>
            </section>
          ))
        : null}
    </div>
  );
}

function PluginRow(props: {
  plugin: PluginCatalogEntry;
  installed: boolean;
  pending: boolean;
  onOpen: (pluginId: string) => void;
  onAdd: (pluginId: string) => void;
  onUninstall: (pluginId: string) => void;
}) {
  const { t } = useTranslation("shell");
  const { plugin } = props;
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-3.5 text-left hover:bg-muted/50"
        onClick={() => props.onOpen(plugin.id)}
      >
        <PluginGlyph plugin={plugin} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{plugin.displayName}</span>
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {plugin.shortDescription}
          </span>
        </span>
      </button>
      {props.installed ? (
        <PluginActionsMenu
          plugin={plugin}
          onViewDetails={() => props.onOpen(plugin.id)}
          {...(plugin.builtIn ? {} : { onUninstall: () => props.onUninstall(plugin.id) })}
        />
      ) : (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={props.pending}
          aria-label={t("pluginLibrary.addNamed", { name: plugin.displayName })}
          title={t("pluginLibrary.addNamed", { name: plugin.displayName })}
          onClick={() => props.onAdd(plugin.id)}
        >
          <PlusIcon className="size-5" />
        </Button>
      )}
    </li>
  );
}
