import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BrowserFindingDraft, BrowserFindingPromptEntry } from "@synara/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  DRAFT_ATTACHMENT_WARNING_DESCRIPTION_KEY,
  DraftAttachmentWarningIcon,
} from "./DraftAttachmentWarning";

export function BrowserFindingsSummaryChip(props: {
  findings: ReadonlyArray<BrowserFindingDraft | BrowserFindingPromptEntry>;
  images: ReadonlyArray<{ id: string; name: string; previewUrl?: string }>;
  onEditComment?: (findingId: string, comment: string) => void;
  onRemove?: (findingId: string) => void;
  onExpandImage: (preview: ExpandedImagePreview) => void;
  nonPersistedImageIdSet?: ReadonlySet<string>;
}) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  if (props.findings.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}>
        {t("references.browserFindingCount", { count: props.findings.length })}
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" className="max-h-96 w-80 overflow-y-auto p-2">
        <div className="space-y-2">
          {props.findings
            .toSorted((a, b) => a.markerNumber - b.markerNumber)
            .map((finding) => {
              const image = props.images.find((candidate) =>
                "imageId" in finding
                  ? candidate.id === finding.imageId
                  : candidate.name === finding.screenshotName,
              );
              const previewUrl = image?.previewUrl;
              const nonPersisted =
                "imageId" in finding && props.nonPersistedImageIdSet?.has(finding.imageId);
              return (
                <div key={finding.id} className="flex gap-2 rounded-md border border-border p-2">
                  {previewUrl ? (
                    <button
                      type="button"
                      onClick={() =>
                        props.onExpandImage({
                          images: [{ src: previewUrl, name: image.name }],
                          index: 0,
                        })
                      }
                    >
                      <img
                        src={previewUrl}
                        alt={t("references.previewBrowserFinding", {
                          number: finding.markerNumber,
                        })}
                        className="size-12 rounded object-cover"
                      />
                    </button>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <span>
                        #{finding.markerNumber} · {finding.page.title || finding.page.url}
                      </span>
                      {nonPersisted ? (
                        <Tooltip>
                          <TooltipTrigger render={<DraftAttachmentWarningIcon />} />
                          <TooltipPopup side="top" className="max-w-64 whitespace-normal">
                            {t(DRAFT_ATTACHMENT_WARNING_DESCRIPTION_KEY)}
                          </TooltipPopup>
                        </Tooltip>
                      ) : null}
                    </div>
                    {props.onEditComment ? (
                      <FindingCommentInput finding={finding} onEdit={props.onEditComment} />
                    ) : (
                      <p className="text-xs text-foreground">{finding.comment}</p>
                    )}
                  </div>
                  {props.onRemove ? (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => props.onRemove?.(finding.id)}
                      aria-label={t("references.removeBrowserFinding", {
                        number: finding.markerNumber,
                      })}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function FindingCommentInput(props: {
  finding: BrowserFindingDraft | BrowserFindingPromptEntry;
  onEdit: (findingId: string, comment: string) => void;
}) {
  const { t } = useTranslation("chat");
  const [value, setValue] = useState(props.finding.comment);
  useEffect(() => setValue(props.finding.comment), [props.finding.comment]);
  return (
    <Input
      aria-label={t("references.editBrowserFinding", { number: props.finding.markerNumber })}
      value={value}
      className="h-8 text-xs"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const normalized = value.trim();
        if (!normalized) setValue(props.finding.comment);
        else props.onEdit(props.finding.id, normalized);
      }}
    />
  );
}
