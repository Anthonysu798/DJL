// Non-recording voice/RPC adapters for host and native lifecycle checks only.
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/desktop/data/desktop_local_store.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/voice/data/voice_driver.dart';

class VolatileVoiceCredentials implements CredentialStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String? value) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

class VoicePageTransport extends RemoteTransport {
  VoicePageTransport(super.pairings);
  final requests = <String>[];
  @override
  bool get connected => true;
  @override
  String? get macDeviceId => 'qa-voice-mac';
  @override
  Stream<RemoteJson> get messages => const Stream.empty();
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    requests.add(method);
    if (['turn/start', 'turn/steer', 'thread/start'].contains(method)) {
      throw StateError('The lifecycle probe must never send');
    }
    return {'data': []};
  }

  @override
  Future<void> dispose() async {}
}

class VoicePageMemoryStore extends DesktopLocalStore {
  VoicePageMemoryStore(super.credentials);
  @override
  Future<RemoteJson> load(String mac) async => {};
  @override
  Future<void> save(String mac, RemoteJson value) async {}
  @override
  Future<void> delete(String mac) async {}
}

class PendingPageVoice extends ChangeNotifier
    with WidgetsBindingObserver
    implements VoiceDriver {
  Completer<bool> permission = Completer<bool>();
  int initializations = 0,
      starts = 0,
      cancels = 0,
      grants = 0,
      offscreenStarts = 0;
  bool releaseOnInactive = false;
  void completePermission() {
    if (!permission.isCompleted) {
      grants++;
      permission.complete(true);
      notifyListeners();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (releaseOnInactive &&
        state == AppLifecycleState.inactive &&
        initializations > 0) {
      completePermission();
    }
  }

  void Function(String)? transcript;
  @override
  Future<bool> initialize() {
    initializations++;
    notifyListeners();
    return permission.future;
  }

  @override
  Future<void> listen({
    required void Function(String) onText,
    required void Function() onDone,
    required void Function(String) onError,
  }) async {
    starts++;
    if (WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) {
      offscreenStarts++;
    }
    transcript = onText;
    notifyListeners();
  }

  @override
  Future<void> stopListening() async {
    cancels++;
    notifyListeners();
  }

  @override
  Future<void> cancelListening() async {
    cancels++;
    notifyListeners();
  }

  @override
  Future<void> speak(String text) async {
    throw StateError('No audio in this probe');
  }

  @override
  Future<void> stopSpeaking() async {}
}

typedef PairedVoiceFixture = ({
  DesktopController desktop,
  VoicePageTransport transport,
  PendingPageVoice voice,
});

Future<PairedVoiceFixture> pairedVoiceFixture() async {
  final store = VolatileVoiceCredentials(),
      pairs = PairingRepository(VolatileVoiceCredentials());
  final transport = VoicePageTransport(pairs);
  const pair = Pairing({
    'macDeviceId': 'qa-voice-mac',
    'macIdentityPublicKey': 'qa-public-pin',
  });
  final desktop =
      DesktopController(
          pairs,
          connection: transport,
          localStore: VoicePageMemoryStore(store),
        )
        ..active = pair
        ..trusted = [pair]
        ..state = 'connected'
        ..model = 'qa'
        ..models = [
          {
            'id': 'qa',
            'model': 'qa',
            'displayName': 'Volatile QA model',
            'djlProvider': 'codex',
          },
        ];
  await desktop.threadList.attach('qa-voice-mac');
  desktop.thread = {'id': 'qa-voice-thread', 'turns': []};
  return (desktop: desktop, transport: transport, voice: PendingPageVoice());
}
