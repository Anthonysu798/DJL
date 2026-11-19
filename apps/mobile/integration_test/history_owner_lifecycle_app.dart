// Volatile HTTP/controller recovery probe. No real account, storage or network.
import 'dart:async';
import 'dart:convert';
import 'package:djl_mobile/app/cloud_navigation.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/conversations/presentation/cloud_navigation_menu.dart';
import 'package:djl_mobile/features/conversations/presentation/conversation_controller.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _VolatileCredentials implements CredentialStore {
  String? session = 'qa-A';
  @override
  Future<String?> read(String key) async => session;
  @override
  Future<void> write(String key, String? value) async => session = value;
}

class _HistoryFixture {
  final mutation = Completer<http.Response>(),
      mutationStarted = Completer<void>();
  final loadStarted = Completer<void>();
  Completer<http.Response>? load;
  String owner = 'A';
  int lists = 0, notifications = 0;
  bool disposed = false;
  late final client = CloudClient(
    baseUrl: Uri.parse('https://volatile-qa.test/'),
    credentials: _VolatileCredentials(),
    client: MockClient((request) async {
      if (request.url.path == '/v1/auth/token') {
        return http.Response('{"token":"volatile-qa-jwt"}', 200);
      }
      if (request.method == 'PATCH') {
        mutationStarted.complete();
        return mutation.future;
      }
      if (request.url.path != '/v1/conversations') {
        throw StateError('Unexpected volatile QA request');
      }
      lists++;
      if (!loadStarted.isCompleted) loadStarted.complete();
      return load?.future ?? Future.value(page());
    }),
  );
  http.Response page() => http.Response(
    jsonEncode({
      'conversations': [
        {'id': 'owner-$owner', 'title': 'Owner $owner QA history'},
      ],
      'nextCursor': null,
    }),
    200,
  );
  late final repository = CloudRepository(client);
  late final history = ConversationController(repository)
    ..addListener(() => notifications++);
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

void main() => runApp(
  MaterialApp(
    theme: djlTheme(Brightness.light),
    home: const HistoryOwnerProbe(),
  ),
);

class HistoryOwnerProbe extends StatefulWidget {
  const HistoryOwnerProbe({super.key});
  @override
  State<HistoryOwnerProbe> createState() => _HistoryOwnerProbeState();
}

class _HistoryOwnerProbeState extends State<HistoryOwnerProbe> {
  final fixture = _HistoryFixture();
  final navigation = CloudNavigationController()..bindOwner('qa-A');
  String status = 'Ready';
  bool ran = false;
  @override
  void initState() {
    super.initState();
    unawaited(fixture.history.refresh());
  }

  void require(bool condition, String message) {
    if (!condition) throw StateError(message);
  }

  Future<void> check() async {
    setState(() {
      ran = true;
      status = 'Checking history ownership';
    });
    final pendingLoad = _HistoryFixture()..load = Completer<http.Response>();
    final disposedLoad = _HistoryFixture()..load = Completer<http.Response>();
    try {
      final history = fixture.history;
      if (history.items.isEmpty) await history.refresh();
      final lists = fixture.lists;
      final mutation = history.update(history.items.single, {
        'title': 'QA rename',
      });
      await fixture.mutationStarted.future;
      await fixture.client.setSession('qa-B');
      fixture.owner = 'B';
      navigation.bindOwner('qa-B');
      history.clear();
      await history.refresh();
      final notifications = fixture.notifications;
      fixture.mutation.complete(http.Response('{}', 200));
      await mutation;
      require(history.error == null, 'Old session error reached new history');
      require(history.items.single.id == 'owner-B', 'Wrong owner history');
      require(fixture.notifications == notifications, 'Late mutation notified');
      require(fixture.lists == lists + 1, 'Late mutation refreshed new owner');

      final loading = pendingLoad.history.refresh();
      await pendingLoad.loadStarted.future;
      pendingLoad.history.clear();
      require(!pendingLoad.history.loading, 'Clear left loading active');
      pendingLoad.load!.complete(pendingLoad.page());
      await loading;
      require(pendingLoad.history.items.isEmpty, 'Cleared page was restored');

      final disposed = disposedLoad.history.refresh();
      await disposedLoad.loadStarted.future;
      disposedLoad.disposeHistory();
      disposedLoad.load!.complete(disposedLoad.page());
      await disposed;
      if (mounted) setState(() => status = 'History ownership checks passed');
    } catch (error) {
      if (mounted) setState(() => status = 'History check failed: $error');
    } finally {
      pendingLoad.close();
      disposedLoad.close();
    }
  }

  @override
  void dispose() {
    fixture.close();
    navigation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('DJL history lifecycle QA')),
    body: Column(
      children: [
        Text(status),
        ElevatedButton(
          onPressed: ran ? null : check,
          child: const Text('Run history ownership checks'),
        ),
        Expanded(
          child: CloudNavigationMenu(
            history: fixture.history,
            navigation: navigation,
            onDestination: (_) {},
            onConversation: (_) {},
            onNewChat: () {},
            onRemote: () {},
            onAction: (_, _, _) async {},
          ),
        ),
      ],
    ),
  );
}
