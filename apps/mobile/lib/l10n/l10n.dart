import 'dart:ui';

import 'package:flutter/widgets.dart';

import 'app_localizations.dart';

export 'app_localizations.dart';

extension L10nContext on BuildContext {
  /// The app's text in the reader's language. Widgets built outside the app
  /// (some tests) have no localizations and get the system language instead.
  AppLocalizations get l10n =>
      Localizations.of<AppLocalizations>(this, AppLocalizations) ?? appStrings;
}

/// Text for code that has no BuildContext (controllers, errors). Follows the
/// phone's language, falling back to English.
AppLocalizations get appStrings {
  for (final locale in PlatformDispatcher.instance.locales) {
    if (AppLocalizations.supportedLocales.any(
      (supported) => supported.languageCode == locale.languageCode,
    )) {
      return lookupAppLocalizations(Locale(locale.languageCode));
    }
  }
  return lookupAppLocalizations(const Locale('en'));
}
