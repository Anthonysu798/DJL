import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { MessageId, type ThreadId, type ModelSelection } from "@synara/contracts";
import type { ComposerPromptEditorHandle } from "../components/ComposerPromptEditor";
import { flushComposerDraftPersistence, useComposerDraftStore } from "../composerDraftStore";
import { isProviderKind } from "../providerOrdering";
import { useStore } from "../store";
import { toastManager } from "../components/ui/toast";
import { copyTextToClipboard } from "../hooks/useCopyToClipboard";
import { getStartupSession } from "./session";
import { getStartupCopy } from "./copy";
import type { StartupSurface } from "./types";

interface StartupBridgeInput {
  threadId: ThreadId;
  surface: StartupSurface;
  prompt: string;
  model: ModelSelection;
  active: boolean;
  canSend: boolean;
  editor: RefObject<ComposerPromptEditorHandle | null>;
  send: RefObject<() => Promise<boolean>>;
  locale: string;
}
const noSubscription = () => () => {};
const zero = () => 0;

/** Bridges a local startup draft into the existing composer without an extra send path. */
export function useStartupDraftBridge(input: StartupBridgeInput): void {
  const session = getStartupSession();
  const revision = useSyncExternalStore(
    session?.subscribe ?? noSubscription,
    session?.getVersion ?? zero,
    zero,
  );
  const latest = useRef(input);
  latest.current = input;
  const transferred = useRef(false);
  const notifiedRecovery = useRef(false);
  const dispatching = useRef(false);
  const notifiedStorageFailure = useRef(false);
  const acknowledgementSeen = useRef(false);
  const preservingConflict = useRef(false);
  const restoredOwner = useRef(Boolean(session?.draft.threadId));
  const acknowledged = useStore((state) =>
    Boolean(
      session?.draft.text &&
      session.draft.threadId === input.threadId &&
      state.messageByThreadId?.[input.threadId]?.[MessageId.makeUnsafe(session.draft.id)],
    ),
  );

  useLayoutEffect(() => {
    if (
      !session?.previewActive ||
      session.navigationTarget ||
      session.surface !== input.surface ||
      !input.active
    )
      return;
    if (
      (session.draft.threadId ?? session.draft.id) !== input.threadId ||
      !session.bindThread(input.threadId)
    )
      return;
    let cancelled = false;
    let frame = 0;
    const transfer = () => {
      if (cancelled || !session.previewActive || session.navigationTarget) return;
      const current = latest.current;
      if (!current.active || current.threadId !== session.draft.threadId) return;
      if (session.isComposing()) {
        frame = requestAnimationFrame(transfer);
        return;
      }
      const draft = session.draft;
      const store = useComposerDraftStore.getState();
      const preserveCurrent =
        acknowledgementSeen.current ||
        (restoredOwner.current &&
          !session.editedDuringPreview &&
          current.prompt.length > 0 &&
          current.prompt !== draft.text);
      if (preserveCurrent) {
        const editor = current.editor.current;
        if (!editor || editor.readSnapshot().value !== current.prompt) {
          frame = requestAnimationFrame(transfer);
          return;
        }
        transferred.current = true;
        preservingConflict.current = !acknowledgementSeen.current;
        const focused = session.isFocused();
        session.cancelSend();
        session.finishPreview();
        if (focused) editor.focusAtEnd();
        if (!acknowledgementSeen.current && !notifiedRecovery.current) {
          notifiedRecovery.current = true;
          const copy = getStartupCopy(current.locale);
          toastManager.add({
            type: "warning",
            title: copy.draftConflict,
            timeout: 0,
            actionProps: {
              children: copy.copyDraft,
              onClick: () => {
                void copyTextToClipboard(draft.text).catch(() => undefined);
              },
            },
          });
        }
        return;
      }
      if (current.prompt !== draft.text) {
        store.setPrompt(current.threadId, draft.text);
        frame = requestAnimationFrame(transfer);
        return;
      }
      const editor = current.editor.current;
      if (!editor || editor.readSnapshot().value !== draft.text) {
        frame = requestAnimationFrame(transfer);
        return;
      }
      const selection = session.selection();
      const focused = session.isFocused();
      try {
        flushComposerDraftPersistence();
      } catch {
        session.setStatus("storage-error");
      }
      transferred.current = true;
      session.finishPreview();
      performance.mark("djl.startup.full-composer-ready");
      if (focused) {
        if (editor.focusRange) editor.focusRange(selection.start, selection.end);
        else editor.focusAt(selection.start);
      }
      if (draft.sendState === "uncertain" && !notifiedRecovery.current) {
        notifiedRecovery.current = true;
        toastManager.add({ type: "warning", title: getStartupCopy(current.locale).recovered });
      }
    };
    frame = requestAnimationFrame(transfer);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [session, input.threadId, input.active, input.surface]);

  useEffect(() => {
    if (!session || !input.active) return;
    if (acknowledged && session.draft.threadId === input.threadId) {
      acknowledgementSeen.current = true;
      const previous = session.draft;
      session.sendFinished(previous.id, true);
      if (input.prompt === previous.text)
        useComposerDraftStore.getState().setPrompt(input.threadId, "");
      return;
    }
    if (preservingConflict.current) return;
    if (
      !session.previewActive &&
      !dispatching.current &&
      (session.surface !== input.surface || session.draft.threadId !== input.threadId)
    ) {
      try {
        flushComposerDraftPersistence();
      } catch {
        session.setStatus("storage-error");
      }
      session.adoptThread(input.surface, input.threadId, input.prompt, input.model);
    }
    if (session.surface !== input.surface || session.draft.threadId !== input.threadId) return;
    const draft = session.draft;
    if (
      session.previewActive &&
      draft.model &&
      (input.model.provider !== draft.model.provider || input.model.model !== draft.model.model)
    ) {
      // The full runtime validates this cached model before accepting any send.
      if (isProviderKind(draft.model.provider))
        useComposerDraftStore.getState().setModelSelection(input.threadId, {
          provider: draft.model.provider,
          model: draft.model.model,
        });
      else {
        session.cancelSend();
        session.setModel(null);
      }
      return;
    }
    if (
      !session.previewActive &&
      transferred.current &&
      draft.sendState === "pending" &&
      input.prompt !== draft.text
    )
      session.cancelSend();
    if (!session.previewActive && draft.sendState !== "claimed" && draft.sendState !== "uncertain")
      session.edit(input.prompt);
    if (session.draft.sendState === "editing") session.setModel(input.model);
  }, [
    session,
    input.active,
    input.threadId,
    input.surface,
    input.prompt,
    input.model,
    acknowledged,
    revision,
  ]);

  useEffect(() => {
    if (
      !session ||
      session.previewActive ||
      !input.active ||
      !input.canSend ||
      dispatching.current ||
      session.draft.threadId !== input.threadId ||
      session.draft.text !== input.prompt ||
      session.draft.model?.provider !== input.model.provider ||
      session.draft.model?.model !== input.model.model
    )
      return;
    const identity = session.claimSend(input.threadId);
    if (!identity) {
      if (session.status === "storage-error" && !notifiedStorageFailure.current) {
        notifiedStorageFailure.current = true;
        toastManager.add({ type: "warning", title: getStartupCopy(input.locale).storageError });
      }
      return;
    }
    dispatching.current = true;
    void input.send
      .current()
      .then(
        (sent) => {
          session.sendFinished(identity.messageId, sent);
        },
        () => {
          session.sendFinished(identity.messageId, false);
        },
      )
      .finally(() => {
        dispatching.current = false;
      });
  }, [
    session,
    revision,
    input.active,
    input.canSend,
    input.threadId,
    input.prompt,
    input.model.provider,
    input.model.model,
    input.send,
    input.locale,
  ]);
}
