import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/conversations/presentation/cloud_chat_actions.dart';

void main() {
  for (final scale in [1.0, 3.0]) {
    testWidgets(
      'Anchored chat review fits a narrow keyboard viewport at $scale',
      (tester) async {
        tester.view.physicalSize = const Size(320, 640);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        bool? result;
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.dark),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(scale),
                viewInsets: const EdgeInsets.only(bottom: 280),
              ),
              child: child!,
            ),
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () async {
                    result = await showCloudChatDeleteConfirmation(
                      context,
                      const Rect.fromLTWH(0, 0, 224, 640),
                    );
                  },
                  child: const Text('Review'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Review'));
        await tester.pumpAndSettle();
        final rect = tester.getRect(
          find.byKey(const ValueKey('cloud-chat-delete-confirmation')),
        );
        expect(rect.width, 240);
        expect(rect.bottom, lessThanOrEqualTo(350));
        expect(rect.left, greaterThanOrEqualTo(10));
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(result, false);
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets(
    'Chat context menu returns only the selected action and dismisses outside',
    (tester) async {
      String? result;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await showCloudChatActions(
                    context,
                    const Conversation(id: 'c', pinned: true),
                    const Rect.fromLTWH(10, 400, 260, 50),
                    preview: const SizedBox(width: 260, height: 50),
                  );
                },
                child: const Text('Actions'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Actions'));
      await tester.pumpAndSettle();
      expect(find.text('Unpin'), findsOneWidget);
      expect(find.text('Cancel'), findsNothing);
      final rect = tester.getRect(
        find.byKey(const ValueKey('cloud-chat-actions')),
      );
      expect(rect.width, 250);
      expect(rect.bottom, lessThan(400));
      await tester.tapAt(const Offset(790, 580));
      await tester.pumpAndSettle();
      expect(result, isNull);
      await tester.tap(find.text('Actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Unpin'));
      await tester.pumpAndSettle();
      expect(result, 'pin');
      expect(tester.takeException(), isNull);
    },
  );
}
