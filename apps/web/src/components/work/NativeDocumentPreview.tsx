// High-fidelity Work document preview: local Office->PDF rendering with readable-text recovery.

import type { DocumentArtifactPreview, ThreadId } from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { basenameOfPath } from "~/file-icons";
import {
  projectQueryKeys,
  workDocumentPreviewQueryOptions,
  workDocumentRendererStatusQueryOptions,
  workDocumentRenderQueryOptions,
  workDocumentRenderRequestQueryOptions,
} from "~/lib/projectReactQuery";
import { resolveWsHttpUrl } from "~/lib/wsHttpUrl";
import { ensureNativeApi } from "~/nativeApi";
import { PdfFilePreview } from "../PdfFilePreview";
import { PresentationFilePreview } from "../PresentationFilePreview";
import { WorkspaceFilePreviewHeader } from "../chat/WorkspaceFilePreviewHeader";
import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";

function PageSkeletons(props: { slides?: boolean }) {
  const { t } = useTranslation("workspace");
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-hidden bg-muted/20 px-6 py-8"
      role="status"
      aria-label={t("nativeDocument.preparing")}
    >
      {[0, 1, 2].map((page) => (
        <div
          key={page}
          className={`${props.slides ? "aspect-video max-w-4xl" : "aspect-[8.5/11] max-w-[34rem]"} w-full shrink-0 animate-pulse bg-background shadow-[0_1px_4px_rgba(0,0,0,0.18)] motion-reduce:animate-none`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function ReadableText(props: { artifact: DocumentArtifactPreview }) {
  const { t } = useTranslation("workspace");
  return (
    <article className="mx-auto w-full max-w-3xl px-8 py-10 text-[14px] leading-7 text-foreground">
      <h1 className="mb-8 text-xl font-semibold tracking-tight">{props.artifact.originalName}</h1>
      <div className="space-y-5">
        {props.artifact.blocks.map((block) => {
          const locator = block.locator.slide
            ? t("nativeDocument.locator.slide", { number: block.locator.slide })
            : block.locator.page
              ? t("nativeDocument.locator.page", { number: block.locator.page })
              : block.locator.paragraph
                ? t("nativeDocument.locator.paragraph", { number: block.locator.paragraph })
                : null;
          return (
            <section key={block.id} className="break-words">
              {locator ? (
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {locator}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap">{block.text}</p>
            </section>
          );
        })}
      </div>
    </article>
  );
}

function RecoveryState(props: {
  title: string;
  detail: string;
  rawDetail?: string | null;
  actionLabel?: string;
  actionPending?: boolean;
  onAction?: () => void;
  onReadableText: () => void;
}) {
  const { t } = useTranslation("workspace");
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-12 text-center">
      <div className="max-w-md">
        <h2 className="text-[15px] font-medium text-foreground">{props.title}</h2>
        <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{props.detail}</p>
        {props.rawDetail ? (
          <pre className="mt-2 max-w-full whitespace-pre-wrap text-left text-[11px] text-muted-foreground">
            {props.rawDetail}
          </pre>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {props.actionLabel && props.onAction ? (
            <Button size="sm" disabled={props.actionPending} onClick={props.onAction}>
              {props.actionPending ? t("nativeDocument.installing") : props.actionLabel}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={props.onReadableText}>
            {t("nativeDocument.readableText")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function NativeDocumentPreview(props: {
  threadId: ThreadId | null;
  workspaceRoot: string | null;
  filePath: string;
  sourceType: "docx" | "pptx";
  openInTarget: string | null;
  onReferenceInChat?: Parameters<typeof WorkspaceFilePreviewHeader>[0]["onReferenceInChat"];
  onAskWhyInChat?: Parameters<typeof WorkspaceFilePreviewHeader>[0]["onAskWhyInChat"];
}) {
  const { t } = useTranslation("workspace");
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"native" | "readable">("native");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const statusQuery = useQuery(workDocumentRendererStatusQueryOptions());
  const rendererReady = statusQuery.data?.state === "ready";
  const requestQuery = useQuery(
    workDocumentRenderRequestQueryOptions({
      threadId: props.threadId,
      path: props.filePath,
      enabled: rendererReady && mode === "native",
    }),
  );
  const renderQuery = useQuery(
    workDocumentRenderQueryOptions({
      threadId: props.threadId,
      renderId: requestQuery.data?.renderId ?? null,
      enabled: rendererReady && mode === "native",
    }),
  );
  const readableQuery = useQuery(
    workDocumentPreviewQueryOptions({
      threadId: props.threadId,
      path: props.filePath,
      enabled: mode === "readable" || detailsOpen,
    }),
  );
  const installMutation = useMutation({
    mutationFn: async (repair: boolean) => {
      const renderer = ensureNativeApi().work.documentRenderer;
      return repair ? renderer.repair() : renderer.install();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.workDocumentRendererStatus,
      });
    },
  });
  const preview = renderQuery.data?.preview;
  const previewUrl = useMemo(() => {
    if (!preview) return null;
    const separator = preview.previewUrl.includes("?") ? "&" : "?";
    return resolveWsHttpUrl(
      `${preview.previewUrl}${separator}grant=${encodeURIComponent(preview.previewGrant)}`,
    );
  }, [preview]);
  const showReadable = () => setMode("readable");
  const showNative = () => setMode("native");
  const warnings = [
    ...(preview?.warnings ?? []),
    ...(readableQuery.data?.artifact.warnings ?? []),
  ].filter((warning, index, all) => all.indexOf(warning) === index);

  const header = (
    <WorkspaceFilePreviewHeader
      workspaceRoot={props.workspaceRoot}
      filePath={props.filePath}
      isMarkdown={false}
      markdownPreviewEnabled={false}
      onMarkdownPreviewChange={() => undefined}
      onReferenceInChat={props.onReferenceInChat}
      onAskWhyInChat={props.onAskWhyInChat}
      truncated={false}
      defaultEditor="system-default"
    />
  );

  let body;
  if (mode === "readable") {
    body = readableQuery.data ? (
      <div className="min-h-0 flex-1 overflow-auto bg-background">
        <div className="sticky top-0 z-10 flex h-9 items-center justify-end border-b border-border/60 bg-background/95 px-3 backdrop-blur">
          <Button size="xs" variant="chrome" onClick={showNative} disabled={!rendererReady}>
            {t("nativeDocument.nativePreview")}
          </Button>
        </div>
        <ReadableText artifact={readableQuery.data.artifact} />
      </div>
    ) : readableQuery.error ? (
      <RecoveryState
        title={t("nativeDocument.errors.readableTitle")}
        detail={t("nativeDocument.errors.readableSummary")}
        rawDetail={readableQuery.error instanceof Error ? readableQuery.error.message : null}
        onReadableText={() => void readableQuery.refetch()}
      />
    ) : (
      <PageSkeletons slides={props.sourceType === "pptx"} />
    );
  } else if (statusQuery.isLoading) {
    body = <PageSkeletons slides={props.sourceType === "pptx"} />;
  } else if (!statusQuery.data || statusQuery.error) {
    body = (
      <RecoveryState
        title={t("nativeDocument.errors.viewerTitle")}
        detail={t("nativeDocument.errors.viewerSummary")}
        rawDetail={statusQuery.error instanceof Error ? statusQuery.error.message : null}
        onReadableText={showReadable}
      />
    );
  } else if (statusQuery.data.state !== "ready") {
    const canInstall = statusQuery.data.installAvailable;
    const repair = statusQuery.data.state === "unhealthy";
    body = (
      <RecoveryState
        title={repair ? t("nativeDocument.repair.title") : t("nativeDocument.install.title")}
        detail={t("nativeDocument.install.summary")}
        rawDetail={
          (installMutation.error instanceof Error ? installMutation.error.message : null) ??
          statusQuery.data.detail
        }
        {...(canInstall
          ? {
              actionLabel: repair
                ? t("nativeDocument.repair.action")
                : t("nativeDocument.install.action"),
              onAction: () => installMutation.mutate(repair),
            }
          : {})}
        actionPending={installMutation.isPending || statusQuery.data.state === "installing"}
        onReadableText={showReadable}
      />
    );
  } else if (requestQuery.error || renderQuery.data?.state === "failed") {
    body = (
      <RecoveryState
        title={t("nativeDocument.errors.previewTitle")}
        detail={t("nativeDocument.errors.previewSummary")}
        rawDetail={
          renderQuery.data?.error ??
          (requestQuery.error instanceof Error ? requestQuery.error.message : null)
        }
        onReadableText={showReadable}
      />
    );
  } else if (!previewUrl || !preview) {
    body = <PageSkeletons slides={props.sourceType === "pptx"} />;
  } else if (props.sourceType === "pptx") {
    body = (
      <PresentationFilePreview
        fileName={basenameOfPath(props.filePath)}
        previewUrl={previewUrl}
        openInTarget={props.openInTarget}
        warnings={warnings}
        onShowReadableText={showReadable}
        onToggleDetails={() => setDetailsOpen((open) => !open)}
        detailsOpen={detailsOpen}
        controlsOnly
      />
    );
  } else {
    body = (
      <PdfFilePreview
        filePath={props.filePath}
        cwd={props.workspaceRoot}
        previewUrl={previewUrl}
        openInTarget={props.openInTarget}
        documentType="DOCX"
        warnings={warnings}
        onShowReadableText={showReadable}
        onToggleDetails={() => setDetailsOpen((open) => !open)}
        detailsOpen={detailsOpen}
        controlsOnly
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-background-surface)]">
      {header}
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      <DisclosureRegion open={detailsOpen} className="shrink-0">
        <div className="max-h-44 overflow-auto border-t border-border/60 bg-background px-5 py-4 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">{t("nativeDocument.details.title")}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt>{t("nativeDocument.details.renderer")}</dt>
            <dd>
              {preview?.rendererVersion ??
                statusQuery.data?.rendererVersion ??
                t("nativeDocument.details.unavailable")}
            </dd>
            <dt>{t("nativeDocument.details.pages")}</dt>
            <dd>{preview?.pageCount ?? "—"}</dd>
            <dt>{t("nativeDocument.details.textExtraction")}</dt>
            <dd>
              {readableQuery.data?.artifact.extractionMethod ?? t("nativeDocument.details.loading")}
            </dd>
          </dl>
          {warnings.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-4">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </DisclosureRegion>
    </div>
  );
}
