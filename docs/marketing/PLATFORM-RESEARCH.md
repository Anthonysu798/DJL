# Platform integration evidence and gates

Research date: 2026-10-22. No direct publishing adapter is implemented or verified in this branch. Every destination currently uses assisted publishing. Public documentation does not establish that DJL has the necessary app approval, scopes, account eligibility, or commercial access.

| Platform | Official source inspected or identified | Current implementation |
|---|---|---|
| Instagram | https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/ — detailed verification still required | Assisted only |
| Facebook Pages | https://developers.facebook.com/docs/graph-api/reference/page/feed/ — detailed verification still required | Assisted only |
| TikTok | https://developers.tiktok.com/docs/en/content-posting-api-get-started and https://developers.tiktok.com/docs/en/content-sharing-guidelines — Direct Post requires configuration, consent, and audit to lift visibility restrictions | Assisted only |
| YouTube | https://developers.google.com/youtube/data/reference/rest/v3/videos/insert — upload endpoint exists; confirm current project restrictions directly before implementation | Assisted only |
| LinkedIn | https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-03 — Posts API; account roles and product access require verification | Assisted only |
| Pinterest | https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/ — access/refresh tokens and scopes; production access must be established | Assisted only |
| Threads | https://developers.facebook.com/docs/threads/ — detailed publishing/access verification still required | Assisted only |
| X | https://help.x.com/en/rules-and-policies/x-api and https://developer.x.com/ — posting available through API; verify current commercial access and costs | Assisted only |
| Douyin | https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/create/create-video — video.create requires application permission and user authorization | Assisted only |
| RED | https://miniapp.xiaohongshu.com/doc/DC137160 — miniapp publishing component routes users through the publisher; does not establish a general desktop direct-post API | Assisted only |
| Kuaishou | https://open.kuaishou.com/platform/openApi?group=GROUP_OPEN_PLATFORM&menu=20 — upload and publish are separate; successful upload does not establish successful publishing | Assisted only |
| Bilibili | https://openhome.bilibili.com/doc — public portal describes authorized publishing/deletion/query capabilities; detailed access verification remains | Assisted only |
| WeChat Channels | Official general-purpose desktop publishing access not verified | Assisted only |
| WhatsApp Business | https://developers.facebook.com/documentation/business-messaging/whatsapp/ — detailed current access/template/consent documentation must be verified | Assisted business messaging only; no Status publishing claim |

Before enabling any direct connector, implement and test the official OAuth flow, granted-scope/account checks, encrypted credentials, revocation, tenant isolation, immutable publication revisions, media constraints, idempotency and uncertain-outcome reconciliation. Never substitute cookie automation or private APIs.
