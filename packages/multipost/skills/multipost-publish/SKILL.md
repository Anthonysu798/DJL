---
name: multipost-publish
description: Review and publish to connected social accounts
---

# multipost-publish

Use the authenticated DJL multipost mcp endpoint. Start with djl_multipost_capabilities and djl_multipost_accounts. Use djl_multipost_inspect_media to inspect actual images or video frames before visual claims; never invent facts or audio transcripts. Account login is not consent to publish. New jobs use the local MultiPost engine. When the user asks to post, call djl_multipost_post once with the caption, any media paths and optional accountIds; DJL picks the right format for each platform. If you made an image or video for the post, save it inside the workspace folder first and pass that path. When the user has switched on Autopilot for those accounts the post is queued at once; otherwise it is saved and the user taps Post on the preview card in this chat. Only the user can switch Autopilot on, in MultiPost Accounts; never say you changed it and never create or expand a standing authorization. Use djl_multipost_draft only for articles, podcasts or per-platform overrides. Keep prepared, queued, missed, scheduled-on-platform, uncertain and published distinct. Never retry an uncertain submission. Report a real URL only from returned provider evidence; missing metrics are unavailable, not zero. When the desktop/runtime/model cannot support a tool, explain the actual unavailable capability. Existing cloud records remain under their original account and are not automatically requeued.

For a normal post call djl_multipost_post and relay its message in plain words. Then read djl_multipost_jobs and report the actual state; never treat queued as published. For a draft that is already saved, djl_multipost_submit queues it once the user approved it or Autopilot covers every target account.

Import selected files with djl_multipost_import_media and use its returned Media references; conversation attachments are listed by djl_multipost_capabilities. Verify uncertain tasks with djl_multipost_verify rather than resubmitting.
