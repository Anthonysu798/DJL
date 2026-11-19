# Prepared native input checks

These checks activate the existing ordinary `app.djl.mobile` on the dedicated
`DJL Flutter Auth QA` simulator. They do not launch a seeded Flutter test app,
reset app data, submit a pairing code, send a message or touch the Swift app.
Use only the disposable saved fixture conversations described in the checkpoint
report. They are prepared cases, not an order-independent CI suite.

Generate the separate project with installed XcodeGen, outside the app project:

```sh
mkdir -p /private/tmp/djl-native-input-qa
DJL_NATIVE_QA_SOURCE="$PWD/apps/mobile/test/native_ui" \
  xcodegen generate --spec apps/mobile/test/native_ui/project.yml \
  --project /private/tmp/djl-native-input-qa
```

Build for testing with XcodeBuildMCP using that project, scheme
`NativeInputGestureQA`, Debug/arm64, dedicated simulator
`CD2EB9C1-619A-4C48-8EE8-F970FC4E9C9C`, and separate DerivedData. Before running
prepared products, require an exit-zero result from:

```sh
python3 apps/mobile/test/native_ui/verify_ui_runner.py <test-products-path>
```

Run one prepared case with `-only-testing` and parallel testing disabled. The
SDK runner has its own bundle ID, no shared keychain or app-group entitlements,
and must never replace the ordinary app's identity guard or build profile.
Restore the ordinary `flutter-mobile-qa` profile afterward.

- Composer: prepare the empty saved QA composer with the native keyboard open.
  The test taps Q then Delete, checks the actual typed value and layout, and
  attaches native screenshots. It never taps Return/Send.
- Code entry: start in that saved chat. The test uses Remote → Connections →
  Pair with Code, checks keyboard/Cancel geometry, and cancels without typing.
  It leaves the session paused; restore the original fixture with Reconnect.
- Raster: start at the saved root list, with the original fixture available
  and exactly two existing `p` links in the saved chat. Prepare only the public,
  hash-owned `q42/p.png` asset. No new message is needed.
- SVG: start in the saved chat with exactly two existing `s` links and the
  hash-owned `q42/s.svg` asset. The test accepts only a fresh positive native
  link frame inside the app viewport; it never reuses screenshot coordinates.
- Restoration: return to the empty original saved chat with the keyboard
  dismissed. The test reopens the same saved conversation and verifies that
  its software keyboard is hidden. Focusing an input normally shows it again;
  hidden visibility is not a hardware-keyboard preference.

For image acceptance, inspect both native attachments and compare only their
public image region. A successful gesture call alone does not prove zoom.
Remove only exact manifest-owned temporary assets, verify unchanged fixture
execution counts and all eight clean worktrees, and restore the original
keyboard/input view. Do not grant Photos, microphone, camera or other access
as part of these cases.
