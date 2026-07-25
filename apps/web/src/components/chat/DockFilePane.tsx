// FILE: DockFilePane.tsx
// Purpose: Right-dock pane that previews one workspace file through the shared
//          WorkspaceFilePreview. Markdown opens already parsed (rendered); the
//          shared header carries the source toggle and open-in-editor controls.
// Layer: Chat right-dock UI
// Exports: DockFilePane

import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { ThreadId } from "@synara/contracts";

import type { ChatFileReference } from "~/lib/chatReferences";
import type { FileCommentSelection } from "~/lib/fileComments";
import { WorkspaceFilePreview } from "../WorkspaceFilePreview";
import { PanelStateMessage } from "./PanelStateMessage";

export const DockFilePane = memo(function DockFilePane(props: {
  threadId: ThreadId;
  workspaceRoot: string | null;
  filePath: string | null;
  onReferenceInChat?: ((reference: ChatFileReference) => void) | undefined;
  onAskWhyInChat?: ((reference: ChatFileReference) => void) | undefined;
  onCommentInChat?: ((comment: FileCommentSelection) => void) | undefined;
}) {
  const { t } = useTranslation("chat");
  return (
    <WorkspaceFilePreview
      threadId={props.threadId}
      workspaceRoot={props.workspaceRoot}
      filePath={props.filePath}
      markdownPreviewDefault
      emptyState={
        <PanelStateMessage density="compact" fill="flex">
          <p>{t("dock.clickFile")}</p>
        </PanelStateMessage>
      }
      onReferenceInChat={props.onReferenceInChat}
      onAskWhyInChat={props.onAskWhyInChat}
      onCommentInChat={props.onCommentInChat}
    />
  );
});
