# Chat-first marketing

The user corrected the UX direction: people should describe the outcome in the existing DJL chat and interact with preview cards, not learn a separate production studio.

## Implemented

- Marketing Studio removed from both primary sidebar layouts. Its old route remains available for existing saved data; no saved projects were deleted.
- Marketing requests route to built-in conversation-scoped tools. Follow-up turns in a marketing conversation retain that context without taking priority over explicit coding/research requests.
- `djl_marketing_status` reads only the current conversation's campaigns, authorized attachments, and saved brand facts.
- `djl_prepare_marketing` accepts model-authored platform copy, imports authorized media, optionally applies supported basic image corrections, and saves a conversation-owned draft. It cannot approve or publish.
- OpenCode uses the existing scoped MCP transport. Native Codex and Claude receive an ephemeral MCP registration; Codex's bearer token is passed through its child environment rather than written to a config file. DJL Cloud uses a bounded function-call loop against the same scoped endpoint.
- Inline transcript cards show media, destination-specific copy, direct copy editing, shorter/premium rewrite requests, and review/export controls. Rewrite links identify the specific campaign, including when several cards exist in one conversation.
- Existing chat model/context is reused. No second content-generation model chooser is required. DJL Cloud's marketing execution includes previous conversation facts and releases the marketing-only tool set when the route changes.
- Approval is a user action. The ZIP export snapshots the approved campaign and image recipes transactionally, then packages rendered images, original videos, per-platform captions, and instructions. Revision conflicts fail closed.
- Cards are localized across all seven existing app languages.

## Important limits

Actual social OAuth/direct posting, cloud scheduling, and advanced media tools remain unimplemented from the original brief. The primary review action explains assisted publishing; it never reports that a downloadable package was posted. Current supported automatic image operations remain basic exposure/color changes, not generative restoration or full video production.

Live model/provider sessions were not invoked during verification. MCP transport, tool dispatch, native configuration, and the cloud tool loop were tested locally with protocol fixtures. Cursor/Grok/Kimi and other native drivers have not been connected to these local marketing tools. Do not claim universal provider support.

## Verification

- Real bearer-scoped MCP → file import → campaign creation → approval → ZIP contents test passed, including conversation isolation and rejection of unregistered publishing tools.
- Browser tests passed platform switching, inline editing, and clicked-campaign-specific rewrite requests.
- Native tests verify Codex per-session MCP configuration preserves the permission policy; cloud tests verify prior facts survive marketing transitions and explicit non-marketing routing is respected.
- Code review identified three P2 issues (lost prior context, sticky marketing mode, ambiguous card target); all were addressed with regression coverage.
- Full suite/build results are recorded in PROGRESS.md.

Codex MCP configuration fields were checked against the official configuration reference: https://developers.openai.com/codex/config-reference/ .
