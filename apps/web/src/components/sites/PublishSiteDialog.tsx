// FILE: PublishSiteDialog.tsx
// Purpose: One-tap publishing of a chat's project to {name}.slcor.site: sign in to DJL, pick a
//          name and accept the hosting terms (first time only), publish, then copy or open the
//          address. Republishing goes straight to the linked site. Errors say what to do next.
// Layer: Chat UI

import { CLOUD_SITE_NAME_PATTERN, type SitesPublishResult, type ThreadId } from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { DjlCloudAccountCard } from "~/components/settings/DjlCloudAccountCard";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "~/lib/icons";
import {
  siteNameQueryOptions,
  siteProjectStatusQueryOptions,
  useSiteActions,
} from "~/lib/sitesReactQuery";
import { ensureNativeApi } from "~/nativeApi";

export const SITE_TERMS_URL = "https://slcor.com/terms#sites";
const SITES_DOMAIN = "slcor.site";

type Failure = Extract<SitesPublishResult, { status: "failed" }>;

function openExternal(url: string) {
  void ensureNativeApi()
    .shell.openExternal(url)
    .catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}

/** The translation key with plain words for a failure code the server can return. */
function failureTitleKey(failure: Failure) {
  const known = [
    "not_signed_in",
    "build_failed",
    "no_site",
    "site_invalid",
    "site_upload_invalid",
    "site_name_taken",
    "site_name_reserved",
    "site_name_invalid",
    "site_limit_reached",
    "site_too_large",
    "site_disabled",
    "sites_paused",
    "rate_limited",
  ];
  return known.includes(failure.code) ? `sites.error.${failure.code}` : "sites.error.generic";
}

export function PublishSiteDialog(props: {
  readonly threadId: ThreadId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("chat");
  const status = useQuery({
    ...siteProjectStatusQueryOptions(props.threadId),
    enabled: props.open,
  });
  const { publish } = useSiteActions();
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [copied, setCopied] = useState(false);
  const linked = status.data?.linkedSite ?? null;
  const firstPublish = !linked;

  useEffect(() => {
    if (status.data && !name) setName(status.data.suggestedName);
  }, [status.data, name]);
  useEffect(() => {
    if (!props.open) {
      publish.reset();
      setCopied(false);
    }
    // `publish.reset` is stable; only reopening matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const trimmed = name.trim().toLowerCase();
  const nameValid = CLOUD_SITE_NAME_PATTERN.test(trimmed);
  const availability = useQuery({
    ...siteNameQueryOptions(trimmed),
    enabled: props.open && firstPublish && nameValid && Boolean(status.data?.signedIn),
  });
  const nameProblem =
    trimmed.length === 0
      ? null
      : !nameValid
        ? t("sites.nameRules")
        : availability.data && !availability.data.available
          ? t(`sites.name.${availability.data.reason ?? "taken"}`)
          : null;

  const result = publish.data;
  const published = result?.status === "published" ? result.site : null;
  const failure = result?.status === "failed" ? result : null;
  const held = published?.pendingDeploy?.status === "held";
  const pending = publish.isPending;
  const canPublish =
    !pending &&
    Boolean(status.data?.signedIn) &&
    (!firstPublish || (nameValid && accepted && availability.data?.available === true));

  const run = () =>
    publish.mutate({
      threadId: props.threadId,
      ...(firstPublish ? { name: trimmed, acceptTerms: true } : {}),
    });

  const body = (() => {
    if (status.isPending) return <Spinner className="mx-auto my-6 size-5" />;
    if (status.data && !status.data.projectAvailable)
      return <p className="text-sm text-muted-foreground">{t("sites.noProject")}</p>;
    if (status.data && !status.data.signedIn)
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("sites.signInFirst")}</p>
          <DjlCloudAccountCard />
        </div>
      );
    if (published)
      return (
        <div className="space-y-4">
          {held ? (
            <p className="text-sm text-pretty text-muted-foreground">{t("sites.heldForReview")}</p>
          ) : null}
          <div className="flex items-center gap-2 rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-sm" title={published.url}>
              {published.url.replace(/^https:\/\//, "")}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t("sites.copyAddress")}
              onClick={() => {
                void navigator.clipboard.writeText(published.url).then(() => setCopied(true));
              }}
            >
              {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t("sites.openSite")}
              onClick={() => openExternal(published.url)}
            >
              <ExternalLinkIcon className="size-4" />
            </Button>
          </div>
        </div>
      );
    return (
      <form
        id="publish-site"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canPublish) run();
        }}
      >
        {firstPublish ? (
          <>
            <label className="block space-y-2 text-xs font-medium">
              <span>{t("sites.nameLabel")}</span>
              <div className="flex items-center gap-1.5">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={pending}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={nameProblem ? true : undefined}
                  aria-describedby="site-name-hint"
                  className="font-mono"
                />
                <span className="shrink-0 font-mono text-sm text-muted-foreground">
                  .{SITES_DOMAIN}
                </span>
              </div>
              <span
                id="site-name-hint"
                className={
                  nameProblem ? "block text-destructive" : "block font-normal text-muted-foreground"
                }
              >
                {nameProblem ??
                  (availability.data?.available ? t("sites.nameAvailable") : t("sites.nameRules"))}
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={accepted}
                onCheckedChange={(value) => setAccepted(value === true)}
                disabled={pending}
                className="mt-0.5"
              />
              <span className="text-pretty">
                {t("sites.terms")}{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => openExternal(SITE_TERMS_URL)}
                >
                  {t("sites.termsLink")}
                </button>
              </span>
            </label>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("sites.republishTo", { address: linked.url.replace(/^https:\/\//, "") })}
          </p>
        )}
        {pending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner className="size-4" />
            {t("sites.publishing")}
          </p>
        ) : null}
        {failure ? (
          <div
            role="alert"
            className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3"
          >
            <p className="text-sm font-medium text-destructive">{t(failureTitleKey(failure))}</p>
            <p className="text-sm text-pretty text-muted-foreground">{failure.message}</p>
            {failure.log ? (
              <pre className="max-h-40 overflow-auto rounded-lg bg-[var(--color-background-elevated-secondary)] p-2 font-mono text-[11px] whitespace-pre-wrap">
                {failure.log}
              </pre>
            ) : null}
            {failure.code === "build_failed" ||
            failure.code === "no_site" ||
            failure.code === "site_invalid" ? (
              <p className="text-xs text-muted-foreground">{t("sites.askToFix")}</p>
            ) : null}
          </div>
        ) : null}
      </form>
    );
  })();

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!pending) props.onOpenChange(open);
      }}
    >
      <DialogPopup surface="solid" className="max-w-lg" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>
            {published
              ? held
                ? t("sites.heldTitle")
                : t("sites.liveTitle")
              : t("sites.publishTitle")}
          </DialogTitle>
          <DialogDescription>
            {published ? t("sites.liveDescription") : t("sites.publishDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>{body}</DialogPanel>
        <DialogFooter>
          {published ? (
            <>
              <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
                {t("sites.done")}
              </Button>
              {!held ? (
                <Button type="button" onClick={() => openExternal(published.url)}>
                  {t("sites.openSite")}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => props.onOpenChange(false)}
              >
                {t("sites.cancel")}
              </Button>
              {status.data?.signedIn && status.data.projectAvailable ? (
                <Button type="submit" form="publish-site" disabled={!canPublish}>
                  {failure
                    ? t("sites.tryAgain")
                    : firstPublish
                      ? t("sites.publish")
                      : t("sites.republish")}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
