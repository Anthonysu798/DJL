# MultiPost integration boundary

The feature-only patch is based on the preserved initial working source, not a pristine HEAD checkout. Existing work has not been reset, stashed or committed.

These inherited, previously unpublished Social modules were already present before MultiPost and are modified by its integration:

- `apps/server/src/marketing/publishingBridge.integration.test.ts`
- `apps/server/src/marketing/publishingBridge.ts`
- `apps/server/src/marketing/socialTools.ts`
- `apps/web/src/components/marketing/SocialToolsPage.tsx`
- `apps/web/src/routes/_chat.social.$socialThreadId.tsx`
- `packages/contracts/src/builtInPlugins.ts`

Additional unchanged helpers are part of the inherited Social implementation. A standalone commit on HEAD must first establish that prerequisite baseline, or port the integration onto an agreed clean base and reverify it. Adding every modified file would also include unrelated Computer Use/mobile/Cloud work; that has not been done.

The approved plan explicitly says not to carry existing work into commits. Delivery therefore remains a separately reviewable feature delta plus the November 7 CI/native acceptance fixes. No merge, push or production release is performed.
