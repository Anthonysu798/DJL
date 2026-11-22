import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Campaign } from "@djl/contracts";
import type {
  CloudSocialDraft,
  CloudSocialReviewLink,
  CloudSocialReviewLinkCreated,
} from "@djl/contracts/cloud";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { publishingCommand } from "./socialPublishingClient";
import { SOCIAL_ACCOUNT_CHANGED } from "./accountCache";

/** Owner actions stay in Agent Chat. The one-time bearer URL is held only in this component. */
export function SocialReviewShare({
  campaign,
  version,
  draft,
  disabled = false,
}: {
  campaign: Campaign;
  version: number;
  draft: CloudSocialDraft;
  disabled?: boolean;
}) {
  const { t } = useTranslation("chat");
  const id = useId();
  const client = useQueryClient();
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [hours, setHours] = useState<24 | 72 | 168>(72);
  const [created, setCreated] = useState<{ id: string; revision: number; url: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
    };
    const clear = () => {
      invalidate();
      setCreated(null);
      setAccepted(false);
      setError("");
      setBusy(false);
    };
    window.addEventListener(SOCIAL_ACCOUNT_CHANGED, clear);
    return () => {
      invalidate();
      window.removeEventListener(SOCIAL_ACCOUNT_CHANGED, clear);
    };
  }, [campaign.id, campaign.threadId, version, draft.id, draft.revision]);
  const { copyToClipboard, isCopied } = useCopyToClipboard<number>({
    onError: (_error, current) => {
      if (current !== generation.current) return;
      setError(
        t("socialReview.copyFailed", {
          defaultValue: "Could not copy the link. Select and copy it below.",
        }),
      );
    },
  });
  const key = ["social-review-links", campaign.id, version, draft.id, draft.revision];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      publishingCommand<CloudSocialReviewLink[]>(campaign, version, {
        action: "review-links",
        draftId: draft.id,
      }),
    enabled: open,
    retry: false,
  });
  async function create() {
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await publishingCommand<CloudSocialReviewLinkCreated & { reviewUrl: string }>(
        campaign,
        version,
        {
          action: "create-review-link",
          draftId: draft.id,
          revision: draft.revision,
          expiresInHours: hours,
          disclosureAccepted: accepted,
        },
      );
      if (current !== generation.current) return;
      if (!result.reviewUrl)
        throw new Error(
          t("socialReview.urlUnavailable", {
            defaultValue: "The review website URL is unavailable. Revoke this link and try again.",
          }),
        );
      setCreated({ id: result.link.id, revision: result.link.revision, url: result.reviewUrl });
      await client.invalidateQueries({ queryKey: ["social-review-links", campaign.id] });
    } catch (cause) {
      if (current !== generation.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : t("socialReview.failed", { defaultValue: "Review link request failed." }),
      );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function revoke(link: CloudSocialReviewLink) {
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      await publishingCommand(campaign, version, {
        action: "revoke-review-link",
        draftId: draft.id,
        linkId: link.id,
      });
      if (current !== generation.current) return;
      if (created?.id === link.id) setCreated(null);
      await client.invalidateQueries({ queryKey: ["social-review-links", campaign.id] });
    } catch (cause) {
      if (current !== generation.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : t("socialReview.failed", { defaultValue: "Review link request failed." }),
      );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  const activeCreated = created?.revision === draft.revision ? created : null;
  return (
    <section className="mt-4 border-t border-border pt-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
      >
        {t("socialReview.title", { defaultValue: "Share for review" })}
      </Button>
      {open && (
        <div id={id} className="mt-3 space-y-3 text-sm">
          <p className="text-muted-foreground">
            {t("socialReview.boundary", {
              defaultValue:
                "Feedback applies to this saved version. Publishing still requires your final confirmation in this chat.",
            })}
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              disabled={disabled || busy}
              className="mt-1"
            />{" "}
            <span>
              {t("socialReview.disclosure", {
                defaultValue:
                  "Anyone with this link can view this version's caption and media and submit feedback. Reviewer names are unverified.",
              })}
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-expiry`}>
              {t("socialReview.expires", { defaultValue: "Link expires in" })}
            </label>
            <select
              id={`${id}-expiry`}
              value={hours}
              onChange={(event) => setHours(Number(event.target.value) as 24 | 72 | 168)}
              disabled={disabled || busy}
              className="rounded-md border border-border bg-background p-2"
            >
              <option value={24}>{t("socialReview.oneDay", { defaultValue: "1 day" })}</option>
              <option value={72}>{t("socialReview.threeDays", { defaultValue: "3 days" })}</option>
              <option value={168}>{t("socialReview.sevenDays", { defaultValue: "7 days" })}</option>
            </select>
            <Button
              size="sm"
              disabled={!accepted || disabled || busy}
              onClick={() => void create()}
            >
              {t("socialReview.create", { defaultValue: "Create review link" })}
            </Button>
          </div>
          {activeCreated && (
            <div className="space-y-2">
              <label className="block text-muted-foreground" htmlFor={`${id}-url`}>
                {t("socialReview.copyNow", {
                  defaultValue: "Copy this link now. It is shown only here.",
                })}
              </label>
              <input
                id={`${id}-url`}
                aria-label={t("socialReview.link", { defaultValue: "Review link" })}
                value={activeCreated.url}
                readOnly
                onFocus={(event) => event.target.select()}
                className="w-full rounded-md border border-border bg-background p-2 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(activeCreated.url, generation.current)}
              >
                {isCopied
                  ? t("socialReview.copied", { defaultValue: "Copied" })
                  : t("socialReview.copy", { defaultValue: "Copy link" })}
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {query.error && (
            <p role="alert" className="text-destructive">
              {t("socialReview.loadFailed", { defaultValue: "Could not load review links." })}
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("socialReview.refresh", { defaultValue: "Refresh feedback" })}
          </Button>
          {query.data?.map((link) => (
            <div key={link.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  {t("socialReview.version", {
                    defaultValue: "Version {{revision}}",
                    revision: link.revision,
                  })}{" "}
                  ·{" "}
                  {link.revokedAt
                    ? t("socialReview.revoked", { defaultValue: "Revoked" })
                    : Date.parse(link.expiresAt) <= Date.now()
                      ? t("socialReview.expired", { defaultValue: "Expired" })
                      : t("socialReview.expiryDate", {
                          defaultValue: "Expires {{date}}",
                          date: new Date(link.expiresAt).toLocaleString(),
                        })}
                </p>
                {!link.revokedAt && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || busy}
                    onClick={() => void revoke(link)}
                  >
                    {t("socialReview.revoke", { defaultValue: "Revoke link" })}
                  </Button>
                )}
              </div>
              {!link.isCurrent && (
                <p className="text-muted-foreground">
                  {t("socialReview.stale", {
                    defaultValue: "Draft changed. Earlier approvals do not apply to this version.",
                  })}
                </p>
              )}
              {link.feedback.map((entry) => (
                <div key={entry.id} className="border-t border-border pt-2">
                  <p className="font-medium">
                    {entry.reviewerName}{" "}
                    <span className="font-normal text-muted-foreground">
                      ({t("socialReview.unverified", { defaultValue: "unverified name" })})
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    {entry.decision === "approved"
                      ? t("socialReview.approved", { defaultValue: "Approved for review" })
                      : entry.decision === "changes_requested"
                        ? t("socialReview.changes", { defaultValue: "Changes requested" })
                        : t("socialReview.comment", { defaultValue: "Comment" })}{" "}
                    · {new Date(entry.createdAt).toLocaleString()}
                  </p>
                  {entry.comment && (
                    <p className="whitespace-pre-wrap break-words">{entry.comment}</p>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
