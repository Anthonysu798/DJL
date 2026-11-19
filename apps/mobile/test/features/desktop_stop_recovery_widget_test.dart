import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_panel.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_stop_recovery_test.dart'
    show StopRecoveryTransport, stopDesktop, stopPage;

Future<void> stopFrames(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 200));
  await tester.pump(const Duration(milliseconds: 200));
}

Finder stopIcon() => find.byWidgetPredicate(
  (widget) => widget is IconButton && widget.tooltip == 'Stop turn',
);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    testWidgets(
      'a busy parent update keeps a composed follow-up on Send at $platform',
      (tester) async {
        final transport = StopRecoveryTransport();
        final desktop = (await tester.runAsync(() => stopDesktop(transport)))!;
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox());
          desktop.dispose();
        });
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(platform: platform),
            home: DesktopChatPage(controller: desktop),
          ),
        );
        await stopFrames(tester);
        final input = find.byKey(const Key('desktop_composer'));
        await tester.tap(input);
        const value = TextEditingValue(
          text: 'Only S178_OK',
          selection: TextSelection.collapsed(offset: 12),
          composing: TextRange(start: 5, end: 12),
        );
        tester.testTextInput.updateEditingValue(value);
        await tester.pump();
        final element = tester.element(input);
        expect(find.byTooltip('Send to desktop'), findsOneWidget);
        desktop.busy = true;
        desktop.notifyListeners();
        await tester.pump();
        expect(stopIcon(), findsNothing);
        final send = find.byWidgetPredicate(
          (widget) =>
              widget is IconButton && widget.tooltip == 'Send to desktop',
        );
        expect(send, findsOneWidget);
        expect(tester.widget<IconButton>(send).onPressed, isNull);
        await tester.tap(send);
        await tester.pump();
        expect(
          transport.calls.where((row) => row['method'] == 'turn/interrupt'),
          isEmpty,
        );
        expect(tester.element(input), same(element));
        expect(tester.widget<TextField>(input).controller!.value, value);
        desktop.busy = false;
        desktop.notifyListeners();
        await tester.pump();
        expect(tester.widget<IconButton>(send).onPressed, isNotNull);
        await tester.tap(send);
        await stopFrames(tester);
        expect(desktop.queuedDrafts.single.draft.text, value.text);
        expect(tester.widget<TextField>(input).controller!.text, isEmpty);
        expect(
          transport.calls.where((row) => row['method'] == 'turn/interrupt'),
          isEmpty,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
  for (final profile in [
    (const Size(1080, 2424), 2.625),
    (const Size(1206, 2622), 3.0),
    (const Size(320, 720), 1.0),
  ]) {
    for (final brightness in Brightness.values) {
      testWidgets(
        'owned ID-less Stop is reachable and disabled in flight at $profile $brightness',
        (tester) async {
          tester.view.physicalSize = profile.$1;
          tester.view.devicePixelRatio = profile.$2;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final reply = Completer<RemoteJson>();
          final t = StopRecoveryTransport()
            ..pages.add(stopPage)
            ..interrupts.add(reply);
          final d = (await tester.runAsync(() => stopDesktop(t, turn: null)))!;
          addTearDown(() async {
            if (!reply.isCompleted) reply.complete({});
            await tester.pumpWidget(const SizedBox());
            d.dispose();
          });
          await tester.pumpWidget(
            MaterialApp(
              theme: ThemeData(brightness: brightness),
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: const TextScaler.linear(2.2)),
                child: child!,
              ),
              home: DesktopChatPage(controller: d),
            ),
          );
          await stopFrames(tester);
          final input = find.byKey(const Key('desktop_composer'));
          final element = tester.element(input);
          final before = tester.widget<TextField>(input).controller!.value;
          expect(stopIcon(), findsOneWidget);
          expect(tester.widget<IconButton>(stopIcon()).onPressed, isNotNull);
          await tester.tap(stopIcon());
          await stopFrames(tester);
          expect(
            t.calls.where((row) => row['method'] == 'turn/interrupt'),
            hasLength(1),
          );
          expect(tester.widget<IconButton>(stopIcon()).onPressed, isNull);
          expect(tester.element(input), same(element));
          expect(tester.widget<TextField>(input).controller!.value, before);
          expect(
            t.calls.where(
              (row) => {'turn/start', 'turn/steer'}.contains(row['method']),
            ),
            isEmpty,
          );
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  testWidgets(
    'Stop retains the same input while newer typing and selection survive its acknowledgement',
    (tester) async {
      final reply = Completer<RemoteJson>();
      final t = StopRecoveryTransport()..interrupts.add(reply);
      final d = (await tester.runAsync(() => stopDesktop(t)))!;
      addTearDown(() async {
        if (!reply.isCompleted) reply.complete({});
        await tester.pumpWidget(const SizedBox());
        d.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await stopFrames(tester);
      final input = find.byKey(const Key('desktop_composer'));
      final element = tester.element(input);
      await tester.tap(stopIcon());
      await stopFrames(tester);
      expect(tester.widget<IconButton>(stopIcon()).onPressed, isNull);
      await tester.enterText(input, 'draft after stop');
      final controller = tester.widget<TextField>(input).controller!;
      controller.selection = const TextSelection(
        baseOffset: 2,
        extentOffset: 7,
      );
      await stopFrames(tester);
      reply.complete({});
      await stopFrames(tester);
      expect(tester.element(input), same(element));
      expect(controller.text, 'draft after stop');
      expect(
        controller.selection,
        const TextSelection(baseOffset: 2, extentOffset: 7),
      );
      expect(
        t.calls.where((row) => row['method'] == 'turn/interrupt'),
        hasLength(1),
      );
      expect(
        t.calls.where(
          (row) => {'turn/start', 'turn/steer'}.contains(row['method']),
        ),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a captured Stop callback cannot act on a different selected chat',
    (tester) async {
      final t = StopRecoveryTransport();
      final d = (await tester.runAsync(() => stopDesktop(t)))!;
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        d.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await stopFrames(tester);
      final captured = tester
          .widget<DesktopComposerPanel>(find.byType(DesktopComposerPanel))
          .onStop!;
      d.thread = {'id': 'other', 'cwd': '/qa'};
      d.turnId = 'other-live';
      d.setPlan(false);
      await stopFrames(tester);
      captured();
      await stopFrames(tester);
      expect(
        t.calls.where((row) => row['method'] == 'turn/interrupt'),
        isEmpty,
      );
      expect(d.turnId, 'other-live');
    },
  );
}
