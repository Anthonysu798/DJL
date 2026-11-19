import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/conversations/presentation/cloud_archived_chats_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

class ArchiveFixture {
  final calls = <String>[];
  final patches = <Map<String, dynamic>>[];
  bool failLoad = false, failRestore = false;
  Completer<http.Response>? loadGate, restoreGate;
  int restored = 0;
  late final client = CloudClient(
    baseUrl: Uri.parse('https://qa.test/'),
    credentials: TestCredentials()..values['cloud.session'] = 'session',
    client: MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      if (request.url.path == '/v1/auth/token') {
        return http.Response('{"token":"jwt"}', 200);
      }
      if (request.method == 'PATCH') {
        patches.add(jsonDecode(request.body) as Map<String, dynamic>);
        if (restoreGate != null) return restoreGate!.future;
        return http.Response(
          failRestore ? '{"error":{"message":"Restore failed"}}' : '{}',
          failRestore ? 503 : 200,
        );
      }
      expect(request.method, 'GET');
      expect(request.url.path, '/v1/conversations');
      expect(request.url.queryParameters['archived'], 'true');
      if (loadGate != null) return loadGate!.future;
      if (failLoad) {
        return http.Response(
          '{"error":{"message":"Archive unavailable"}}',
          503,
        );
      }
      final more = request.url.queryParameters['cursor'] == 'next';
      return http.Response(
        jsonEncode({
          'conversations': [
            for (final id in more ? ['b', 'c'] : ['a', 'b'])
              {'id': id, 'title': 'Archived $id', 'archived': true},
          ],
          'nextCursor': more ? null : 'next',
        }),
        200,
      );
    }),
  );
  late final repository = CloudRepository(client);
  Widget page({double scale = 1}) => MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(scale)),
      child: child!,
    ),
    home: CloudArchivedChatsPage(
      repository: repository,
      onRestored: () => restored++,
    ),
  );
  void dispose() {
    repository.modelSelection.dispose();
  }
}

void main() {
  testWidgets(
    'Archived paging deduplicates and Restore sends only its exact patch',
    (tester) async {
      final f = ArchiveFixture();
      try {
        await tester.pumpWidget(f.page());
        await tester.pumpAndSettle();
        await tester.tap(find.text('Load more'));
        await tester.pumpAndSettle();
        expect(find.text('Archived b'), findsOneWidget);
        expect(find.text('Archived c'), findsOneWidget);
        f.restoreGate = Completer<http.Response>();
        await tester.tap(
          find.byKey(const ValueKey('cloud.archived.restore.a')),
        );
        await tester.pump();
        expect(
          tester
              .widget<TextButton>(
                find.byKey(const ValueKey('cloud.archived.restore.b')),
              )
              .onPressed,
          isNull,
        );
        f.restoreGate!.complete(http.Response('{}', 200));
        await tester.pumpAndSettle();
        expect(find.text('Archived a'), findsNothing);
        expect(find.text('Archived b'), findsOneWidget);
        expect(f.patches, [
          {'archived': false},
        ]);
        expect(f.restored, 1);
        expect(
          f.calls.where((c) => c.startsWith('POST') || c.startsWith('DELETE')),
          isEmpty,
        );
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        f.dispose();
      }
    },
  );
  testWidgets('Archived read and restore failures keep rows recoverable', (
    tester,
  ) async {
    final f = ArchiveFixture()..failLoad = true;
    try {
      await tester.pumpWidget(f.page());
      await tester.pumpAndSettle();
      expect(find.text('Archive unavailable'), findsOneWidget);
      f.failLoad = false;
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      f.failRestore = true;
      await tester.tap(find.byKey(const ValueKey('cloud.archived.restore.a')));
      await tester.pumpAndSettle();
      expect(find.text('Restore failed'), findsOneWidget);
      expect(find.text('Archived a'), findsOneWidget);
      expect(f.restored, 0);
      f.failRestore = false;
      await tester.tap(find.byKey(const ValueKey('cloud.archived.restore.a')));
      await tester.pumpAndSettle();
      expect(find.text('Archived a'), findsNothing);
      expect(f.restored, 1);
      expect(f.patches.length, 2);
      expect(tester.takeException(), isNull);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      f.dispose();
    }
  });
  for (final restore in [false, true]) {
    for (final ownerChanges in [false, true]) {
      testWidgets(
        'Late archived ${restore ? 'restore' : 'read'} is fenced after ${ownerChanges ? 'account change' : 'dismissal'}',
        (tester) async {
          final f = ArchiveFixture();
          final gate = Completer<http.Response>();
          try {
            if (!restore) f.loadGate = gate;
            await tester.pumpWidget(f.page());
            if (restore) {
              await tester.pumpAndSettle();
              f.restoreGate = gate;
              await tester.tap(
                find.byKey(const ValueKey('cloud.archived.restore.a')),
              );
            }
            for (var i = 0; i < 5; i++) {
              await tester.pump(const Duration(milliseconds: 16));
            }
            if (ownerChanges) {
              await f.client.setSession('other-session');
            } else {
              await tester.pumpWidget(const SizedBox.shrink());
            }
            gate.complete(
              http.Response(
                restore
                    ? '{}'
                    : '{"conversations":[{"id":"late","title":"Wrong late row"}],"nextCursor":null}',
                200,
              ),
            );
            for (var i = 0; i < 5; i++) {
              await tester.pump(const Duration(milliseconds: 16));
            }
            expect(f.restored, 0);
            expect(find.text('Wrong late row'), findsNothing);
            expect(tester.takeException(), isNull);
          } finally {
            await tester.pumpWidget(const SizedBox.shrink());
            if (!gate.isCompleted) gate.complete(http.Response('{}', 200));
            await tester.pumpAndSettle();
            f.dispose();
          }
        },
      );
    }
  }
  testWidgets('Archived rows remain usable with large text on a phone', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    final f = ArchiveFixture();
    try {
      await tester.pumpWidget(f.page(scale: 3));
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byKey(const ValueKey('cloud.archived.restore.a')),
      );
      expect(
        tester
            .getSize(find.byKey(const ValueKey('cloud.archived.restore.a')))
            .height,
        greaterThanOrEqualTo(44),
      );
      expect(tester.takeException(), isNull);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      f.dispose();
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    }
  });
}
