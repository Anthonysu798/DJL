---
name: multipost-workflow
description: Run a versioned workflow within explicit standing authorization
---

# multipost-workflow

Use the authenticated DJL multipost mcp endpoint. Start with djl_multipost_capabilities and djl_multipost_accounts. Use djl_multipost_inspect_media to inspect actual images or video frames before visual claims; never invent facts or audio transcripts. Account login is not consent to publish. New jobs use the local MultiPost engine. Human approval belongs to the UI. Never create or expand a standing authorization. Only submit the exact reviewed revision or one covered by a valid UI-created grant. Keep prepared, queued, missed, scheduled-on-platform, uncertain and published distinct. Never retry an uncertain submission. Report a real URL only from returned provider evidence; missing metrics are unavailable, not zero. When the desktop/runtime/model cannot support a tool, explain the actual unavailable capability. Existing cloud records remain under their original account and are not automatically requeued.

Read saved workflows and grants using djl_multipost_workflow and djl_multipost_authorization. Create/update workflow definitions with named account IDs and content kinds. Request the human authorization UI when missing; never authorize yourself. When running, prepare content through the existing verified source/media tools, bind each draft to workflowId/workflowRevision, and pass only the existing matching grantId to djl_multipost_submit. Stop on changed workflow, identity, revoked/expired grant or exhausted quota.

Import selected files with djl_multipost_import_media and use its returned Media references; conversation attachments are listed by djl_multipost_capabilities. Verify uncertain tasks with djl_multipost_verify rather than resubmitting.

When authorization is missing, present the returned uiPath as a link to the exact workflow review screen. Only the user can authorize it there.
