# Social draft reviews

Owner actions live in the saved draft's Agent Chat card. Creating a link requires an explicit
"Anyone with this link" disclosure and a saved draft revision. Links expire after 1, 3, or 7 days
and can be revoked in the same chat. Only the creator's authenticated user and organization
can create, list, or revoke its links.

A link freezes the caption, platform captions, media order, publication intent, schedule and
timezone for that revision. Editing the draft marks earlier links and their approvals stale;
new feedback on those links is refused. Reviewer names are self-reported and always labelled
unverified. Reviewer approval only records feedback. It never confirms, queues, or publishes a
post; the owner must still confirm publication in Agent Chat.

## API

- `POST /v1/social/drafts/:id/review-links`: authenticated owner, body
  `{ revision, expiresInHours: 24 | 72 | 168, disclosureAccepted: true }`. Returns
  `{ link, token, reviewPath }`. The token is returned once. The local owner bridge resolves
  `reviewPath` against the configured cloud web origin for the copyable URL.
- `GET /v1/social/drafts/:id/review-links`: authenticated owner, returns link metadata and
  feedback, including whether each link matches the current draft revision. Never returns tokens.
- `DELETE /v1/social/review-links/:id`: authenticated owner, revokes further preview/media/feedback access.
- `GET /v1/social/review`: anonymous immutable preview, with the bearer token in `x-review-token`.
- `GET /v1/social/review/media/:index`: anonymous byte proxy, with the same header.
- `POST /v1/social/review/feedback`: same header, body `{ reviewerName, comment, decision }`, where
  decision is `comment`, `changes_requested`, or `approved`.

The web page is `/social/review#token=…`; the fragment does not reach the web server. API paths
never carry the token. Public requests omit account cookies. Storage keys, file/account/user/org
identifiers, provider credentials and sign-in tokens are excluded from public responses.
Only the token's SHA-256 hash is persisted. Public API responses and the page disable caching
and indexing. Public endpoints have per-IP limits; each link accepts up to 100 feedback records.

Media references pin the upload SHA-256 and MIME type at creation. Creation verifies the stored
bytes. Every media request rechecks link expiry/revocation, file ownership and availability,
and the pinned digest; expiry/revocation are checked again after storage IO. The API returns
bytes rather than a storage URL. Changed or deleted media becomes unavailable instead of silently
changing the reviewed snapshot. Previously downloaded bytes cannot be recalled from a reviewer.

Schema migration: `0011_social_review_links.sql`. Tests use only synthetic fixtures in an isolated
disposable database. No production account, draft, or publication is needed for verification.
