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
| DJL Cloud sign-in | Off. The app is a remote for the DJL desktop: no sign-in, sign-up or Cloud chat is shown, and Cloud chat links are ignored. Pairing, the relay and paired-Mac notifications need no account. Build with `--dart-define=DJL_CLOUD_ACCOUNTS=true` to bring sign-in back |
| Languages | The desktop's 7 languages (English, Simplified and Traditional Chinese, Japanese, Korean, Latin American Spanish, French), following the phone or the Language setting (Flutter gen-l10n, `apps/mobile/lib/l10n`); iOS permission prompts and Android notifications are translated too. Release builds offer only English and Chinese in the Language picker, as the desktop does. Add store listing text and screenshots for each region you list in |
| Android signing | A release build requires `android/key.properties`; without it the build stops instead of signing with the debug key |
| Android icon | Adaptive icon with a monochrome layer for themed icons |
| Android splash | DJL mark on the page colour, light and dark, including the Android 12 splash |
| Android network | Cleartext is allowed only in the debug manifest |
| Account deletion | Not required while sign-in is off (nobody can create an account in the app). With sign-in on: Account, Delete account (`DELETE v1/me`) |
| Policy links | Terms and Privacy in Settings, About; also on the welcome screen and in Cloud settings when sign-in is on |
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
3. **A way for review to see the app work.** With sign-in off, the whole app needs a paired DJL
   desktop, and a reviewer cannot pair your Mac. In the review notes, say the app is a companion
   for the DJL desktop app (free from www.slcor.com) and how to pair, and attach a short screen
   recording of pairing, a chat and a group chat. Apple can still ask for a working demo
   (guideline 2.1); if it does, a reviewer-installable desktop build or turning sign-in back on
   with a demo account are the options.
4. **Store listing.** Screenshots (6.9" and 6.5" iPhone; phone for Play), description, support URL
   and the privacy policy URL (`https://slcor.com/privacy`).
5. **Build settings for sign-in (only when `DJL_CLOUD_ACCOUNTS=true`).** Apple and Google sign-in are switched on per build with
   `--dart-define`: `DJL_APPLE_SIGN_IN_ENABLED=true`, `DJL_GOOGLE_IOS_CLIENT_ID` and
   `DJL_GOOGLE_SERVER_CLIENT_ID`. An iOS build that offers Google sign-in must also enable Sign
   in with Apple (App Store guideline 4.8), and needs the Google reversed client ID URL scheme in
   `Info.plist`, which is not there yet.
6. **Privacy answers.** The App Store privacy labels and the Play Data safety form must match the
   manifest above: account email and user ID, messages and attached photos, all for app
   functionality, none used for tracking, none sold. Voice input uses the system speech service.
7. **The submission itself**, in App Store Connect and Play Console.

## Still open

- **Privacy declarations without sign-in.** `PrivacyInfo.xcprivacy` still declares the account
  email and user ID from DJL Cloud sign-in. With sign-in off the app does not collect them. Bring
  the manifest, the App Store privacy labels and the Play Data safety form in line with the build
  you submit.

- **Android push.** Firebase Messaging is a dependency but `google-services.json` is absent, so
  it is inactive. Add the file from the Firebase project to enable it.
- **Group chat needs the matching desktop.** Groups on the phone work with a DJL desktop that has
  the `djlGroups` bridge capability. Against an older desktop the Groups tab asks the person to
  update DJL on the Mac. Ship the desktop update before, or together with, the phone build.
