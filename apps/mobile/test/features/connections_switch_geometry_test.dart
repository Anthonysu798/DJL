import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'trusted_device_preferences_widget_test.dart' show fixture;
import 'pairing_presentation_test.dart' show more;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'Connections visibility switch uses the source visible width and accessible target',
    (tester) async {
      final f = await fixture();
      try {
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(
              Brightness.light,
            ).copyWith(platform: TargetPlatform.android),
            home: PairingPage(controller: f.desktop),
          ),
        );
        await more(tester, 'Connections');
        final control = find.byKey(const ValueKey('device_visibility_other'));
        expect(tester.getSize(control).width, 63);
        expect(tester.getSize(control).height, greaterThanOrEqualTo(48));
        final before = Map<String, String>.of(f.store.values);
        await tester.tap(control);
        await tester.pumpAndSettle();
        expect(
          f.desktop.devicePreferences(f.desktop.trusted.last)!.visibleInMenu,
          isFalse,
        );
        expect(f.store.values, isNot(before));
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        f.desktop.dispose();
        f.settings.dispose();
        await tester.pump();
      }
    },
  );
}
