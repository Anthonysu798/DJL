import 'dart:ui';

/// The languages DJL ships, matching the desktop app (`APP_LANGUAGE_OPTIONS`
/// in apps/web). [value] is the stored preference and the desktop's id.
enum AppLanguage {
  system('system', null, null),
  en('en', 'English', Locale('en')),
  zhHans(
    'zh-Hans',
    '简体中文',
    Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hans'),
  ),
  zhHant(
    'zh-Hant',
    '繁體中文',
    Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant'),
  ),
  ja('ja', '日本語', Locale('ja')),
  ko('ko', '한국어', Locale('ko')),
  es419('es-419', 'Español (Latinoamérica)', Locale('es', '419')),
  fr('fr', 'Français', Locale('fr'));

  const AppLanguage(this.value, this.nativeName, this.locale);
  final String value;

  /// The language's own name, shown untranslated in the picker.
  final String? nativeName;

  /// Null for [system], which follows the phone.
  final Locale? locale;

  /// Human-reviewed translations, as in the desktop's
  /// `localeReviewStatus.json`. Release builds only offer these in the
  /// picker; a phone set to another supported language still gets it.
  bool get reviewed =>
      this == system || this == en || this == zhHans || this == zhHant;

  static AppLanguage fromValue(Object? value) =>
      values.where((language) => language.value == value).firstOrNull ?? system;

  /// The preference picked in Settings. Set by the settings controller so
  /// code without a BuildContext follows it too.
  static AppLanguage preference = system;
}

const _traditionalChineseRegions = {'HK', 'MO', 'TW'};

/// The desktop's rules (`normalizeAppLocale` in packages/shared): Chinese
/// in Hong Kong, Macau and Taiwan reads Traditional; every Spanish reads
/// Latin American Spanish; anything unsupported is skipped.
AppLanguage? appLanguageFor(Locale locale) => switch (locale.languageCode) {
  'en' => AppLanguage.en,
  'zh' =>
    locale.scriptCode == 'Hant' ||
            _traditionalChineseRegions.contains(locale.countryCode)
        ? AppLanguage.zhHant
        : AppLanguage.zhHans,
  'ja' => AppLanguage.ja,
  'ko' => AppLanguage.ko,
  'es' => AppLanguage.es419,
  'fr' => AppLanguage.fr,
  _ => null,
};

/// The locale to show: the Settings choice, else the first of the phone's
/// languages DJL supports, else English.
Locale resolveAppLocale(Iterable<Locale> phoneLocales) {
  if (AppLanguage.preference.locale case final chosen?) return chosen;
  for (final locale in phoneLocales) {
    if (appLanguageFor(locale)?.locale case final supported?) return supported;
  }
  return AppLanguage.en.locale!;
}
