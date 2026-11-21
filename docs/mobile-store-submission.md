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
| iOS push | `RemotePush.entitlements` is attached to Runner; Debug uses the `development` APNs environment, Profile and Release use `production` |
| Widgets signing | `DJLWidgets` is signed by the same team as Runner |
| Version | `1.0.0+1` |
| Reporting AI answers | "Report this answer" (flag button) under every AI answer in DJL Cloud chats, paired-Mac chats and group chats. Reports go to DJL Cloud (`POST /v1/reports`) and are reviewed in the admin console under Reports. Paired-Mac reports work without a DJL Cloud account. The DJL Cloud change ships with the next `cloud-v*` deploy; until then the phone shows "Couldn't send the report" |
| Languages | English and Simplified Chinese, following the phone's language (Flutter gen-l10n, `apps/mobile/lib/l10n`); iOS permission prompts in Chinese via `zh-Hans.lproj/InfoPlist.strings`. Add Chinese store listing text and screenshots if you list in Chinese-speaking regions |
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
2. **Push capability on the App ID.** Turn on Push Notifications for `app.djl.mobile` in the
   Apple Developer account so the provisioning profile carries `aps-environment`. Raise the build
   number in `pubspec.yaml` (`1.0.0+N`) for every upload.
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

- **Android push.** Firebase Messaging is a dependency but `google-services.json` is absent, so
  it is inactive. Add the file from the Firebase project to enable it.
- **Group chat needs the matching desktop.** Groups on the phone work with a DJL desktop that has
  the `djlGroups` bridge capability. Against an older desktop the Groups tab asks the person to
  update DJL on the Mac. Ship the desktop update before, or together with, the phone build.
