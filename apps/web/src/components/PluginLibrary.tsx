import { useHandleNewStudioChat } from "~/hooks/useHandleNewStudioChat";
import { useSyncServerWorkspacePathsFromConfig } from "~/hooks/useSyncServerWorkspacePathsFromConfig";
import { ThreadId } from "@djl/contracts";
// Plugin and skill discovery for the desktop Customize surface.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import {
  PROVIDER_DISPLAY_NAMES,
  BUILT_IN_PLUGINS,
  BUILT_IN_SKILLS,
  type ProviderKind,
  type ProviderPluginDescriptor,
  type ProviderSkillDescriptor,
  type ProviderPluginDetail,
} from "@djl/contracts";
import { useStore } from "~/store";
import { createFirstProjectSelector } from "~/storeSelectors";
import { useFocusedChatContext } from "~/focusedChatContext";
import { usePluginMcpServers } from "~/hooks/usePluginMcpServers";
import {
  providerComposerCapabilitiesQueryOptions,
  providerPluginsQueryOptions,
  providerSkillsQueryOptions,
  providerReadPluginQueryOptions,
  supportsPluginDiscovery,
  supportsSkillDiscovery,
} from "~/lib/providerDiscoveryReactQuery";
import {
  resolveProviderDiscoveryCwd,
  isInstalledProviderPlugin,
  rankProviderDiscoveryItems,
  buildPluginSearchFields,
  buildSkillSearchFields,
  normalizeProviderDiscoveryText,
} from "~/lib/providerDiscovery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { PluginIcon, ListChecksIcon, SearchIcon, CheckIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { SidebarInset } from "./ui/sidebar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SidebarHeaderNavigationControls } from "./SidebarHeaderNavigationControls";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { useComposerDraftStore } from "~/composerDraftStore";
import { formatComposerMentionToken } from "~/lib/composerMentions";

type Entry = { plugin: ProviderPluginDescriptor; marketplacePath: string; marketplaceName: string };
type McpEntry = ReturnType<typeof usePluginMcpServers>["servers"][number];
const builtInEntries: Entry[] = BUILT_IN_PLUGINS.filter(
  ({ plugin }) => plugin.id !== "djl-social",
).map(({ plugin }) => ({
  plugin,
  marketplaceName: "DJL",
  marketplacePath: "builtin://djl",
}));
const isBuiltIn = (id: string) => BUILT_IN_PLUGINS.some((entry) => entry.plugin.id === id);
const titleOf = (plugin: ProviderPluginDescriptor) => plugin.interface?.displayName ?? plugin.name;

function Glyph({ skill = false, plugin }: { skill?: boolean; plugin?: ProviderPluginDescriptor }) {
  const Icon = skill ? ListChecksIcon : PluginIcon;
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/40">
      {plugin?.interface?.logo ? (
        <img src={plugin.interface.logo} alt="" className="size-6 object-contain" />
      ) : (
        <Icon
          className="size-5 text-foreground/80"
          style={plugin?.interface?.brandColor ? { color: plugin.interface.brandColor } : undefined}
        />
      )}
    </span>
  );
}

export function PluginLibrarySurface(props: {
  entries: Entry[];
  skills: readonly ProviderSkillDescriptor[];
  servers: McpEntry[];
  detail?: ProviderPluginDetail | undefined;
  selected: Entry | null;
  onSelect: (entry: Entry | null) => void;
  loading?: boolean;
  error?: string | undefined;
  onRefresh: () => void;
  onUse?: (entry: Entry, prompt: string) => void;
}) {
  const { t } = useTranslation("shell");
  const [tab, setTab] = useState<"plugins" | "mcp" | "skills">("plugins");
  const [search, setSearch] = useState("");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<ProviderSkillDescriptor | null>(null);
  const query = normalizeProviderDiscoveryText(search);
  const entries = rankProviderDiscoveryItems(
    props.entries.filter((entry) => !installedOnly || isInstalledProviderPlugin(entry.plugin)),
    query,
    (entry) => buildPluginSearchFields(entry.plugin),
  );
  const skills = rankProviderDiscoveryItems(
    props.skills.filter((skill) => skill.enabled),
    query,
    buildSkillSearchFields,
  );
  const servers = rankProviderDiscoveryItems(props.servers, query, (entry) => [
    { value: entry.name },
    { value: titleOf(entry.plugin) },
  ]);
  const detail = props.selected?.plugin;
  const builtIn = BUILT_IN_PLUGINS.find((entry) => entry.plugin.id === detail?.id);
  const detailSkills = builtIn ? builtIn.skills : (props.detail?.skills ?? []);
  const detailServers = builtIn ? builtIn.mcpServers : (props.detail?.mcpServers ?? []);
  const nav = (next: typeof tab) => {
    setTab(next);
    props.onSelect(null);
    setSelectedSkill(null);
    setSearch("");
  };
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-border/60 bg-muted/10 p-4 lg:block">
        <h2 className="mb-5 px-2 text-base font-semibold">{t("pluginLibrary.customize")}</h2>
        {(["plugins", "mcp", "skills"] as const).map((item) => (
          <button
            key={item}
            onClick={() => nav(item)}
            className={cn(
              "mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted",
              tab === item && "bg-muted text-foreground",
            )}
          >
            <span className="w-4 text-xs">{item === "skills" ? "$" : "@"}</span>
            {t(`pluginLibrary.${item}`)}
          </button>
        ))}
        <p className="mb-2 mt-8 px-3 text-xs text-muted-foreground">
          {t("pluginLibrary.installed")}
        </p>
        {props.entries
          .filter((entry) => isInstalledProviderPlugin(entry.plugin))
          .map((entry) => (
            <button
              key={entry.plugin.id}
              onClick={() => {
                setTab("plugins");
                props.onSelect(entry);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted",
                props.selected?.plugin.id === entry.plugin.id && "bg-muted",
              )}
            >
              <PluginIcon className="size-4 shrink-0" />
              <span className="truncate">{titleOf(entry.plugin)}</span>
            </button>
          ))}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10 sm:py-10">
          {detail ? (
            <>
              <button
                className="mb-8 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => props.onSelect(null)}
              >
                ← {t("pluginLibrary.plugins")} / {titleOf(detail)}
              </button>
              <div className="mx-auto max-w-3xl">
                <Glyph plugin={detail} />
                <div className="mb-7 mt-5 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-semibold">{titleOf(detail)}</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {detail.interface?.shortDescription}
                    </p>
                  </div>
                  <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs">
                    <CheckIcon className="size-3" />
                    {t(
                      builtIn
                        ? "pluginLibrary.builtIn"
                        : isInstalledProviderPlugin(detail)
                          ? "pluginLibrary.installed"
                          : "pluginLibrary.available",
                    )}
                  </span>
                </div>
                {!!detail.interface?.defaultPrompt?.length && (
                  <div className="mb-8 space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-5 sm:p-8">
                    {detail.interface.defaultPrompt.map((prompt) => (
                      <button
                        key={prompt}
                        disabled={!props.onUse || !isInstalledProviderPlugin(detail)}
                        onClick={() => props.onUse?.(props.selected!, prompt)}
                        className="flex w-full items-center justify-between gap-4 rounded-xl border border-border/60 bg-background px-4 py-3 text-left text-sm hover:bg-muted disabled:cursor-default"
                      >
                        <span>
                          <span className="mr-2 text-muted-foreground">@{detail.name}</span>
                          {prompt}
                        </span>
                        <span aria-hidden>↗</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="mb-8 text-sm leading-6 text-foreground/80">
                  {props.detail?.description ?? detail.interface?.longDescription}
                </p>
                <h2 className="border-b border-border pb-3 text-sm font-medium">
                  {t("pluginLibrary.skills")}{" "}
                  <span className="text-muted-foreground">{detailSkills.length}</span>
                </h2>
                <div className="mb-7">
                  {detailSkills.map((skill) => (
                    <button
                      key={skill.path}
                      onClick={() => setSelectedSkill(skill)}
                      className="flex w-full items-center gap-3 rounded-lg py-4 text-left hover:bg-muted/40"
                    >
                      <Glyph skill />
                      <span>
                        <span className="block text-sm">${skill.name}</span>
                        <span className="text-xs text-muted-foreground">{skill.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <h2 className="border-b border-border pb-3 text-sm font-medium">
                  {t("pluginLibrary.mcp")}{" "}
                  <span className="text-muted-foreground">{detailServers.length}</span>
                </h2>
                <div className="mb-7">
                  {detailServers.map((name) => (
                    <div key={name} className="flex items-center gap-3 py-4">
                      <Glyph />
                      <span className="text-sm">
                        {name}
                        <span className="ml-3 text-xs text-muted-foreground">MCP</span>
                      </span>
                    </div>
                  ))}
                </div>
                <h2 className="border-b border-border pb-3 text-sm font-medium">
                  {t("pluginLibrary.information")}
                </h2>
                <dl className="mt-4 grid grid-cols-[130px_1fr] gap-y-3 text-sm">
                  <dt className="text-muted-foreground">{t("pluginLibrary.developer")}</dt>
                  <dd>{detail.interface?.developerName ?? props.selected?.marketplaceName}</dd>
                  <dt className="text-muted-foreground">{t("pluginLibrary.capabilities")}</dt>
                  <dd>{detail.interface?.capabilities?.join(", ") || "—"}</dd>
                  <dt className="text-muted-foreground">{t("pluginLibrary.useInChat")}</dt>
                  <dd>@{detail.name}</dd>
                </dl>
              </div>
            </>
          ) : (
            <>
              <div className="mb-7 flex flex-wrap items-start justify-between gap-5">
                <div>
                  <h1 className="text-2xl font-semibold">{t(`pluginLibrary.${tab}`)}</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t(tab === "skills" ? "pluginLibrary.skillsHint" : "pluginLibrary.pluginsHint")}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={props.onRefresh}>
                  {t("pluginLibrary.refresh")}
                </Button>
              </div>
              <div className="mb-7 flex flex-wrap items-center gap-3">
                <div className="relative min-w-48 flex-1">
                  <SearchIcon className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    className="rounded-full pl-9"
                    aria-label={t("pluginLibrary.search")}
                    placeholder={t("pluginLibrary.search")}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <div className="flex gap-1 lg:hidden">
                  {(["plugins", "mcp", "skills"] as const).map((item) => (
                    <Button
                      key={item}
                      size="sm"
                      variant={tab === item ? "secondary" : "ghost"}
                      onClick={() => nav(item)}
                    >
                      {t(`pluginLibrary.${item}`)}
                    </Button>
                  ))}
                </div>
              </div>
              {tab === "plugins" && (
                <div className="mb-7 flex gap-2">
                  {[false, true].map((only) => (
                    <Button
                      key={String(only)}
                      size="sm"
                      variant={installedOnly === only ? "secondary" : "ghost"}
                      className="rounded-full"
                      onClick={() => setInstalledOnly(only)}
                    >
                      {t(only ? "pluginLibrary.installed" : "pluginLibrary.allPlugins")}
                    </Button>
                  ))}
                </div>
              )}
              {tab === "plugins" ? (
                <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                  {entries.map((entry) => (
                    <button
                      key={entry.plugin.id}
                      className="flex items-center gap-3 rounded-xl px-2 py-4 text-left hover:bg-muted/50"
                      onClick={() => props.onSelect(entry)}
                    >
                      <Glyph plugin={entry.plugin} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{titleOf(entry.plugin)}</span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {entry.plugin.interface?.shortDescription ?? entry.marketplaceName}
                        </span>
                      </span>
                      {isInstalledProviderPlugin(entry.plugin) && (
                        <CheckIcon className="size-4 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              ) : tab === "skills" ? (
                <div className="grid gap-x-8 sm:grid-cols-2">
                  {skills.map((skill) => (
                    <button
                      key={skill.path}
                      onClick={() => setSelectedSkill(skill)}
                      className="flex items-center gap-3 rounded-xl py-4 text-left hover:bg-muted/50"
                    >
                      <Glyph skill />
                      <span>
                        <span className="block text-sm font-medium">${skill.name}</span>
                        <span className="text-xs text-muted-foreground">{skill.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid gap-x-8 sm:grid-cols-2">
                  {servers.map((server) => (
                    <button
                      key={server.mention.path}
                      className="flex items-center gap-3 rounded-xl py-4 text-left hover:bg-muted/50"
                      onClick={() =>
                        props.onSelect(
                          props.entries.find((entry) => entry.plugin.id === server.plugin.id) ??
                            null,
                        )
                      }
                    >
                      <Glyph />
                      <span>
                        <span className="block text-sm font-medium">{server.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {t("pluginLibrary.mcpProvider", { plugin: titleOf(server.plugin) })}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {((tab === "plugins" && !entries.length) ||
                (tab === "skills" && !skills.length) ||
                (tab === "mcp" && !servers.length)) && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {t("pluginLibrary.noMatches")}
                </p>
              )}
            </>
          )}
          {selectedSkill && (
            <section className="mt-6 rounded-xl border border-border bg-muted/20 p-5">
              <div className="flex justify-between gap-4">
                <h2 className="text-sm font-medium">${selectedSkill.name}</h2>
                <Button size="sm" variant="ghost" onClick={() => setSelectedSkill(null)}>
                  {t("pluginLibrary.close")}
                </Button>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{selectedSkill.description}</p>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6">
                {BUILT_IN_SKILLS.find((skill) => skill.path === selectedSkill.path)?.instructions ??
                  t("pluginLibrary.skillUseHint", { name: selectedSkill.name })}
              </p>
            </section>
          )}
          {props.loading && (
            <p role="status" className="mt-6 text-sm text-muted-foreground">
              {t("pluginLibrary.loading")}
            </p>
          )}
          {props.error && (
            <p
              role="alert"
              className="mt-6 rounded-lg border border-border p-3 text-sm text-muted-foreground"
            >
              {props.error}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

export function PluginLibrary() {
  const { t } = useTranslation("shell");
  useSyncServerWorkspacePathsFromConfig();
  const { handleNewStudioChat } = useHandleNewStudioChat();
  const [actionError, setActionError] = useState<string | undefined>();
  const firstProject = useStore(useMemo(() => createFirstProjectSelector(), []));
  const { activeProject, activeThread, focusedThreadId } = useFocusedChatContext();
  const [provider, setProvider] = useState<ProviderKind>(
    activeThread?.modelSelection.provider ??
      activeProject?.defaultModelSelection?.provider ??
      "codex",
  );
  const [selected, setSelected] = useState<Entry | null>(null);
  const config = useQuery(serverConfigQueryOptions());
  const cwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: activeThread?.worktreePath ?? null,
    activeProjectCwd: (activeProject ?? firstProject)?.cwd ?? null,
    serverCwd: config.data?.cwd ?? null,
  });
  const caps = useQuery(providerComposerCapabilitiesQueryOptions(provider));
  const plugins = useQuery(
    providerPluginsQueryOptions({
      provider,
      cwd,
      threadId: focusedThreadId,
      enabled: supportsPluginDiscovery(caps.data),
    }),
  );
  const skills = useQuery(
    providerSkillsQueryOptions({
      provider,
      cwd,
      threadId: focusedThreadId,
      enabled: supportsSkillDiscovery(caps.data) && cwd !== null,
    }),
  );
  const mcp = usePluginMcpServers(provider, plugins.data, cwd, focusedThreadId);
  const detail = useQuery(
    providerReadPluginQueryOptions({
      provider,
      marketplacePath: selected?.marketplacePath ?? "builtin://djl",
      pluginName: selected?.plugin.name ?? "social",
      cwd,
      threadId: focusedThreadId,
      enabled: !!selected && !isBuiltIn(selected.plugin.id),
    }),
  );
  const entries = useMemo(
    () => [
      ...builtInEntries,
      ...(plugins.data?.marketplaces ?? []).flatMap((marketplace) =>
        marketplace.plugins.map((plugin) => ({
          plugin,
          marketplaceName: marketplace.name,
          marketplacePath: marketplace.path,
        })),
      ),
    ],
    [plugins.data],
  );
  const traffic = useDesktopTopBarTrafficLightGutterClassName();
  const controls = useDesktopTopBarWindowControlsGutterClassName();
  const navigate = useNavigate();
  return (
    <SidebarInset className="isolate h-dvh min-h-0 overflow-hidden">
      <header
        className={cn(
          "drag-region flex shrink-0 items-center justify-between gap-4 border-b border-border px-4",
          traffic,
          controls,
        )}
      >
        <SidebarHeaderNavigationControls />
        <select
          aria-label={t("pluginLibrary.provider")}
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as ProviderKind);
            setSelected(null);
          }}
          className="no-drag max-w-44 rounded-md bg-transparent px-2 py-1 text-xs"
        >
          {(Object.keys(PROVIDER_DISPLAY_NAMES) as ProviderKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {PROVIDER_DISPLAY_NAMES[kind]}
            </option>
          ))}
        </select>
      </header>
      <PluginLibrarySurface
        entries={entries}
        skills={[...BUILT_IN_SKILLS, ...(skills.data?.skills ?? [])]}
        servers={mcp.servers}
        selected={selected}
        onSelect={setSelected}
        detail={detail.data?.plugin}
        loading={plugins.isFetching || skills.isFetching || detail.isFetching || mcp.isLoading}
        error={
          actionError ??
          plugins.error?.message ??
          skills.error?.message ??
          detail.error?.message ??
          plugins.data?.remoteSyncError ??
          (plugins.data?.marketplaceLoadErrors.map((entry) => entry.message).join(" · ") ||
            mcp.errors.join(" · "))
        }
        onRefresh={() => {
          void plugins.refetch();
          void skills.refetch();
          if (selected && !isBuiltIn(selected.plugin.id)) void detail.refetch();
        }}
        {...{
          onUse: (entry: Entry, prompt: string) => {
            const targetThreadId = focusedThreadId ?? ThreadId.makeUnsafe(crypto.randomUUID());
            const draft = useComposerDraftStore.getState();
            const mention = isBuiltIn(entry.plugin.id)
              ? BUILT_IN_PLUGINS.find((item) => item.plugin.id === entry.plugin.id)!.mention
              : {
                  name: entry.plugin.name,
                  path: `plugin://${entry.plugin.name}@${entry.marketplaceName}`,
                };
            const existing = draft.draftsByThreadId[targetThreadId];
            draft.setMentions(targetThreadId, [
              ...(existing?.mentions ?? []).filter((item) => item.path !== mention.path),
              mention,
            ]);
            draft.setPrompt(
              targetThreadId,
              `${existing?.prompt ? `${existing.prompt}\n\n` : ""}${formatComposerMentionToken(mention.name)} ${prompt}`,
            );
            if (focusedThreadId)
              void navigate({ to: "/$threadId", params: { threadId: focusedThreadId } });
            else
              void handleNewStudioChat({
                fresh: true,
                startupDraftId: targetThreadId,
                ...(!isBuiltIn(entry.plugin.id) ? { provider } : {}),
              })
                .then((result) => {
                  if (!result.ok) setActionError(result.error.detail ?? result.error.summary);
                })
                .catch((error: unknown) =>
                  setActionError(error instanceof Error ? error.message : String(error)),
                );
          },
        }}
      />
    </SidebarInset>
  );
}
