import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'cloud_model_catalog_test.dart' show CatalogFixture;
import 'cloud_model_selection_store_test.dart'
    show ModelChoiceCredentials, modelChoiceKey;
import 'voice_controller_test.dart' show TestVoice;

void main() {
  test(
    'shared live choices and rapid pending writes finish at the latest user choice',
    () async {
      final vault = ModelChoiceCredentials();
      final fixture = CatalogFixture(credentials: vault);
      addTearDown(fixture.close);
      await fixture.chat.initialize();
      final other = ChatController(
        fixture.chat.repository,
        accountScope: 'u:o',
      );
      addTearDown(other.dispose);
      await other.initialize();
      final gate = Completer<void>();
      vault.nextWrite = gate;
      fixture.chat.setModel('text');
      await Future<void>.delayed(Duration.zero);
      other.setModel('degraded');
      expect(other.model, 'degraded');
      gate.complete();
      await fixture.chat.repository.modelSelection.read();
      await Future<void>.delayed(Duration.zero);
      expect(fixture.chat.model, 'degraded');
      expect(other.model, 'degraded');
      expect(vault.values[modelChoiceKey], 'degraded');
      expect(fixture.mutations, 0);
    },
  );
  test(
    'a model write survives ordinary page disposal without reviving an old account',
    () async {
      final vault = ModelChoiceCredentials();
      final fixture = CatalogFixture(credentials: vault);
      addTearDown(fixture.close);
      final page = ChatController(fixture.chat.repository, accountScope: 'u:o');
      await page.initialize();
      final gate = Completer<void>();
      vault.nextWrite = gate;
      page.setModel('text');
      await Future<void>.delayed(Duration.zero);
      page.dispose();
      gate.complete();
      await fixture.chat.repository.modelSelection.read();
      final restored = ChatController(
        CloudRepository(fixture.client),
        accountScope: 'u:o',
      );
      addTearDown(restored.dispose);
      await restored.initialize();
      expect(restored.model, 'text');
      expect(fixture.mutations, 0);
    },
  );
  for (final readFailure in [true, false]) {
    testWidgets(
      'actual model-choice ${readFailure ? 'read' : 'write'} recovery keeps the review draft and never sends',
      (tester) async {
        final vault = ModelChoiceCredentials()..values[modelChoiceKey] = 'text';
        vault.failRead = readFailure;
        final fixture = CatalogFixture(credentials: vault);
        await tester.pumpWidget(
          MaterialApp(
            home: ChatPage(controller: fixture.chat, voiceDriver: TestVoice()),
          ),
        );
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox.shrink());
          fixture.client.close();
        });
        await tester.pumpAndSettle();
        if (readFailure) {
          expect(fixture.chat.model, 'preview');
          expect(vault.values[modelChoiceKey], 'text');
          expect(vault.modelWrites, 0);
        } else {
          vault.failWrite = true;
          await tester.tap(find.byTooltip('Model'));
          await tester.pumpAndSettle();
          await tester.tap(find.byKey(const Key('cloud.model-item.preview')));
          await tester.pumpAndSettle();
          expect(fixture.chat.model, 'preview');
          expect(vault.values[modelChoiceKey], 'text');
        }
        await tester.enterText(
          find.byKey(const Key('composer')),
          'Keep my model review draft',
        );
        await tester.pumpAndSettle();
        expect(find.text('Retry model choice'), findsOneWidget);
        expect(find.textContaining('private storage detail'), findsNothing);
        vault.failRead = false;
        vault.failWrite = false;
        await tester.tap(find.text('Retry model choice'));
        await tester.pumpAndSettle();
        expect(fixture.chat.model, readFailure ? 'text' : 'preview');
        expect(vault.values[modelChoiceKey], readFailure ? 'text' : 'preview');
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('composer')))
              .controller!
              .text,
          'Keep my model review draft',
        );
        expect(find.text('Retry model choice'), findsNothing);
        expect(fixture.mutations, 0);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
