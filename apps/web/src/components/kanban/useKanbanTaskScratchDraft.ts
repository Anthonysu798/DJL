// FILE: useKanbanTaskScratchDraft.ts
// Purpose: Owns the throwaway composer-draft thread used by the kanban new-task dialog.
// Layer: Kanban UI hook
// Exports: useKanbanTaskScratchDraft

import type { ModelSlug, ProviderKind } from "@synara/contracts";
import { getDefaultModel } from "@synara/shared/model";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  filterPromptProviderMentionReferences,
  filterPromptSkillReferences,
  providerMentionReferencesEqual,
  providerSkillReferencesEqual,
} from "~/lib/composerMentions";
import { buildComposerImageAttachmentsFromFiles } from "~/lib/composerSend";
import { newThreadId } from "~/lib/utils";
import { useComposerDraftStore, useComposerThreadDraft } from "../../composerDraftStore";
import { toastManager } from "../ui/toast";

export function useKanbanTaskScratchDraft(input: {
  readonly defaultProvider: ProviderKind;
  /**
   * The configured provider default, supplied by the app settings. Kanban does
   * not own a model picker, so this deliberately never reads chat's sticky
   * selection or a scratch-composer selection.
   */
  readonly defaultModel?: ModelSlug | null;
}) {
  // Kanban task creation deliberately uses the configured app default rather
  // than the chat composer's remembered provider/model. The throwaway draft is
  // only for transferable prompt content and is never allowed to alter that
  // fixed dispatch selection.
  const [scratchThreadId] = useState(() => newThreadId());
  useEffect(() => {
    return () => {
      useComposerDraftStore.getState().clearDraftThread(scratchThreadId);
    };
  }, [scratchThreadId]);

  const scratchDraft = useComposerThreadDraft(scratchThreadId);
  const prompt = scratchDraft.prompt;
  const composerImages = scratchDraft.images;
  const composerAssistantSelections = scratchDraft.assistantSelections;
  const composerFileComments = scratchDraft.fileComments;
  const composerTerminalContexts = scratchDraft.terminalContexts;
  const composerSkills = scratchDraft.skills;
  const composerMentions = scratchDraft.mentions;
  const nonPersistedComposerImageIdSet = useMemo(
    () => new Set(scratchDraft.nonPersistedImageIds),
    [scratchDraft.nonPersistedImageIds],
  );

  const setPrompt = useCallback(
    (nextPrompt: string) => {
      useComposerDraftStore.getState().setPrompt(scratchThreadId, nextPrompt);
    },
    [scratchThreadId],
  );

  const selectedProvider = input.defaultProvider;
  const selectedModel: ModelSlug | null = input.defaultModel ?? getDefaultModel(selectedProvider);

  useEffect(() => {
    const nextSkills = filterPromptSkillReferences(prompt, composerSkills, selectedProvider);
    if (!providerSkillReferencesEqual(composerSkills, nextSkills)) {
      useComposerDraftStore.getState().setSkills(scratchThreadId, nextSkills);
    }
  }, [composerSkills, prompt, scratchThreadId, selectedProvider]);

  useEffect(() => {
    const nextMentions = filterPromptProviderMentionReferences(prompt, composerMentions);
    if (!providerMentionReferencesEqual(composerMentions, nextMentions)) {
      useComposerDraftStore.getState().setMentions(scratchThreadId, nextMentions);
    }
  }, [composerMentions, prompt, scratchThreadId]);

  const addComposerImages = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      const { images, error } = buildComposerImageAttachmentsFromFiles({
        files,
        existingAttachmentCount: composerImages.length + composerAssistantSelections.length,
      });
      if (images.length > 0) {
        useComposerDraftStore.getState().addImages(scratchThreadId, images);
      }
      if (error) {
        toastManager.add({ type: "warning", title: error });
      }
    },
    [composerAssistantSelections.length, composerImages.length, scratchThreadId],
  );

  const removeComposerImage = useCallback(
    (imageId: string) => {
      useComposerDraftStore.getState().removeImage(scratchThreadId, imageId);
    },
    [scratchThreadId],
  );

  const clearComposerAssistantSelections = useCallback(() => {
    useComposerDraftStore.getState().clearAssistantSelections(scratchThreadId);
  }, [scratchThreadId]);

  const clearComposerFileComments = useCallback(() => {
    useComposerDraftStore.getState().clearFileComments(scratchThreadId);
  }, [scratchThreadId]);

  const removeComposerTerminalContext = useCallback(
    (contextId: string) => {
      useComposerDraftStore.getState().removeTerminalContext(scratchThreadId, contextId);
    },
    [scratchThreadId],
  );

  return {
    scratchThreadId,
    scratchDraft,
    prompt,
    composerImages,
    composerAssistantSelections,
    composerFileComments,
    composerTerminalContexts,
    composerSkills,
    composerMentions,
    nonPersistedComposerImageIdSet,
    selectedProvider,
    selectedModel,
    setPrompt,
    addComposerImages,
    removeComposerImage,
    clearComposerAssistantSelections,
    clearComposerFileComments,
    removeComposerTerminalContext,
  };
}
