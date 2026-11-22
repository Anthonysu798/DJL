// Streamed words redraw only the answer they belong to; the rest of the chat
// catches up a few times a second instead of on every word.
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../../integration_test/support/paired_voice_fixture.dart'
    show VolatileVoiceCredentials, VoicePageMemoryStore;

class _Mac extends RemoteTransport {
  _Mac(super.pairings);
  final events = StreamController<RemoteJson>.broadcast(sync: true);
  @override
  bool get connected => true;
  @override
  String? get macDeviceId => 'live-mac';
  @override
  Stream<RemoteJson> get messages => events.stream;
  @override
  Future<void> send(RemoteJson message) async {}
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async => method == 'turn/start'
      ? {
          'turn': {'id': 'live-turn', 'status': 'inProgress', 'items': []},
        }
      : {'data': []};
  void emit(String method, RemoteJson params) => events.add({
    'method': method,
    'params': {'threadId': 'live-thread', 'turnId': 'live-turn', ...params},
  });
  @override
  Future<void> dispose() async => events.close();
}

void main() {
  testWidgets('new words show at once; the page catches up after 250 ms', (
    tester,
  ) async {
    final pairs = PairingRepository(VolatileVoiceCredentials());
    final mac = _Mac(pairs);
    const pair = Pairing({
      'macDeviceId': 'live-mac',
      'macIdentityPublicKey': 'pin',
    });
    final desktop =
        DesktopController(
            pairs,
            connection: mac,
            localStore: VoicePageMemoryStore(VolatileVoiceCredentials()),
          )
          ..active = pair
          ..trusted = [pair]
          ..state = 'connected'
          ..model = 'live'
          ..models = [
            {
              'id': 'live',
              'model': 'live',
              'displayName': 'Live',
              'djlProvider': 'codex',
            },
          ];
    await desktop.threadList.attach('live-mac');
    desktop.thread = {'id': 'live-thread', 'cwd': '/live', 'turns': []};
    await tester.pumpWidget(
      MaterialApp(
        theme: djlTheme(Brightness.light),
        home: DesktopChatPage(controller: desktop),
      ),
    );
    await tester.pumpAndSettle();
    unawaited(desktop.send('Hello'));
    await tester.pump(const Duration(milliseconds: 50));
    mac.emit('turn/started', {
      'turn': {'id': 'live-turn', 'status': 'inProgress', 'items': []},
    });
    mac.emit('item/started', {
      'item': {'id': 'a', 'type': 'agentMessage', 'text': ''},
    });
    await tester.pump();

    var pageUpdates = 0;
    void counted() => pageUpdates++;
    desktop.addListener(counted);
    mac.emit('item/agentMessage/delta', {'itemId': 'a', 'delta': 'Hello'});
    mac.emit('item/agentMessage/delta', {'itemId': 'a', 'delta': ' there'});
    await tester.pump();
    expect(
      find.textContaining('Hello there', findRichText: true),
      findsOneWidget,
    );
    expect(pageUpdates, 0);

    await tester.pump(const Duration(milliseconds: 300));
    expect(pageUpdates, 1);

    // Finishing the answer is a structural change and updates the page now.
    mac.emit('item/completed', {
      'item': {'id': 'a', 'type': 'agentMessage', 'text': 'Hello there'},
    });
    expect(pageUpdates, greaterThan(1));
    desktop.removeListener(counted);
    await tester.pumpWidget(const SizedBox());
    desktop.dispose();
  });
}
