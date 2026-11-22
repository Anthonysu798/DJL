// Every language DJL ships: the phone's language picks the right one (with
// the desktop's rules), a Settings choice overrides it, and the first screen
// renders translated without layout errors on a small phone with large text.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/l10n/l10n.dart';
import '../features/settings/welcome_layout_test.dart' show mountWelcome, size;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  tearDown(() => AppLanguage.preference = AppLanguage.system);

  group('the phone language picks', () {
    final cases = <Locale, AppLanguage>{
      const Locale('en', 'GB'): AppLanguage.en,
      const Locale('zh', 'CN'): AppLanguage.zhHans,
      const Locale('zh', 'SG'): AppLanguage.zhHans,
      const Locale('zh', 'TW'): AppLanguage.zhHant,
      const Locale('zh', 'HK'): AppLanguage.zhHant,
      const Locale('zh', 'MO'): AppLanguage.zhHant,
      const Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant'):
          AppLanguage.zhHant,
      const Locale('ja', 'JP'): AppLanguage.ja,
      const Locale('ko', 'KR'): AppLanguage.ko,
      const Locale('es', 'MX'): AppLanguage.es419,
      const Locale('es', 'ES'): AppLanguage.es419,
      const Locale('fr', 'CA'): AppLanguage.fr,
    };
    for (final MapEntry(key: phone, value: language) in cases.entries) {
      test('$phone → ${language.value}', () {
        expect(resolveAppLocale([phone]), language.locale);
      });
    }
    test('the first supported language in the list, else English', () {
      expect(
        resolveAppLocale(const [Locale('de'), Locale('ko')]),
        AppLanguage.ko.locale,
      );
      expect(resolveAppLocale(const [Locale('de')]), AppLanguage.en.locale);
      expect(resolveAppLocale(const []), AppLanguage.en.locale);
    });
    test('a Settings choice wins over the phone', () {
      AppLanguage.preference = AppLanguage.fr;
      expect(resolveAppLocale(const [Locale('ja')]), AppLanguage.fr.locale);
      expect(AppLanguage.fromValue('es-419'), AppLanguage.es419);
      expect(AppLanguage.fromValue('klingon'), AppLanguage.system);
    });
  });

  final english = lookupAppLocalizations(const Locale('en'));
  for (final language in AppLanguage.values.where((l) => l.locale != null)) {
    final strings = lookupAppLocalizations(language.locale!);
    test('${language.value} has its own text', () {
      if (language != AppLanguage.en) {
        expect(strings.authWelcomeTitle, isNot(english.authWelcomeTitle));
        expect(strings.settingsLanguage, isNot(english.settingsLanguage));
      }
      if (language == AppLanguage.zhHant) {
        expect(
          strings.authWelcomeTitle,
          isNot(lookupAppLocalizations(const Locale('zh')).authWelcomeTitle),
        );
      }
    });
    for (final scale in [1.0, 2.0]) {
      testWidgets('welcome in ${language.value} at text scale $scale', (
        tester,
      ) async {
        tester.platformDispatcher.localesTestValue = [language.locale!];
        tester.platformDispatcher.localeTestValue = language.locale!;
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearAllTestValues);
        size(tester, const Size(320, 568));
        await mountWelcome(tester);
        expect(find.text(strings.authWelcomeTitle), findsOneWidget);
        expect(find.text(strings.authNoMacHint), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }
  }
}
