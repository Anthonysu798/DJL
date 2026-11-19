import 'dart:async';
import 'dart:convert';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/conversations/presentation/conversation_controller.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

class HistoryLifecycleFixture {
  final mutation = Completer<http.Response>();
  final mutationStarted = Completer<void>();
  Completer<http.Response>? load;
  final loadStarted = Completer<void>();
  int lists = 0, notifications = 0;
  bool disposed = false;
  late final client = CloudClient(
    baseUrl: Uri.parse('https://qa.test/'),
    credentials: TestCredentials()..values['cloud.session'] = 'qa-session',
    client: MockClient((request) async {
      if (request.url.path == '/v1/auth/token') {
        return http.Response('{"token":"qa-jwt"}', 200);
      }
      if (request.method == 'PATCH' || request.method == 'DELETE') {
        mutationStarted.complete();
        return mutation.future;
      }
      expect(request.url.path, '/v1/conversations');
      lists++;
      if (!loadStarted.isCompleted) loadStarted.complete();
      return load?.future ?? Future.value(page());
    }),
  );
  late final repository = CloudRepository(client);
  late final history = ConversationController(repository)
    ..addListener(() => notifications++);
  static http.Response page() => http.Response(
    jsonEncode({
      'conversations': [
        {'id': 'current', 'title': 'Current QA history'},
      ],
      'nextCursor': null,
    }),
    200,
  );
  Future<void> change(String operation) {
    final old = Conversation.fromJson({'id': 'old', 'title': 'Old QA history'});
    return operation == 'update'
        ? history.update(old, {'title': 'Renamed QA history'})
        : history.delete(old);
  }

  void disposeHistory() {
    history.dispose();
    disposed = true;
  }

  void close() {
    if (!disposed) disposeHistory();
    repository.modelSelection.dispose();
    client.close();
  }
}

void main() {
  for (final operation in ['update', 'delete']) {
    for (final fails in [false, true]) {
      test(
        '$operation late result cannot affect cleared history ($fails)',
        () async {
          final f = HistoryLifecycleFixture();
          addTearDown(f.close);
          final changing = f.change(operation);
          await f.mutationStarted.future;
          f.history.clear();
          await f.history.refresh();
          final notifications = f.notifications;
          f.mutation.complete(
            http.Response(
              fails ? '{"error":{"message":"Old failure"}}' : '{}',
              fails ? 503 : 200,
            ),
          );
          await changing;
          expect(f.history.items.single.id, 'current');
          expect(f.history.error, isNull);
          expect(
            f.lists,
            1,
            reason: 'Old mutation must not refresh the new owner.',
          );
          expect(f.notifications, notifications);
        },
      );

      test('$operation late result is quiet after disposal ($fails)', () async {
        final f = HistoryLifecycleFixture();
        addTearDown(f.close);
        final changing = f.change(operation);
        await f.mutationStarted.future;
        f.disposeHistory();
        f.mutation.complete(http.Response('{}', fails ? 503 : 200));
        await expectLater(changing, completes);
        expect(f.lists, 0);
      });
    }

    test(
      '$operation suppresses the old session error even before clear',
      () async {
        final f = HistoryLifecycleFixture();
        addTearDown(f.close);
        final changing = f.change(operation);
        await f.mutationStarted.future;
        await f.client.setSession('replacement-qa-session');
        f.mutation.complete(http.Response('{}', 200));
        await changing;
        expect(f.history.error, isNull);
        expect(f.notifications, 0);
      },
    );
  }

  test('clear ends loading and ignores the superseded page', () async {
    final f = HistoryLifecycleFixture()..load = Completer<http.Response>();
    addTearDown(f.close);
    final loading = f.history.refresh();
    await f.loadStarted.future;
    f.history.clear();
    expect(f.history.loading, isFalse);
    f.load!.complete(HistoryLifecycleFixture.page());
    await loading;
    expect(f.history.items, isEmpty);
  });

  test(
    'a current mutation failure remains visible and can be retried',
    () async {
      final f = HistoryLifecycleFixture();
      addTearDown(f.close);
      final changing = f.change('update');
      await f.mutationStarted.future;
      f.mutation.complete(
        http.Response('{"error":{"message":"Current failure"}}', 503),
      );
      await changing;
      expect(f.history.error, 'Current failure');
      await f.history.refresh();
      expect(f.history.error, isNull);
      expect(f.history.items.single.id, 'current');
    },
  );

  test('a pending page cannot notify a disposed controller', () async {
    final f = HistoryLifecycleFixture()..load = Completer<http.Response>();
    addTearDown(f.close);
    final loading = f.history.refresh();
    await f.loadStarted.future;
    f.disposeHistory();
    f.load!.complete(HistoryLifecycleFixture.page());
    await expectLater(loading, completes);
  });

  test(
    'current mutation still refreshes after another current-owner load',
    () async {
      final f = HistoryLifecycleFixture();
      addTearDown(f.close);
      final changing = f.change('update');
      await f.mutationStarted.future;
      await f.history.refresh();
      f.mutation.complete(http.Response('{}', 200));
      await changing;
      expect(f.lists, 2);
      expect(f.history.error, isNull);
      expect(f.history.items.single.id, 'current');
    },
  );
}
