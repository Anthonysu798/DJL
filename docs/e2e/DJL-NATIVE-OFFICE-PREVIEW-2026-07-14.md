# DJL Native Office Preview E2E Report

Date: 2026-07-14  
Platform: macOS (Apple Silicon)  
App: isolated Electron development build (`DJL Native Preview E2E`)  
State: `.synara/djl-work-dev`  
Electron profile: `.synara/djl-native-preview-electron`  
Renderer: LibreOffice 26.2.4.2 through the development binary override  
OpenCode: bundled 1.17.18 runtime

## Result

The native preview pipeline passed the core Electron gate for DOCX, PPTX, and PDF. Office files render as real PDF.js pages/slides, not extracted paragraph cards. Cached previews survived application restarts and reopened without conversion.

The production signed-download flow is implemented and covered by automated tests, but a real signed DJL renderer manifest, release URL, public key, and platform artifacts are not present in this checkout. The install-button scenario therefore cannot be certified against a production release artifact yet.

## Computer-use scenarios

| Scenario                          | Result                   | Notes                                                                                                                                                                                                                |
| --------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOCX page rendering               | Pass                     | Two real pages; typography, page breaks, selectable text layer, search, zoom, readable fallback, details, fullscreen, and Word open action verified.                                                                 |
| PPTX slide rendering              | Pass                     | 11 slides; focused slide viewer, narrow-pane filmstrip collapse, arrow/Page Down navigation, fullscreen, and PowerPoint open action verified.                                                                        |
| Native PDF rendering              | Pass                     | Two pages rendered through the same shared PDF.js shell; navigation, zoom, search, fullscreen, and Acrobat open action verified.                                                                                     |
| Search                            | Pass                     | `Cybersecurity` returned six matches and next/previous navigation updated the active match.                                                                                                                          |
| Restart/cache recovery            | Pass                     | DOCX and PPTX cache modification times did not change after restart; previews reopened immediately.                                                                                                                  |
| Deliverables and transcript links | Pass                     | Both entry points opened the same right-side preview pane.                                                                                                                                                           |
| System Open actions               | Pass                     | DOCX opened in Microsoft Word, PPTX in Microsoft PowerPoint, and PDF in Adobe Acrobat.                                                                                                                               |
| Print bridge                      | Environment blocked      | The constrained Electron bridge accepted both rendered-preview and local-PDF endpoints. This Mac has no configured printer, so Electron returned `No printers available on the network`; no print job was submitted. |
| Signed viewer installation        | Release artifact blocked | Sidecar install/hash/repair/uninstall behavior passed automated tests. Production manifest and signed platform artifacts remain release-engineering inputs.                                                          |

## Evidence

- `evidence/native-docx-preview.jpg`
- `evidence/native-pptx-preview.jpg`
- `evidence/native-pdf-preview.jpg`

## Automated verification

- Contracts: 2 files, 24 tests passed.
- Server renderer/sidecar/routes: 3 files, 20 tests passed.
- Web unit: 2 files, 9 tests passed.
- Browser UI: 2 files, 5 tests passed.
- Desktop profile isolation: 1 file, 8 tests passed.
- Desktop build: passed.
- Server build: passed.
- Web production build: passed (8,582 modules).

Commands used `bun run test`; `bun test` was not used. Full workspace `fmt`, `lint`, and `typecheck` were not run because the repository instructions require an explicit request for those heavyweight checks.

## Remaining release inputs

1. Publish signed LibreOffice component manifests and binaries for macOS, Windows, and Linux.
2. Publish the licensed versioned fallback font pack and enable production font-substitution fixture certification.
3. Repeat the install/repair and print scenarios on release hardware with a configured printer.
4. Complete the planned LibreOffice redistribution and font-license legal review.
