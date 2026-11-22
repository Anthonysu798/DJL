// FILE: PluginDetail.tsx
// Purpose: One plugin's page: what it does, example prompts, its apps and its vendor details.

import {
  isPluginInstalled,
  type PluginApp,
  type PluginAppConnection,
  type PluginAppInput,
  type PluginCatalogEntry,
  type PluginsSnapshot,
} from "@djl/contracts";
import { useTranslation } from "react-i18next";

import {
  ArrowRightIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  ListChecksIcon,
  SettingsIcon,
} from "~/lib/icons";
import { Button } from "../ui/button";
import { PluginActionsMenu } from "./PluginActionsMenu";
import { PluginAppRow } from "./PluginAppRow";
import { PluginGlyph } from "./PluginGlyph";

interface PluginDetailViewProps {
  snapshot: PluginsSnapshot;
  plugin: PluginCatalogEntry;
  pending: boolean;
  error: string | undefined;
  onBack: () => void;
  onAdd: () => void;
  onUninstall: () => void;
  onManage: () => void;
  onConnect: (input: PluginAppInput) => void;
  onDisconnect: (input: PluginAppInput) => void;
  /** Starts a chat with this plugin mentioned and the prompt filled in. */
  onUse: (prompt: string) => void;
  onOpenLink: (url: string) => void;
}

/** A plugin's prompts only work once every one of its apps can actually be called. */
export const isPluginReady = (snapshot: PluginsSnapshot, plugin: PluginCatalogEntry): boolean =>
  plugin.builtIn ||
  (isPluginInstalled(snapshot, plugin) &&
    plugin.apps.every((app) => connectionOf(snapshot, plugin, app)?.state === "connected"));

export const connectionOf = (
  snapshot: PluginsSnapshot,
  plugin: PluginCatalogEntry,
  app: PluginApp,
): PluginAppConnection | undefined =>
  snapshot.connections.find(
    (connection) => connection.pluginId === plugin.id && connection.appId === app.id,
  );

export function PluginDetailView(props: PluginDetailViewProps) {
  const { t } = useTranslation("shell");
  const { plugin, snapshot } = props;
  const installed = isPluginInstalled(snapshot, plugin);
  const ready = isPluginReady(snapshot, plugin);
  const links = [
    [t("pluginLibrary.website"), plugin.websiteUrl],
    [t("pluginLibrary.privacyPolicy"), plugin.privacyPolicyUrl],
    [t("pluginLibrary.termsOfService"), plugin.termsOfServiceUrl],
  ] as const;

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
          <p className="mt-1 text-sm text-muted-foreground">
            {t("pluginLibrary.byDeveloper", { developer: plugin.developer })} ·{" "}
            {plugin.shortDescription}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {installed && !plugin.builtIn ? (
            <PluginActionsMenu plugin={plugin} onUninstall={props.onUninstall} />
          ) : null}
          {installed && !plugin.builtIn ? (
            <Button type="button" size="sm" variant="outline" onClick={props.onManage}>
              <SettingsIcon className="size-4" />
              {t("pluginLibrary.manage")}
            </Button>
          ) : null}
          {installed ? (
            <Button
              type="button"
              size="sm"
              disabled={!ready || plugin.examplePrompts.length === 0}
              onClick={() => props.onUse(plugin.examplePrompts[0]!)}
            >
              {t("pluginLibrary.tryNow")}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={props.pending} onClick={props.onAdd}>
              {t("pluginLibrary.add")}
            </Button>
          )}
        </div>
      </div>

      {props.error ? (
        <p role="alert" className="mt-6 rounded-lg border border-border p-3 text-sm">
          {props.error}
        </p>
      ) : null}

      {plugin.examplePrompts.length > 0 ? (
        <div className="mt-8 space-y-3 rounded-2xl border border-border/70 bg-muted/30 px-5 py-8 sm:px-24">
          {plugin.examplePrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={!ready}
              onClick={() => props.onUse(prompt)}
              className="flex w-full items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background px-4 py-3 text-left text-sm enabled:hover:bg-muted disabled:cursor-default"
            >
              <span>
                <span className="mr-2 text-muted-foreground">{plugin.displayName}</span>
                {prompt}
              </span>
              <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : null}

      {plugin.longDescription ? (
        <p className="mt-8 text-sm leading-6">{plugin.longDescription}</p>
      ) : null}

      {plugin.apps.length > 0 ? (
        <section className="mt-10">
          <SectionHeading title={t("pluginLibrary.apps")} count={plugin.apps.length} />
          <ul>
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
        </section>
      ) : null}

      {plugin.skills.length > 0 ? (
        <section className="mt-6">
          <SectionHeading title={t("pluginLibrary.skills")} count={plugin.skills.length} />
          <ul>
            {plugin.skills.map((skill) => (
              <li key={skill.name} className="flex items-center gap-3 py-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/40">
                  <ListChecksIcon className="size-4 text-foreground/80" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">${skill.name}</span>
                  {skill.description ? (
                    <span className="block text-sm text-muted-foreground">{skill.description}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6">
        <SectionHeading title={t("pluginLibrary.information")} />
        <dl className="mt-4 grid grid-cols-[160px_1fr] gap-y-3 text-sm">
          {plugin.capabilities.length > 0 ? (
            <>
              <dt className="text-muted-foreground">{t("pluginLibrary.capabilities")}</dt>
              <dd>{plugin.capabilities.join(", ")}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{t("pluginLibrary.developer")}</dt>
          <dd>{plugin.developer}</dd>
          <dt className="text-muted-foreground">{t("pluginLibrary.category")}</dt>
          <dd>{plugin.category}</dd>
          <dt className="text-muted-foreground">{t("pluginLibrary.version")}</dt>
          <dd>{plugin.version}</dd>
          {links.map(([label, url]) =>
            url ? (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>
                  <button
                    type="button"
                    className="rounded-sm text-muted-foreground hover:text-foreground"
                    aria-label={t("pluginLibrary.openLink", { label })}
                    title={url}
                    onClick={() => props.onOpenLink(url)}
                  >
                    <ExternalLinkIcon className="size-4" />
                  </button>
                </dd>
              </div>
            ) : null,
          )}
        </dl>
      </section>
    </div>
  );
}

function SectionHeading({ title, count }: { title: string; count?: number }) {
  return (
    <h2 className="border-b border-border pb-3 text-base font-medium">
      {title}
      {count === undefined ? null : <span className="ml-2 text-muted-foreground">{count}</span>}
    </h2>
  );
}
