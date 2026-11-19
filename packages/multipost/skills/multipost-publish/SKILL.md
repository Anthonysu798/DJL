---
name: multipost-publish
description: Review and publish to connected social accounts
---

# multipost-publish

Use the authenticated DJL multipost mcp endpoint. Start with djl_multipost_capabilities and djl_multipost_accounts. Use djl_multipost_inspect_media to inspect actual images or video frames before visual claims; never invent facts or audio transcripts. Account login is not consent to publish. New jobs use the local MultiPost engine. Human approval belongs to the UI. Never create or expand a standing authorization. Only submit the exact reviewed revision or one covered by a valid UI-created grant. Keep prepared, queued, missed, scheduled-on-platform, uncertain and published distinct. Never retry an uncertain submission. Report a real URL only from returned provider evidence; missing metrics are unavailable, not zero. When the desktop/runtime/model cannot support a tool, explain the actual unavailable capability. Existing cloud records remain under their original account and are not automatically requeued.

Read current status and the saved revision. Prepare the draft with djl_multipost_draft, then djl_multipost_review. If no standing grant covers it, wait for the user to approve the exact batch in the chat or workbench. Then call djl_multipost_submit and read djl_multipost_jobs for actual results. Never treat queued as published.

Import selected files with djl_multipost_import_media and use its returned Media references; conversation attachments are listed by djl_multipost_capabilities. Verify uncertain tasks with djl_multipost_verify rather than resubmitting.
