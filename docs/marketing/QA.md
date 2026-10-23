# Marketing Studio QA procedure

Use an isolated development home, never production/customer state:

```sh
bun install --frozen-lockfile
bun run build:desktop
cd apps/server
bun run src/index.ts --port 4399 --home-dir /tmp/djl-marketing-qa --no-browser
```

Open http://localhost:4399/marketing. Initial onboarding and provider-update notices belong to the existing app; dismiss them for screen inspection.

1. Create a campaign; reload and confirm persistence.
2. Import a synthetic image and video. Select the image in Media library for the campaign.
3. Choose Instagram in Content composer, save a caption, approve the revision. Confirm approval does not happen automatically.
4. Adjust and save the image. Return to the composer and verify the campaign is Draft again. Export PNG and inspect dimensions, alpha, and original-file preservation.
5. Edit a caption without saving. Attempt sidebar navigation, campaign switching, and section switching; confirm discard prompts. Dismiss the prompt and confirm the draft remains.
6. In two windows, edit the same brand/image/timeline. Save one window; attempt to save the other's older draft after refetch. Expect a conflict rather than silently overwriting.
7. Add a video to a campaign timeline, split, reorder, change speed, save, reload, and export. Observe background status and download the completed file. Verify it with FFprobe.
8. Start an export, cancel it, and verify no completed result is offered. Stop the test server during an export; restart and verify Interrupted rather than Complete.
9. Generation: use the existing DJL Cloud sign-in and load models. Do not invoke generation during routine smoke testing unless spending existing credits is explicitly intended. Confirm disclosure and consent are required and output must be accepted manually.
10. Check light/dark/compact layouts, keyboard focus, and image alt text. Calendar and Accounts must accurately report unimplemented hosted capabilities.

The currently automated tests do not establish the complete original production acceptance criteria. See IMPLEMENTATION.md for the missing work.
