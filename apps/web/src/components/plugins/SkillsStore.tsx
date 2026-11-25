// FILE: SkillsStore.tsx
// Purpose: The Skills tab of the Plugins page: reviewed skills by category, live skills.sh
//          search (marked unreviewed), installed skills with updates, a detail sheet with the
//          SKILL.md preview, and consent before a skill with scripts or over the user's edits.
// Layer: Plugins page view. Data: `~/lib/skillsStoreReactQuery`; server: `skillsStore.*` RPCs.

import {
  SKILLS_STORE_CATEGORIES,
  type SkillsStoreCatalogEntry,
  type SkillsStoreCategory,
  type SkillsStoreInstalledSkill,
  type SkillsStoreSearchResult,
  type SkillsStoreSummary,
} from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { CentralIcon } from "~/lib/central-icons";
import {
  CheckIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "~/lib/icons";
import { rankProviderDiscoveryItems } from "~/lib/providerDiscovery";
import {
  skillsStorePreviewQueryOptions,
  skillsStoreSearchQueryOptions,
  skillsStoreSnapshotQueryOptions,
  useSkillsStoreActions,
} from "~/lib/skillsStoreReactQuery";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "../ui/sheet";

const CATEGORY_ICONS: Record<SkillsStoreCategory, string> = {
  design: "color-palette",
  coding: "code-analyze",
  documents: "file-text",
  writing: "text-edit",
  research: "search-intelligence",
  data: "layout-dashboard",
  tools: "lightning",
};

/** One skill as the page shows it, whether it came from the catalog, search or installs. */
interface StoreItem {
  readonly id: string;
  readonly name: string;
  readonly repo: string;
  readonly summary: SkillsStoreSummary | null;
  readonly category: SkillsStoreCategory | null;
  readonly license: string | null;
  readonly installs: number | null;
  readonly kind: "builtIn" | "reviewed" | "unreviewed";
  readonly hasScripts: boolean;
  /** False for skills hosted outside GitHub. */
  readonly installable: boolean;
  readonly installed: SkillsStoreInstalledSkill | null;
}

function fromCatalog(
  entry: SkillsStoreCatalogEntry,
  installed: SkillsStoreInstalledSkill | undefined,
): StoreItem {
  return {
    id: entry.id,
    name: entry.name,
    repo: entry.repo,
    summary: entry.summary,
    category: entry.category,
    license: entry.license,
    installs: entry.installs ?? null,
    kind: entry.builtIn ? "builtIn" : "reviewed",
    hasScripts: entry.hasScripts,
    installable: !entry.builtIn,
    installed: installed ?? null,
  };
}

function fromSearch(
  result: SkillsStoreSearchResult,
  installed: SkillsStoreInstalledSkill | undefined,
): StoreItem {
  return {
    id: result.id,
    name: result.name,
    repo: result.repo,
    summary: null,
    category: null,
    license: installed?.license ?? null,
    installs: result.installs,
    kind: "unreviewed",
    hasScripts: false,
    installable: result.installable,
    installed: installed ?? null,
  };
}

function fromInstalled(installed: SkillsStoreInstalledSkill): StoreItem {
  return {
    id: installed.id,
    name: installed.name,
    repo: installed.repo,
    summary: null,
    category: null,
    license: installed.license,
    installs: null,
    kind: "unreviewed",
    hasScripts: false,
    installable: true,
    installed,
  };
}

function useSummary() {
  const { i18n } = useTranslation();
  return (summary: SkillsStoreSummary | null): string | null => {
    if (!summary) return null;
    const language = (i18n.resolvedLanguage ?? i18n.language) as keyof SkillsStoreSummary;
    return summary[language] ?? summary.en;
  };
}

function useCompactNumber() {
  const { i18n } = useTranslation();
  const format = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return (value: number) => format.format(value);
}

type Consent = { item: StoreItem; reason: "scripts" | "edits"; files: ReadonlyArray<string> };

export function SkillsStoreView(props: { heading: ReactNode }) {
  const { t } = useTranslation("shell");
  const summaryText = useSummary();
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 350);
    return () => window.clearTimeout(timer);
  }, [query]);
  const snapshot = useQuery(skillsStoreSnapshotQueryOptions());
  const live = useQuery(skillsStoreSearchQueryOptions(debouncedQuery));
  const { install, remove } = useSkillsStoreActions();
  const [openId, setOpenId] = useState<string | null>(null);
  const [consent, setConsent] = useState<Consent | null>(null);

  const installedById = new Map(snapshot.data?.installed.map((skill) => [skill.id, skill]));
  const catalog = (snapshot.data?.catalog ?? []).map((entry) =>
    fromCatalog(entry, installedById.get(entry.id)),
  );
  const catalogIds = new Set(catalog.map((item) => item.id));
  const installedItems = (snapshot.data?.installed ?? []).map(
    (skill) => catalog.find((item) => item.id === skill.id) ?? fromInstalled(skill),
  );
  const searching = query.trim().length > 0;
  const reviewedMatches = searching
    ? rankProviderDiscoveryItems(catalog, query, (item) => [
        { value: item.name },
        { value: summaryText(item.summary) ?? "" },
        { value: item.repo },
      ])
    : [];
  const liveItems = (live.data ?? [])
    .filter((result) => !catalogIds.has(result.id))
    .map((result) => fromSearch(result, installedById.get(result.id)));
  const items = [...catalog, ...liveItems, ...installedItems];
  const open = items.find((item) => item.id === openId) ?? null;

  const runInstall = (
    item: StoreItem,
    flags: { allowScripts?: boolean; overwriteEdits?: boolean } = {},
  ) =>
    install.mutate(
      { id: item.id, ...flags },
      {
        onSuccess: (result) => {
          if (result.status === "needsConsent")
            setConsent({ item, reason: result.reason, files: result.files });
        },
      },
    );
  const pendingId = install.isPending
    ? install.variables?.id
    : remove.isPending
      ? remove.variables
      : undefined;
  const rowProps = {
    pendingId,
    onOpen: (item: StoreItem) => setOpenId(item.id),
    onInstall: (item: StoreItem) => runInstall(item),
  };
  const error = (install.error ?? remove.error ?? snapshot.error)?.message;

  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 pb-16 pt-8 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {props.heading}
        <div className="flex items-center gap-2">
          <div className="relative w-64 max-w-full">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="rounded-full pl-9"
              aria-label={t("skillsStore.search")}
              placeholder={t("skillsStore.search")}
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
            onClick={() => void snapshot.refetch()}
          >
            <RefreshCwIcon className="size-4" />
          </Button>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{t("skillsStore.hint")}</p>

      {error ? (
        <p role="alert" className="mt-6 rounded-lg border border-border p-3 text-sm">
          {error}
        </p>
      ) : null}
      {snapshot.isPending ? (
        <p role="status" className="mt-10 text-sm text-muted-foreground">
          {t("pluginLibrary.loading")}
        </p>
      ) : null}

      {snapshot.data && searching ? (
        <>
          <SkillSection
            title={t("skillsStore.reviewedResults")}
            items={reviewedMatches}
            {...rowProps}
          />
          <section className="mt-10" aria-label={t("skillsStore.liveResults")}>
            <h2 className="mb-1 text-base font-medium">{t("skillsStore.liveResults")}</h2>
            <p className="mb-3 text-[13px] text-muted-foreground">{t("skillsStore.liveHint")}</p>
            {debouncedQuery.trim().length < 2 ? null : live.isFetching && !live.data ? (
              <p role="status" className="py-3 text-sm text-muted-foreground">
                {t("skillsStore.searching")}
              </p>
            ) : live.isError ? (
              <p role="alert" className="py-3 text-sm text-muted-foreground">
                {t("skillsStore.searchFailed")}
              </p>
            ) : liveItems.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">{t("skillsStore.noMatches")}</p>
            ) : (
              <SkillGrid items={liveItems} {...rowProps} />
            )}
          </section>
        </>
      ) : null}

      {snapshot.data && !searching ? (
        <>
          <SkillSection title={t("skillsStore.installed")} items={installedItems} {...rowProps} />
          {SKILLS_STORE_CATEGORIES.map((category) => (
            <SkillSection
              key={category}
              title={t(`skillsStore.categories.${category}`)}
              items={catalog.filter((item) => item.category === category)}
              {...rowProps}
            />
          ))}
        </>
      ) : null}

      <SkillDetailSheet
        item={open}
        pending={open !== null && pendingId === open.id}
        onClose={() => setOpenId(null)}
        onInstall={(item) => runInstall(item)}
        onRemove={(item) => remove.mutate(item.id)}
      />
      <AlertDialog open={consent !== null} onOpenChange={(next) => !next && setConsent(null)}>
        <AlertDialogPopup>
          {consent ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {consent.reason === "scripts"
                    ? t("skillsStore.consentScriptsTitle")
                    : t("skillsStore.consentEditsTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {consent.reason === "scripts"
                    ? t("skillsStore.consentScriptsBody", {
                        name: consent.item.name,
                        owner: consent.item.repo.split("/")[0],
                      })
                    : t("skillsStore.consentEditsBody", { name: consent.item.name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {consent.files.length > 0 ? (
                <ul className="mx-6 mb-2 max-h-32 overflow-y-auto rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
                  {consent.files.map((file) => (
                    <li key={file} className="truncate">
                      {file}
                    </li>
                  ))}
                </ul>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="outline" size="sm" />}>
                  {t("actions.cancel", { ns: "common" })}
                </AlertDialogClose>
                <Button
                  size="sm"
                  variant={consent.reason === "edits" ? "destructive" : "default"}
                  onClick={() => {
                    const { item, reason } = consent;
                    setConsent(null);
                    runInstall(item, {
                      allowScripts: true,
                      ...(reason === "edits" ? { overwriteEdits: true } : {}),
                    });
                  }}
                >
                  {consent.reason === "scripts"
                    ? t("skillsStore.installAnyway")
                    : t("skillsStore.replaceChanges")}
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

interface RowHandlers {
  pendingId: string | undefined;
  onOpen: (item: StoreItem) => void;
  onInstall: (item: StoreItem) => void;
}

function SkillSection(props: RowHandlers & { title: string; items: ReadonlyArray<StoreItem> }) {
  if (props.items.length === 0) return null;
  return (
    <section className="mt-10" aria-label={props.title}>
      <h2 className="mb-3 text-base font-medium">{props.title}</h2>
      <SkillGrid {...props} />
    </section>
  );
}

function SkillGrid(props: RowHandlers & { items: ReadonlyArray<StoreItem> }) {
  return (
    <ul className="grid gap-x-10 sm:grid-cols-2">
      {props.items.map((item) => (
        <SkillRow key={item.id} item={item} {...props} />
      ))}
    </ul>
  );
}

function SkillGlyph(props: { item: StoreItem; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-muted text-foreground/75",
        props.size === "sm" ? "size-8" : "size-10",
      )}
    >
      <CentralIcon
        name={props.item.category ? CATEGORY_ICONS[props.item.category] : "book"}
        className={props.size === "sm" ? "size-4" : "size-5"}
      />
    </span>
  );
}

function SkillMeta(props: { item: StoreItem }) {
  const { t } = useTranslation("shell");
  const compact = useCompactNumber();
  const { item } = props;
  const parts = [
    item.repo.split("/")[0],
    item.license,
    item.installs ? t("skillsStore.installs", { value: compact(item.installs) }) : null,
  ].filter(Boolean);
  return <span className="truncate">{parts.join(" · ")}</span>;
}

function SkillRow(props: RowHandlers & { item: StoreItem }) {
  const { t } = useTranslation("shell");
  const summaryText = useSummary();
  const { item } = props;
  const pending = props.pendingId === item.id;
  const summary = summaryText(item.summary);
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-muted/50"
        onClick={() => props.onOpen(item)}
      >
        <SkillGlyph item={item} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{item.name}</span>
            {item.kind === "unreviewed" ? (
              <span className="skills-store-tag">{t("skillsStore.unreviewed")}</span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {summary ?? <SkillMeta item={item} />}
          </span>
          {summary ? (
            <span className="mt-0.5 flex text-xs text-muted-foreground/75">
              <SkillMeta item={item} />
            </span>
          ) : null}
        </span>
      </button>
      <SkillRowAction
        item={item}
        pending={pending}
        onInstall={props.onInstall}
        onOpen={props.onOpen}
      />
    </li>
  );
}

function SkillRowAction(props: {
  item: StoreItem;
  pending: boolean;
  onInstall: (item: StoreItem) => void;
  onOpen: (item: StoreItem) => void;
}) {
  const { t } = useTranslation("shell");
  const { item } = props;
  if (props.pending)
    return (
      <span className="flex size-8 items-center justify-center text-muted-foreground" role="status">
        <LoaderCircleIcon className="size-4 animate-spin" aria-label={t("skillsStore.working")} />
      </span>
    );
  if (item.kind === "builtIn")
    return <span className="skills-store-tag mr-2">{t("skillsStore.builtIn")}</span>;
  if (item.installed?.updateAvailable)
    return (
      <Button type="button" size="xs" variant="outline" onClick={() => props.onInstall(item)}>
        {t("skillsStore.update")}
      </Button>
    );
  if (item.installed)
    return (
      <span
        className="flex size-8 items-center justify-center text-emerald-600 dark:text-emerald-400"
        title={t("skillsStore.installedTag")}
      >
        <CheckIcon className="size-4" aria-label={t("skillsStore.installedTag")} />
      </span>
    );
  if (!item.installable)
    return (
      <span className="mr-2 text-xs text-muted-foreground">{t("skillsStore.notOnGitHub")}</span>
    );
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={t("skillsStore.installNamed", { name: item.name })}
      title={t("skillsStore.installNamed", { name: item.name })}
      onClick={() => props.onInstall(item)}
    >
      <PlusIcon className="size-5" />
    </Button>
  );
}

function SkillDetailSheet(props: {
  item: StoreItem | null;
  pending: boolean;
  onClose: () => void;
  onInstall: (item: StoreItem) => void;
  onRemove: (item: StoreItem) => void;
}) {
  const { t } = useTranslation("shell");
  const summaryText = useSummary();
  const { item } = props;
  // Skills hosted outside GitHub have nothing DJL can fetch.
  const preview = useQuery(
    skillsStorePreviewQueryOptions(
      item && (item.installable || item.kind === "builtIn") ? item.id : null,
    ),
  );
  const githubUrl = item ? `https://github.com/${item.repo}` : "";
  return (
    <Sheet open={item !== null} onOpenChange={(next) => !next && props.onClose()}>
      <SheetPopup side="right" className="w-[min(94vw,520px)] max-w-[520px]">
        {item ? (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <SkillGlyph item={item} />
                <div className="min-w-0">
                  <SheetTitle className="truncate">{item.name}</SheetTitle>
                  <SheetDescription className="flex text-xs">
                    <SkillMeta item={item} />
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <SheetPanel className="space-y-5">
              {summaryText(item.summary) ? (
                <p className="text-sm text-foreground/85">{summaryText(item.summary)}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {item.kind === "builtIn" ? (
                  <span className="text-sm text-muted-foreground">
                    {t("skillsStore.builtInNote")}
                  </span>
                ) : item.installed ? (
                  <>
                    {item.installed.updateAvailable ? (
                      <Button
                        size="sm"
                        disabled={props.pending}
                        onClick={() => props.onInstall(item)}
                      >
                        {t("skillsStore.update")}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="destructive-outline"
                      disabled={props.pending}
                      onClick={() => props.onRemove(item)}
                    >
                      {t("skillsStore.remove")}
                    </Button>
                  </>
                ) : item.installable ? (
                  <Button size="sm" disabled={props.pending} onClick={() => props.onInstall(item)}>
                    {props.pending ? (
                      <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : (
                      <PlusIcon className="size-4" />
                    )}
                    {props.pending ? t("skillsStore.installing") : t("skillsStore.install")}
                  </Button>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t("skillsStore.notOnGitHub")}
                  </span>
                )}
                {item.repo.includes("/") ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void ensureNativeApi().shell.openExternal(githubUrl)}
                  >
                    <ExternalLinkIcon className="size-4" />
                    {t("skillsStore.viewOnGitHub")}
                  </Button>
                ) : null}
              </div>
              {item.installed?.edited ? (
                <p className="text-[13px] text-muted-foreground">{t("skillsStore.edited")}</p>
              ) : null}
              {item.kind === "unreviewed" ? (
                <p className="skills-store-note">
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                  {t("skillsStore.unreviewedNote")}
                </p>
              ) : item.hasScripts && item.kind === "reviewed" ? (
                <p className="skills-store-note">
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                  {t("skillsStore.scriptsWarning")}
                </p>
              ) : null}
              <section aria-label="SKILL.md">
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">SKILL.md</h3>
                {preview.isLoading ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t("pluginLibrary.loading")}
                  </p>
                ) : preview.isError ? (
                  <p className="text-sm text-muted-foreground">{t("skillsStore.previewFailed")}</p>
                ) : preview.data ? (
                  <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xl bg-muted/50 p-4 font-mono text-xs leading-relaxed text-foreground/85">
                    {preview.data}
                  </pre>
                ) : null}
              </section>
            </SheetPanel>
          </>
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}
