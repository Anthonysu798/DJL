# Submitting the DJL phone app

The Flutter app in `apps/mobile` ships to the App Store and Google Play as `app.djl.mobile`. This
page lists what the build already does for review, what only the account owner can supply, and
what is still open. It is a checklist, not a guarantee of approval.

## What the build already does

| Area | State |
| --- | --- |
| iOS privacy manifest | `ios/Runner/PrivacyInfo.xcprivacy`: no tracking; email, user ID, messages and attached photos linked to the account for app functionality; device ID not linked; UserDefaults reason `CA92.1` |
| iOS export compliance | `ITSAppUsesNonExemptEncryption` is `false` in `ios/Runner/Info.plist`, the same declaration the native app makes in `apps/ios/BuildSupport/DJL-Info.plist` |
| iOS permission strings | Camera, Face ID, local network, microphone, photo library (read and add), speech recognition are all explained in `Info.plist` |
| iOS launch screen | DJL mark on the page colour, light and dark (`LaunchImage`, `LaunchBackground`) |
| iOS transport security | Only `NSAllowsLocalNetworking`; no arbitrary loads |
| Android signing | A release build requires `android/key.properties`; without it the build stops instead of signing with the debug key |
| Android icon | Adaptive icon with a monochrome layer for themed icons |
| Android splash | DJL mark on the page colour, light and dark, including the Android 12 splash |
| Android network | Cleartext is allowed only in the debug manifest |
| Account deletion | In the app: Account, Delete account (`DELETE v1/me`) |
| Policy links | Terms and Privacy on the welcome screen, in Cloud settings and in About |
| Pairing without configuration | With no compiled relay address the app uses DJL Cloud's relay, so nobody is asked for a relay URL |

## What only you can supply

1. **Android upload key.** Create `apps/mobile/android/key.properties` (it is git-ignored):

   ```properties
   storeFile=../upload-keystore.jks
   storePassword=...
   keyAlias=upload
   keyPassword=...
   ```

   `storeFile` is resolved from `apps/mobile/android`. Then `flutter build appbundle --release`.
2. **Version.** `pubspec.yaml` is still `0.1.0+1`. Set the first store version and build number.
3. **A demo account for review.** A reviewer cannot pair a Mac. Give App Review and Play review a
   DJL Cloud account that can chat, and say in the review notes that pairing with a desktop is
   optional. Attach a short screen recording of pairing and a group chat so the paired features can
   be judged without a Mac.
4. **Store listing.** Screenshots (6.9" and 6.5" iPhone; phone for Play), description, support URL
   and the privacy policy URL (`https://slcor.com/privacy`).
5. **Build settings for sign-in.** Apple and Google sign-in are switched on per build with
   `--dart-define`: `DJL_APPLE_SIGN_IN_ENABLED=true`, `DJL_GOOGLE_IOS_CLIENT_ID` and
   `DJL_GOOGLE_SERVER_CLIENT_ID`. An iOS build that offers Google sign-in must also enable Sign
   in with Apple (App Store guideline 4.8), and needs the Google reversed client ID URL scheme in
   `Info.plist`, which is not there yet.
6. **Privacy answers.** The App Store privacy labels and the Play Data safety form must match the
   manifest above: account email and user ID, messages and attached photos, all for app
   functionality, none used for tracking, none sold. Voice input uses the system speech service.
7. **The submission itself**, in App Store Connect and Play Console.

## Still open

- **Reporting AI-generated content (Play requirement).** Google Play requires an in-app way to
  report or flag offensive AI-generated content without leaving the app. The app has none, and
  DJL Cloud has no endpoint to receive such a report. This needs a small backend route in `cloud/`
  (its own change and deploy) and a "Report this answer" action in the message menu. Until it
  exists, expect a Play rejection for the DJL Cloud chat.
- **Push notifications on iOS.** `ios/Runner/RemotePush.entitlements` exists but is not attached
  to the target (`CODE_SIGN_ENTITLEMENTS` is unset) and `DJL_APNS_ENVIRONMENT` is undefined.
  Attaching it requires the push capability on the App ID and a matching provisioning profile.
  The app works without it; notifications from a paired Mac will not arrive in the background.
- **Android push.** Firebase Messaging is a dependency but `google-services.json` is absent, so
  it is inactive. Add the file from the Firebase project to enable it.
- **Widgets extension signing.** The `DJLWidgets` target has no `DEVELOPMENT_TEAM`; set it to the
  same team as Runner before archiving.
- **Languages.** The app is English only.
- **Group chat needs the matching desktop.** Groups on the phone work with a DJL desktop that has
  the `djlGroups` bridge capability. Against an older desktop the Groups tab asks the person to
  update DJL on the Mac. Ship the desktop update before, or together with, the phone build.
