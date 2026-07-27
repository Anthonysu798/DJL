# Sidebar Desktop Update Icon Design

## Goal

Surface newly published stable DJL desktop releases as a compact blue download icon in the Electron sidebar. DJL downloads the release in the background; once the download is ready, clicking the icon restarts DJL and installs the update.

## Release source

- Production desktop builds continue to use the public `Anthonysu798/DJL` repository as the canonical update source.
- Only a newer, fully published stable release is actionable.
- Drafts, prereleases, and versions that are not newer than the installed version remain excluded by the existing updater configuration and version checks.
- The browser build does not expose desktop update controls.

## Sidebar presentation

- Replace the existing blue text pill beside Settings with a compact circular blue icon button in the same footer position.
- Use the existing white download glyph from the shared icon library.
- Show the control only for actionable Electron update states, using the existing desktop update state subscription.
- While the update is available or downloading in the background:
  - Keep the button disabled so it cannot interrupt the automatic download.
  - Use subtle activity styling.
  - Include the version and available integer download percentage in the tooltip.
- When the update is downloaded:
  - Enable the button.
  - Explain in the tooltip that clicking restarts DJL and installs the named version.
  - Invoke the existing desktop install bridge action on click.

## State and interaction flow

1. The packaged Electron updater checks the canonical stable feed at startup, on foreground re-entry when eligible, and on its periodic schedule.
2. A newer release changes the renderer state to `available`, causing the blue sidebar icon to appear.
3. DJL automatically downloads the update and broadcasts `downloading` progress through the existing desktop bridge.
4. The `downloaded` state enables the icon.
5. Clicking the enabled icon persists app state, invokes `installUpdate`, and lets the existing Electron updater restart DJL and apply the release.

No new network request, update service, IPC method, or updater state is introduced.

## Failure handling

- Preserve the existing retry actions for download and install failures.
- Preserve the existing error notifications, install watchdog, and manual GitHub release fallback.
- Keep non-actionable update-check failures hidden from the sidebar.
- Continue to suppress the control when automatic desktop updates are unavailable or disabled.

## Testing and verification

Implementation follows test-driven development:

1. Add focused logic tests that fail against the current pill presentation and describe the compact icon states:
   - hidden when no actionable update exists;
   - visible and disabled while a newer release is being prepared;
   - progress exposed while downloading;
   - enabled with the install/restart action once downloaded;
   - retry behavior retained for actionable failures.
2. Make the smallest sidebar and presentation-logic changes required to pass those tests.
3. Run the focused updater/sidebar tests.
4. Run the web and desktop typechecks.
5. Run the production-relevant Electron/web build.
6. Launch Electron development mode and visually verify the footer placement and update-state styling using a controlled update-state fixture when available.

## Acceptance criteria

- A newer stable release published from `Anthonysu798/DJL` causes a blue circular download icon to appear beside Settings in packaged Electron builds.
- The icon communicates background download progress without accepting clicks during the download.
- Once ready, clicking the icon restarts DJL and installs the downloaded version.
- Existing update recovery behavior remains available.
- The feature has automated regression coverage and passes the relevant typechecks and build.
