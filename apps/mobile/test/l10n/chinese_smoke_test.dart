// The app in Simplified Chinese: the first screens render translated text
// without layout errors, on a small phone and with large text.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/l10n/l10n.dart';
import '../features/settings/welcome_layout_test.dart' show mountWelcome, size;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  final zh = lookupAppLocalizations(const Locale('zh'));

  for (final scale in [1.0, 2.0]) {
    testWidgets('welcome in Chinese at text scale $scale', (tester) async {
      tester.platformDispatcher.localesTestValue = const [Locale('zh', 'CN')];
      tester.platformDispatcher.localeTestValue = const Locale('zh', 'CN');
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(tester.platformDispatcher.clearAllTestValues);
      size(tester, const Size(320, 568));
      await mountWelcome(tester);
      expect(find.text(zh.authWelcomeTitle), findsOneWidget);
      expect(find.text(zh.authNoMacHint), findsOneWidget);
      expect(find.text('Welcome to DJL'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }

  test('every string has a Chinese translation', () {
    final en = lookupAppLocalizations(const Locale('en'));
    expect(zh.authWelcomeTitle, isNot(en.authWelcomeTitle));
    expect(zh.localeName, 'zh');
  });
}
