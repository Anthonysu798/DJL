// FILE: WorkTurnFileCards.tsx
// Purpose: In a Work chat, lists under a finished reply the files that turn produced. A card
//          previews its file in DJL; the buttons open it in the computer's own app or show it
//          in its folder. Paths arrive relative to the chat's folder, so the server resolves
//          each one before it is opened.
// Layer: Chat transcript UI
// Depends on: work.resolveArtifactPath, the workspace file opener and shell open/reveal.

import { isOpenableDocumentPath } from "@djl/shared/openableFiles";
import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { useWorkspaceFileOpener } from "~/lib/workspaceFileOpener";
import { readNativeApi } from "~/nativeApi";

import { SiteThreadContext } from "../sites/SiteReadyCard";
import { FileEntryIcon } from "./FileEntryIcon";

const ACTION_CLASS_NAME =
  "shrink-0 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60";

export function WorkTurnFileCards({ paths }: { paths: ReadonlyArray<string> }) {
  const { t } = useTranslation("chat");
  const threadId = useContext(SiteThreadContext);
  const fileOpener = useWorkspaceFileOpener();

  // A file the agent has since moved or deleted simply does nothing when clicked.
  const withFullPath = (path: string, open: (fullPath: string) => unknown) => {
    const api = readNativeApi();
    if (!api || !threadId) return;
    void api.work
      .resolveArtifactPath({ threadId, path })
      .then((resolved) => open(resolved.path))
      .catch(() => {});
  };
  const showInFolder = (fullPath: string) => readNativeApi()?.shell.showInFolder(fullPath);

  return (
    <div className="mt-3 flex flex-col gap-1.5" data-work-turn-files="">
      {paths.map((path) => {
        const name = path.split("/").at(-1) ?? path;
        return (
          <div
            key={path}
            className="flex items-center gap-1 rounded-lg border border-border/65 bg-background/35 py-1 pl-1 pr-1.5"
          >
            <button
              type="button"
              aria-label={t("timeline.workFiles.preview", { name })}
              title={path}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground/90 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
              onClick={() =>
                withFullPath(path, (fullPath) => {
                  if (!fileOpener?.openFile(fullPath)) void showInFolder(fullPath);
                })
              }
            >
              <FileEntryIcon pathValue={name} kind="file" mimeType={null} />
              <span className="truncate">{name}</span>
            </button>
            {/* An agent wrote these files: only a document, image or media file may be
                handed to the system to open. Anything else is reachable through its folder. */}
            {isOpenableDocumentPath(name) ? (
              <button
                type="button"
                className={ACTION_CLASS_NAME}
                onClick={() =>
                  withFullPath(path, (fullPath) => {
                    const shell = readNativeApi()?.shell;
                    return shell?.openPath ? shell.openPath(fullPath) : showInFolder(fullPath);
                  })
                }
              >
                {t("timeline.workFiles.openInApp")}
              </button>
            ) : null}
            <button
              type="button"
              className={ACTION_CLASS_NAME}
              onClick={() => withFullPath(path, showInFolder)}
            >
              {t("timeline.workFiles.showInFolder")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
