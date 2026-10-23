# Marketing Studio implementation status

Updated 2026-10-22. This branch is an **incomplete implementation** of the approved full production brief. Do not describe it as production-ready or all phases complete.

## Current entry point

The subsequent user correction replaces the primary studio navigation with chat-driven preparation and inline interactive review cards. See [CHAT-WORKFLOW.md](CHAT-WORKFLOW.md) for the current UX, provider support, and remaining limits. The older route is retained for saved data, not promoted as the main workflow.

## Implemented local workflows

- `/marketing` lives in the existing desktop/web shell; Work's `/studio` redirect is unchanged.
- Campaigns, revisions, brand profiles, asset records, image recipes/history, video timelines, and export jobs persist in the existing SQLite database through migration 61.
- Concurrent document writes use version checks. Image edits and saved timelines invalidate campaign approval transactionally.
- Local-only, authenticated HTTP endpoints enforce trusted browser origins; renderer-supplied paths are never accepted. Files are bounded, stored under generated IDs, and inspected using decoders/container signatures.
- Import JPEG/PNG/WebP/TIFF and supported HEIC/AVIF; MP4/MOV/WebM require FFprobe. Images have an 80-megapixel decoder limit. Imports are limited to 256 MB.
- Image editor: exposure, contrast, saturation, temperature, right-angle rotation, horizontal flip, bounded resize, original/edited preview, save, local undo with persisted save history, sRGB PNG export with alpha and metadata stripping. Original files are immutable.
- Video editor: trim, split at playhead, reorder/remove clips, speed 0.5–2×, source preview, saved timeline, portrait/landscape export. FFmpeg normalizes dimensions and audio and exports H.264/AAC. Missing audio gets silence. Content is fitted with padding rather than silently cropped.
- Video jobs execute outside the renderer, support cancellation, survive UI navigation, and persist terminal state. A process restart marks orphaned renders interrupted, requiring explicit retry.
- Brand information and campaign briefs persist. Generation uses the existing server-side DJL Cloud session and model gateway, explicit model selection, consent to sending data, optional image previews, bounded SSE parsing, structured destination copy, and manual acceptance. No live paid model call was made during verification.
- Composer supports all 14 destinations, separate captions, media selection, saved drafts, explicit revision approval, download/copy/open-platform actions, and distinct user-confirmed publication records. It never claims API publication.
- Virtualized media rows, responsive layouts, light/dark tokens, route/navigation dirty guards, and an activity drawer are implemented. Sidebar label is localized in all seven current catalogs; most new screen copy remains English.

## Not implemented (not credential blockers)

- Full professional image tools: curves, HSL/color wheels, crop/perspective UI, advanced grading, layers/text/logos/templates/LUTs, redo, batch/custom-format export, live high-performance adjustment preview.
- Full video suite: multitrack editing, audio/music/voiceover controls, transitions, keyframes, subtitles, grading/LUTs, proxies, scene/silence detection, reframing, highlight generation, thumbnails, codec settings, percentage progress, automatic interrupted-job resumption.
- AI restoration, image generation/editing UI, video understanding, transcription and campaign orchestration.
- Cloud Marketing Studio tables/migrations, roles, organization sharing, OAuth callbacks/token lifecycle, connected-account management, direct publishing adapters, scheduling/queue reconciliation, webhook handlers, platform analytics.
- Platform-specific media validation/adaptation; current assisted export must be checked against the destination's requirements by the user.
- Full localization, additional accessibility/performance audits, packaged FFmpeg/FFprobe binaries, cross-platform package verification.

The Connected Accounts screen accurately reports unconfigured direct connections. The Calendar screen reports that cloud scheduling is unavailable and does not schedule jobs. Analytics shows local manual confirmations and missing external metrics, without fabricated charts.

## Runtime configuration

Image processing uses the existing repository-compatible Sharp 0.34.5 dependency. Desktop packaging already unpacks Sharp and `@img` native dependencies; cross-platform verification remains necessary.

For development video processing, install FFmpeg and FFprobe or set `DJL_FFMPEG_PATH` and `DJL_FFPROBE_PATH` to their executable paths. No arbitrary shell command or renderer-supplied executable path is accepted. Packaged distribution still requires managed binary provisioning and license review.

AI copy generation reuses the DJL Cloud account configured in Settings → Accounts. The token stays in the existing server secrets store. Model catalog loading is read-only; Generate requires an explicit disclosure checkbox and may consume existing credits. No new API keys or paid services were activated.

## Verification evidence

- Contract tests: 208 passed before final UI review fixes.
- New local tests cover approval invalidation, stale writes, image output/alpha/original preservation, invalid image parameters, timeline boundaries, export restart recovery, structured generation failures, and stale editor baselines.
- Browser smoke: create campaign → select imported media → select Instagram → save copy → approve revision → reload; persisted campaign observed, zero page errors.
- Actual export: FFprobe verified H.264 video at 720×1280, AAC audio, duration 1.500000 seconds for a two-clip speed-adjusted timeline.
- API checks: untrusted Origin 403; disguised media 400; stale write 409.
- Full suite/build results are recorded in PROGRESS.md after final runs finish.

## Operating boundaries

No production deploy, external publication, paid model invocation, schema migration on a hosted database, or release tag was performed. Test data was confined to `/tmp/djl-marketing-qa`. Existing unrelated changes in the primary checkout were preserved.
