import 'dart:ui';

import 'package:flutter/widgets.dart';

import 'app_language.dart';
import 'app_localizations.dart';

export 'app_language.dart';
export 'app_localizations.dart';

extension L10nContext on BuildContext {
  /// The app's text in the reader's language. Widgets built outside the app
  /// (some tests) have no localizations and get the system language instead.
  AppLocalizations get l10n =>
      Localizations.of<AppLocalizations>(this, AppLocalizations) ?? appStrings;
}

/// Text for code that has no BuildContext (controllers, errors). Follows the
/// language chosen in Settings, else the phone's, falling back to English.
AppLocalizations get appStrings => lookupAppLocalizations(
  resolveAppLocale(PlatformDispatcher.instance.locales),
);
