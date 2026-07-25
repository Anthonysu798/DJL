// FILE: LocalImagePreview.tsx
// Purpose: Shared local-image loading state and error card, plus the panel
//          preview surface used by editor file and diff views.
// Layer: Web UI primitive
// Exports: useLocalImagePreview, LocalImageErrorCard, LocalImagePreview
// Notes: Pure UI; image URL building lives in `~/lib/localImageUrls`. The chat
//        markdown variant (`GeneratedMarkdownImage`) composes the same hook and
//        error card with its own inline frame/overlay rendering.

import {
  type ImgHTMLAttributes,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { downloadUrlAsBlob } from "~/lib/browserDownload";
import { DownloadIcon, Loader2Icon, TriangleAlertIcon } from "~/lib/icons";
import { buildLocalImageUrl, localImageFileName } from "~/lib/localImageUrls";
import { cn } from "~/lib/utils";
import { toastManager } from "./ui/toast";

export type LocalImagePreviewStatus = "loading" | "ready" | "error";

type LocalImagePreviewImgProps = Pick<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "loading" | "decoding" | "draggable" | "onLoad" | "onError"
>;

export interface LocalImagePreviewState {
  previewUrl: string;
  downloadUrl: string;
  fileName: string;
  /** Value for `<a download>`: it needs a string, and an empty string still
      hints the browser to download instead of navigating. */
  downloadName: string;
  status: LocalImagePreviewStatus;
  imgProps: LocalImagePreviewImgProps;
}

export function useLocalImagePreview(input: {
  src: string;
  cwd: string | null | undefined;
  previewGrant?: string | null | undefined;
}): LocalImagePreviewState {
  const { src, cwd, previewGrant } = input;
  const previewUrl = useMemo(
    () => buildLocalImageUrl({ src, cwd: cwd ?? undefined, grant: previewGrant }),
    [cwd, previewGrant, src],
  );
  const downloadUrl = useMemo(
    () => buildLocalImageUrl({ src, cwd: cwd ?? undefined, download: true, grant: previewGrant }),
    [cwd, previewGrant, src],
  );
  const fileName = useMemo(() => localImageFileName(src), [src]);
  const [status, setStatus] = useState<LocalImagePreviewStatus>("loading");

  useEffect(() => {
    setStatus("loading");
  }, [previewUrl]);

  const imgProps = useMemo<LocalImagePreviewImgProps>(
    () => ({
      src: previewUrl,
      loading: "lazy",
      decoding: "async",
      draggable: false,
      onLoad: () => setStatus("ready"),
      onError: () => setStatus("error"),
    }),
    [previewUrl],
  );

  return { previewUrl, downloadUrl, fileName, downloadName: fileName || "", status, imgProps };
}

// Handles local-image downloads imperatively so failed API responses surface as
// toasts instead of replacing the whole desktop window with a 404 page.
export function useLocalImageDownloadClick(input: {
  downloadUrl: string;
  downloadName: string;
  errorTitle?: string | undefined;
}) {
  const { t } = useTranslation("workspace");
  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void downloadUrlAsBlob({
        url: input.downloadUrl,
        filename: input.downloadName,
      }).catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: input.errorTitle ?? t("preview.errors.image.downloadFailed"),
          description: error instanceof Error ? error.message : t("preview.errors.image.summary"),
        });
      });
    },
    [input.downloadName, input.downloadUrl, input.errorTitle, t],
  );
}

// Span-only markup so the card stays valid inside markdown paragraphs.
export function LocalImageErrorCard(props: {
  downloadUrl: string;
  /** `downloadName` from useLocalImagePreview. */
  downloadName: string;
  className?: string | undefined;
  downloadAriaLabel?: string;
  onDownloadClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
}) {
  const { t } = useTranslation("workspace");
  return (
    <span className={cn("local-image-error", props.className)}>
      <span className="local-image-error__icon" aria-hidden="true">
        <TriangleAlertIcon className="size-4" />
      </span>
      <span className="local-image-error__body">
        <span className="local-image-error__title">{t("preview.errors.image.title")}</span>
        <span className="local-image-error__subtitle">{t("preview.errors.image.summary")}</span>
      </span>
      <a
        href={props.downloadUrl}
        download={props.downloadName}
        onClick={props.onDownloadClick}
        className="local-image-error__action"
        aria-label={props.downloadAriaLabel ?? t("preview.actions.downloadImage")}
      >
        <DownloadIcon className="size-3.5" aria-hidden="true" />
        <span>{t("preview.actions.downloadImage")}</span>
      </a>
    </span>
  );
}

export function LocalImagePreview(props: {
  src: string;
  cwd: string | null | undefined;
  previewGrant?: string | null | undefined;
  alt: string;
  className?: string;
  imageClassName?: string;
}) {
  const { t } = useTranslation("workspace");
  const { downloadUrl, downloadName, status, imgProps } = useLocalImagePreview({
    src: props.src,
    cwd: props.cwd,
    previewGrant: props.previewGrant,
  });
  const handleDownloadClick = useLocalImageDownloadClick({ downloadUrl, downloadName });

  if (status === "error") {
    return (
      <LocalImageErrorCard
        downloadUrl={downloadUrl}
        downloadName={downloadName}
        className={props.className}
        onDownloadClick={handleDownloadClick}
      />
    );
  }

  return (
    <div className={cn("local-image-preview", props.className)} data-status={status}>
      {status === "loading" ? (
        <span className="local-image-preview__skeleton" aria-hidden="true">
          <Loader2Icon className="size-4 animate-spin opacity-60" />
        </span>
      ) : null}
      <img
        {...imgProps}
        alt={props.alt}
        className={cn("local-image-preview__img", props.imageClassName)}
      />
      <a
        href={downloadUrl}
        download={downloadName}
        onClick={handleDownloadClick}
        className="local-image-preview__download"
        aria-label={t("preview.actions.downloadImage")}
        title={t("preview.actions.downloadImage")}
      >
        <DownloadIcon className="size-3.5" aria-hidden="true" />
      </a>
    </div>
  );
}
