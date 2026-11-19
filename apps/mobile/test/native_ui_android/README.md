# Prepared Pixel native image pinch

This is a test tool for the existing `DJLFlutterPixel9Google35QA` emulator only.
The installed SDK's UiAutomator runner executes one fixed Java test from a
temporary JAR. It installs no helper app, asks for no new permissions, does not
launch DJL and never navigates, types, saves, shares or reads DJL private storage.

The existing ordinary v48 APK must match its accepted archive. Build and stage:

```sh
python3 apps/mobile/test/native_ui_android/build_native_pinch.py
```

The script uses the already installed SDK35, UiAutomator/JUnit stubs and D8. It
checks the dedicated AVD, actual SDK and1080×2424 geometry. The JAR, Java source
and ordinary-app hashes are recorded, and one uniquely named, read-only JAR is
staged under `/data/local/tmp`. Existing retained artifacts are not overwritten.

Restart only the local QA viewer after its action queue is terminal, retaining
its diagnostic history. In CUA, reload the existing `127.0.0.1:8856` tab and use
its explicit **Pinch public preview** button. The button accepts no geometry,
package, scale or duration parameters. Every invocation verifies source/local
JAR/remote JAR and installed app hashes. Only this SDK test gets a30-second
subprocess budget; ordinary input retains its10-second bound.

The native test refuses input unless the foreground package is `app.djl.mobile`
and exactly one visible `p.png` or `s.svg` image and its matching Close control
exist. Its gesture is the installed SDK's two-pointer `pinchOut(60,40)`. A
non-preview negative case must report rejection before any touch. Do not mistake
that deliberate rejection for a successful pinch or retry an unknown outcome.

Prepare only hash-owned public fixture images for the existing saved links;
never send another message just to expose them. Inspect actual native images
before and after the gesture, close back to the original saved chat, and remove
only the unchanged manifest-owned fixture files. `invocations.jsonl` stores only
fixed status/public filenames and deliberately does not claim rendered zoom.

Finally, after verifying the runner is terminal:

```sh
python3 apps/mobile/test/native_ui_android/cleanup_native_pinch.py
```

This removes only the exact hash-verified staged JAR. Keep local build artifacts
and receipts as evidence; do not clear app data, caches, pairings or worktrees.
Recheck fixture counters, eight clean worktrees and the ordinary app binaries.

Host-only verification:

```sh
python3 apps/mobile/test/integration_support/android_native_pinch_test.py
python3 apps/mobile/test/integration_support/android_simulator_browser_test.py
```

The legacy SDK API is present in this installed SDK/device and is deprecated;
these prepared tests do not add it as an application dependency. Actual device
results are required. API background: [UiObject two-pointer pinch](https://developer.android.com/reference/androidx/test/uiautomator/UiObject#pinchOut(int,int)).
