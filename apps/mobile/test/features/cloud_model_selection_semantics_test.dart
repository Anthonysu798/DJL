import 'dart:ui' show CheckedState, Tristate;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'cloud_model_catalog_test.dart' show CatalogFixture;
import 'voice_controller_test.dart' show TestVoice;

void main() {
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    testWidgets(
      'source model menu exposes selectable buttons and provider headings on $platform',
      (tester) async {
        debugDefaultTargetPlatformOverride = platform;
        final semantics = tester.ensureSemantics();
        try {
          final fixture = CatalogFixture();
          await tester.pumpWidget(
            MaterialApp(
              home: ChatPage(
                controller: fixture.chat,
                voiceDriver: TestVoice(),
              ),
            ),
          );
          addTearDown(() async {
            await tester.pumpWidget(const SizedBox.shrink());
            fixture.client.close();
          });
          await tester.pumpAndSettle();
          final model = find.byKey(const Key('cloud.model-picker'));
          var node = tester.getSemantics(model);
          expect(node.flagsCollection.isButton, true);
          expect(node.flagsCollection.isHeader, false);
          expect(node.label, 'Model');
          expect(node.value, 'Preview chat');
          expect(tester.getRect(model).height, greaterThanOrEqualTo(44));
          await tester.tap(find.byTooltip('Model'));
          await tester.pumpAndSettle();
          node = tester.getSemantics(
            find.byKey(const Key('cloud.model-provider.anthropic')),
          );
          expect(node.flagsCollection.isHeader, true);
          expect(node.flagsCollection.isButton, false);
          node = tester.getSemantics(
            find.byKey(const Key('cloud.model-item.preview')),
          );
          expect(node.flagsCollection.isButton, true);
          expect(node.flagsCollection.isSelected, Tristate.isTrue);
          expect(node.flagsCollection.isChecked, CheckedState.none);
          expect(node.flagsCollection.isToggled, Tristate.none);
          await tester.tap(find.byKey(const Key('cloud.model-item.text')));
          await tester.pumpAndSettle();
          expect(fixture.chat.model, 'text');
          expect(tester.getSemantics(model).value, 'Text chat');
          expect(fixture.mutations, 0);
          expect(tester.takeException(), isNull);
        } finally {
          semantics.dispose();
          debugDefaultTargetPlatformOverride = null;
        }
      },
    );
  }
}
