import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconLink } from "@tabler/icons-react";
import { CopyIcon } from "~/lib/icons";
import type { Campaign } from "@djl/contracts";
import type { CloudSocialTrackingLink, CloudSocialTrackingLinkCreated } from "@djl/contracts/cloud";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { agentCommand } from "./agentClient";
import { publishingCommand } from "./socialPublishingClient";
import { SOCIAL_ACCOUNT_CHANGED } from "./accountCache";

export function SocialCampaignLink({
  campaign,
  version,
  platform,
  disabled,
  onApply,
}: {
  campaign: Campaign;
  version: number;
  platform: string;
  disabled: boolean;
  onApply: (url: string) => Promise<unknown>;
}) {
  const id = useId();
  const client = useQueryClient();
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [website, setWebsite] = useState("");
  const [url, setUrl] = useState("");
  const [countOpens, setCountOpens] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
    };
    const clear = () => {
      invalidate();
      setWebsite("");
      setUrl("");
      setCountOpens(false);
      setBusy(false);
      setError("");
    };
    window.addEventListener(SOCIAL_ACCOUNT_CHANGED, clear);
    return () => {
      invalidate();
      window.removeEventListener(SOCIAL_ACCOUNT_CHANGED, clear);
    };
  }, [campaign.id, version]);
  const query = useQuery({
    queryKey: ["social-tracking-links", campaign.id, version],
    queryFn: () =>
      publishingCommand<(CloudSocialTrackingLink & { trackingUrl: string })[]>(campaign, version, {
        action: "tracking-links",
      }),
    enabled: open,
    retry: false,
  });
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onError: () => setError("Could not copy the link. Select it below to copy manually."),
  });
  async function generate() {
    const current = generation.current;
    setBusy(true);
    setError("");
    setUrl("");
    try {
      const tagged = await agentCommand<{ url: string }>(campaign.threadId!, "djl_campaign_link", {
        campaignId: campaign.id,
        version,
        url: website,
        source: platform,
        campaign: campaign.name,
      });
      if (current !== generation.current) return;
      if (countOpens) {
        const created = await publishingCommand<
          CloudSocialTrackingLinkCreated & { trackingUrl: string }
        >(campaign, version, {
          action: "create-tracking-link",
          url: tagged.url,
          expiresInDays: 30,
          disclosureAccepted: true,
        });
        if (current !== generation.current) return;
        setUrl(created.trackingUrl);
        await client.invalidateQueries({ queryKey: ["social-tracking-links", campaign.id] });
      } else setUrl(tagged.url);
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : "Could not prepare the link.");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function revoke(linkId: string) {
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      await publishingCommand(campaign, version, { action: "revoke-tracking-link", linkId });
      if (current !== generation.current) return;
      setUrl("");
      await client.invalidateQueries({ queryKey: ["social-tracking-links", campaign.id] });
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : "Could not turn off the link.");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      await onApply(url);
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : "Could not update the caption.");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <details
      className="rounded-xl border border-border p-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer items-center gap-2 text-xs">
        <IconLink size={15} aria-hidden="true" />
        Campaign link
      </summary>
      <div className="mt-3 space-y-3">
        <label className="block text-xs" htmlFor={`${id}-website`}>
          Website link
        </label>
        <input
          id={`${id}-website`}
          type="url"
          placeholder="https://your-website.com/product"
          value={website}
          onChange={(event) => {
            setWebsite(event.target.value);
            setUrl("");
          }}
          disabled={disabled || busy}
          className="w-full rounded-md border border-border bg-background p-2 text-sm"
        />
        <label className="flex items-center justify-between gap-3 text-sm" htmlFor={`${id}-opens`}>
          Count link opens
          <Switch
            id={`${id}-opens`}
            checked={countOpens}
            disabled={disabled || busy}
            onCheckedChange={(checked) => {
              setCountOpens(checked);
              setUrl("");
            }}
          />
        </label>
        {countOpens && (
          <p className="text-xs text-muted-foreground">
            Creates a public DJL link for 30 days and records aggregate opens. Previews and bots may
            count; opens are not visits, leads, or sales.
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || busy || !website.trim()}
          onClick={() => void generate()}
        >
          {busy ? "Preparing…" : "Prepare link"}
        </Button>
        {url && (
          <>
            <label className="sr-only" htmlFor={`${id}-url`}>
              Prepared link
            </label>
            <input
              id={`${id}-url`}
              value={url}
              readOnly
              onFocus={(event) => event.target.select()}
              className="w-full rounded-md border border-border bg-background p-2 text-xs"
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(url, undefined)}>
                <CopyIcon className="size-3.5" />
                {isCopied ? "Copied" : "Copy link"}
              </Button>
              <Button size="sm" disabled={disabled || busy} onClick={() => void apply()}>
                Add to caption
              </Button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {query.error && (
          <p role="alert" className="text-xs text-destructive">
            Could not load saved links. Your caption is unchanged.
          </p>
        )}
        {!!query.data?.length && (
          <details className="border-t border-border pt-3">
            <summary className="cursor-pointer text-xs">Saved links & opens</summary>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || query.isFetching}
              onClick={() => void query.refetch()}
            >
              Refresh opens
            </Button>
            <p className="text-xs text-muted-foreground">
              Fetched {query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toLocaleString() : "—"}.
              Opens may include previews and bots.
            </p>
            {query.data.map((link) => (
              <div
                key={link.id}
                className="mt-2 space-y-1 rounded-lg border border-border p-3 text-xs"
              >
                <p className="truncate" title={link.targetUrl}>
                  {link.targetUrl}
                </p>
                <p>
                  {link.linkOpens} link opens ·{" "}
                  {link.revokedAt
                    ? "Turned off"
                    : Date.parse(link.expiresAt) <= Date.now()
                      ? "Expired"
                      : `Expires ${new Date(link.expiresAt).toLocaleDateString()}`}
                </p>
                {!link.revokedAt && link.trackingUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(link.trackingUrl, undefined)}
                  >
                    Copy link
                  </Button>
                )}
                {!link.revokedAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled || busy}
                    onClick={() => void revoke(link.id)}
                  >
                    Turn off link
                  </Button>
                )}
              </div>
            ))}
          </details>
        )}
        <p className="text-xs text-muted-foreground">
          Adds campaign labels for {platform}. Instagram caption links may not be clickable; use
          your profile link when appropriate.
        </p>
      </div>
    </details>
  );
}
