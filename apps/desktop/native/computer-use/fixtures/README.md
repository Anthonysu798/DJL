# Controlled background-input feasibility experiment

This is original, test-only AppKit/Swift code. It is not the DJL production helper or
its wire protocol. The fixture bundle identity is
`com.djl.computer-use.background-fixture`; its only content is synthetic text, a
counter button, a scroll view, and an instrumented drag area.

Build and check permissions without prompting or launching a window:

```sh
bash apps/desktop/native/computer-use/fixtures/build-and-probe.sh --status
```

The script uses the installed `xcrun swiftc`, sets its module cache explicitly, and
places the bundle, probe, state, and logs only in
`/private/tmp/djl-cua-background-probe/`. The directory is private to the user. No
TCC database, existing application, credentials, or OpenAI service is accessed.

Run the controlled experiment only when the independent probe already has
Accessibility permission:

```sh
bash apps/desktop/native/computer-use/fixtures/build-and-probe.sh --run
```

`--run` checks permissions first and exits 3 before launching anything when AX is
unavailable. It never requests permission. When permitted, it launches its own
fixture executable, records foreground PID/bundle and mouse coordinates before
and after launch, and terminates the fixture when the probe exits. The fixture
uses an accessory application and nonactivating panel, `orderFront(nil)`, and an
internal first responder. No activation or global focus action is performed.

The probe validates the fixture PID, exact executable path, bundle ID, state PID,
and window ID. Each trial logs the fixture state and human foreground/mouse before
and after, and succeeds only when both the expected target effect and exact human
state preservation are observed. A foreground or mouse change aborts subsequent
actions, including when it comes from concurrent human activity. Tests cover:

- `AXPress`: counter increases exactly once.
- `AXValue`: field contains `DJL 测试 café 🧪`.
- PID-scoped coordinate click: counter increases exactly once.
- PID-scoped Unicode keyboard event: text changes and contains `键盘✓`.
- PID-scoped scroll: scroll event count and actual scroll offset both change.
- PID-scoped drag: the fixture records a drag longer than 15 points.

CGEvent operations use only `postToPid` and explicit target PID/window fields.
There is no global event post, cursor warp, AppleScript/System Events, focus setter,
permission autoaccept, or private framework. Event dispatch alone is never counted
as success. An already-running fixture can also be tested using
`BackgroundProbe --run <fixture-pid>`; only the exact controlled bundle path is
accepted.

## Observed result on 2026-10-28

Both sources compiled successfully with the installed Xcode Swift compiler.
The initial independent probe reported:

```json
{
  "accessibilityTrusted": false,
  "phase": "permissions",
  "probePid": 1363,
  "prompted": false,
  "screenCaptureGranted": false
}
```

Running `BackgroundProbe --run 0` returned exit 3 and:

```json
{
  "phase": "blocked",
  "reason": "accessibility_not_granted",
  "unverified": [
    "AXPress",
    "AXUnicodeValue",
    "CGEventPostToPidClick",
    "CGEventPostToPidUnicode",
    "CGEventPostToPidScroll",
    "CGEventPostToPidDrag"
  ]
}
```

No fixture was launched and no input events were posted. This establishes only
successful compilation and permission gating. It does **not** establish working
background input, foreground/cursor isolation during input, screenshot capture,
minimized/occluded-window behavior, arbitrary app support, or desktop integration.
Screen capture is reported independently and is not exercised by these trials.
The concrete unresolved question is whether public PID/window-scoped events
produce the intended AppKit effects without activating the target. AX action/value
effects also remain unverified on this host. Permission changes require the user's
normal macOS settings flow; this experiment makes none.

Exact initial compiler commands (both exit 0):

```sh
xcrun swiftc -module-cache-path /private/tmp/djl-cua-background-probe/module-cache apps/desktop/native/computer-use/fixtures/BackgroundProbe.swift -o /private/tmp/djl-cua-background-probe/BackgroundProbe -framework AppKit -framework ApplicationServices -framework CoreGraphics
xcrun swiftc -module-cache-path /private/tmp/djl-cua-background-probe/module-cache apps/desktop/native/computer-use/fixtures/FixtureApp.swift -o /private/tmp/djl-cua-background-probe/DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture -framework AppKit -framework CoreGraphics
```

The reproducible script additionally installs the test-only `Info.plist`. Runtime
logs are `permissions.jsonl`, `runtime-preflight.jsonl`, and (when invoked via the
script) `runtime.jsonl` beneath the temporary directory. They contain synthetic
fixture state and foreground application identity/physical pointer position only.
