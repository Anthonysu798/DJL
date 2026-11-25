// FILE: PluginsSettingsPanel.tsx
// Purpose: Settings → Plugins: everything the user has added, in four tabs (plugins, their apps,
//          the tool servers agents are given, and skills), with a switch to turn a plugin off.

import {
  isPluginInstalled,
  pluginAppKey,
  pluginServerName,
  type PluginAppInput,
  type PluginCatalogEntry,
  type PluginSetEnabledInput,
  type PluginsSnapshot,
} from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { RefreshCwIcon, SearchIcon } from "~/lib/icons";
import { pluginsSnapshotQueryOptions, usePluginActions } from "~/lib/pluginsReactQuery";
import { SettingsRow, SettingsSection } from "../settings/SettingsPanelPrimitives";
import { SkillsSettingsPanel } from "../settings/SkillsSettingsPanel";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { PluginAppRow } from "./PluginAppRow";
import { connectionOf } from "./PluginDetail";
import { PluginGlyph } from "./PluginGlyph";
import { usePluginConnect } from "./usePluginConnect";

interface PluginsSettingsViewProps {
  snapshot: PluginsSnapshot | undefined;
  pending: boolean;
  error: string | undefined;
  /** The Skills tab's content; passed in so this view stays free of server queries. */
  skills: React.ReactNode;
  onOpen: (plugin: PluginCatalogEntry) => void;
  onBrowse: () => void;
  onRefresh: () => void;
  onSetEnabled: (input: PluginSetEnabledInput) => void;
  onConnect: (input: PluginAppInput) => void;
  onDisconnect: (input: PluginAppInput) => void;
}

export function PluginsSettingsView(props: PluginsSettingsViewProps) {
  const { t } = useTranslation("shell");
  const [search, setSearch] = useState("");
  const { snapshot } = props;
  const query = search.trim().toLowerCase();
  const matches = (...values: ReadonlyArray<string | undefined>) =>
    !query || values.some((value) => value?.toLowerCase().includes(query));

  const added = (snapshot?.sources.flatMap((source) => source.plugins) ?? []).filter((plugin) =>
    isPluginInstalled(snapshot!, plugin),
  );
  const enabledOf = (plugin: PluginCatalogEntry) =>
    plugin.builtIn ||
    snapshot?.installed.find((item) => item.pluginId === plugin.id)?.enabled === true;

  const plugins = added.filter((plugin) => matches(plugin.displayName, plugin.shortDescription));
  const apps = added
    .filter((plugin) => !plugin.builtIn)
    .flatMap((plugin) => plugin.apps.map((app) => ({ plugin, app })))
    .filter(({ plugin, app }) => matches(app.name, plugin.displayName));
  // Exactly what a new chat is handed: http apps of enabled plugins that are connected.
  const servers = added
    .filter(enabledOf)
    .flatMap((plugin) =>
      plugin.apps.flatMap((app) =>
        app.transport.type === "http" && connectionOf(snapshot!, plugin, app)?.state === "connected"
          ? [
              {
                plugin,
                name: pluginServerName(pluginAppKey(plugin.id, app.id)),
                host: new URL(app.transport.url).host,
              },
            ]
          : [],
      ),
    )
    .filter(({ plugin, name }) => matches(name, plugin.displayName));
  const pluginSkills = added
    .flatMap((plugin) => plugin.skills.map((skill) => ({ plugin, skill })))
    .filter(({ plugin, skill }) => matches(skill.name, skill.description, plugin.displayName));

  const tab = (value: string, label: string, count: number) => (
    <TabsTrigger value={value} className="flex-none gap-2 px-2.5">
      {label}
      <span className="min-w-5 rounded-full bg-muted px-1.5 text-center text-[11px] leading-[18px] font-medium tabular-nums text-muted-foreground">
        {count}
      </span>
    </TabsTrigger>
  );
  const empty = (text: string) => (
    <p className="rounded-2xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );

  return (
    // Container queries: the settings pane's width, not the window's, decides the layout.
    <div className="@container space-y-6">
      <div className="flex flex-col gap-2 @lg:flex-row @lg:items-center">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="rounded-full pl-9"
            aria-label={t("pluginLibrary.search")}
            placeholder={t("pluginLibrary.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
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
          <Button type="button" size="sm" className="flex-1 @lg:flex-none" onClick={props.onBrowse}>
            {t("pluginLibrary.browse")}
          </Button>
        </div>
      </div>

      {props.error ? (
        <p role="alert" className="rounded-lg border border-border p-3 text-sm">
          {props.error}
        </p>
      ) : null}

      <Tabs defaultValue="plugins">
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto overflow-y-hidden border-b border-border/60 pb-1 [scrollbar-width:none]"
        >
          {tab("plugins", t("pluginLibrary.plugins"), plugins.length)}
          {tab("apps", t("pluginLibrary.apps"), apps.length)}
          {tab("mcps", t("pluginLibrary.mcp"), servers.length)}
          {tab("skills", t("pluginLibrary.skills"), pluginSkills.length)}
        </TabsList>

        <TabsContent value="plugins" className="pt-4">
          {plugins.length === 0 ? (
            empty(t(query ? "pluginLibrary.noMatches" : "pluginLibrary.noneAdded"))
          ) : (
            <ul className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
              {plugins.map((plugin) => (
                <li
                  key={plugin.id}
                  className="group relative flex items-start gap-3 rounded-2xl border border-border/60 bg-card/40 p-4 transition-[border-color,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus-within:border-border hover:border-border hover:bg-card/70"
                >
                  <PluginGlyph plugin={plugin} size="sm" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      {/* The whole tile opens the plugin; the switch sits above this overlay. */}
                      <button
                        type="button"
                        className="min-w-0 truncate text-left text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
                        onClick={() => props.onOpen(plugin)}
                      >
                        {plugin.displayName}
                      </button>
                      {plugin.builtIn ? (
                        <span className="shrink-0 rounded-full bg-muted px-2 text-[11px] leading-5 text-muted-foreground">
                          {t("pluginLibrary.alwaysOn")}
                        </span>
                      ) : null}
                    </div>
                    {plugin.shortDescription ? (
                      <p className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                        {plugin.shortDescription}
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    className="relative z-10 mt-0.5 shrink-0"
                    checked={enabledOf(plugin)}
                    disabled={plugin.builtIn || props.pending}
                    onCheckedChange={(checked) =>
                      props.onSetEnabled({ pluginId: plugin.id, enabled: Boolean(checked) })
                    }
                    aria-label={t("pluginLibrary.toggleNamed", { name: plugin.displayName })}
                  />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="apps" className="pt-4">
          {apps.length === 0 ? (
            empty(t(query ? "pluginLibrary.noMatches" : "pluginLibrary.noApps"))
          ) : (
            <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card/40 px-4">
              {apps.map(({ plugin, app }) => (
                <PluginAppRow
                  key={`${plugin.id}:${app.id}`}
                  plugin={plugin}
                  app={app}
                  connection={connectionOf(snapshot!, plugin, app)}
                  pending={props.pending}
                  onConnect={() => props.onConnect({ pluginId: plugin.id, appId: app.id })}
                  onDisconnect={() => props.onDisconnect({ pluginId: plugin.id, appId: app.id })}
                />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="mcps" className="pt-4">
          {servers.length === 0 ? (
            empty(t(query ? "pluginLibrary.noMatches" : "pluginLibrary.noServers"))
          ) : (
            <SettingsSection title={t("pluginLibrary.fromPlugins")}>
              {servers.map(({ plugin, name, host }) => (
                <SettingsRow
                  key={name}
                  title={<code className="text-[13px]">{name}</code>}
                  description={`${plugin.displayName} · ${host}`}
                  control={
                    <span className="text-xs text-muted-foreground">
                      {t("pluginLibrary.connected")}
                    </span>
                  }
                />
              ))}
            </SettingsSection>
          )}
        </TabsContent>

        <TabsContent value="skills" className="space-y-6 pt-4">
          {pluginSkills.length > 0 ? (
            <SettingsSection title={t("pluginLibrary.fromPlugins")}>
              {pluginSkills.map(({ plugin, skill }) => (
                <SettingsRow
                  key={`${plugin.id}:${skill.name}`}
                  title={`$${skill.name}`}
                  description={skill.description ?? plugin.displayName}
                  control={
                    <span className="text-xs text-muted-foreground">{plugin.displayName}</span>
                  }
                />
              ))}
            </SettingsSection>
          ) : null}
          {props.skills}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function PluginsSettingsPanel() {
  const navigate = useNavigate();
  const snapshot = useQuery(pluginsSnapshotQueryOptions());
  const actions = usePluginActions();
  const { connect, disconnect, setEnabled } = actions;
  const { connectApp, dialog } = usePluginConnect(snapshot.data, actions);
  return (
    <>
      {dialog}
      <PluginsSettingsView
        snapshot={snapshot.data}
        pending={connect.isPending || disconnect.isPending || setEnabled.isPending}
        error={(setEnabled.error ?? connect.error ?? disconnect.error ?? snapshot.error)?.message}
        skills={<SkillsSettingsPanel />}
        onOpen={(plugin) =>
          void navigate(
            plugin.builtIn
              ? { to: "/plugins/$pluginId", params: { pluginId: plugin.id } }
              : { to: "/plugins/$pluginId/manage", params: { pluginId: plugin.id } },
          )
        }
        onBrowse={() => void navigate({ to: "/plugins" })}
        onRefresh={() => void snapshot.refetch()}
        onSetEnabled={(input) => setEnabled.mutate(input)}
        onConnect={connectApp}
        onDisconnect={(input) => disconnect.mutate(input)}
      />
    </>
  );
}
