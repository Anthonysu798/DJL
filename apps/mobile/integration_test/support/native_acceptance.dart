import 'package:http/http.dart' as http;
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/settings/data/settings_store.dart';

bool nativeLinkLoaded(ChatController controller, String id, String title) =>
    !controller.loading &&
    controller.error == null &&
    controller.conversation?.id == id &&
    controller.conversation?.title == title;

Uri nativeAcceptanceApi(String endpoint) {
  final url = Uri.parse(endpoint);
  if (url.scheme != 'http' ||
      !{'127.0.0.1', 'localhost', '10.0.2.2', '::1'}.contains(url.host) ||
      (url.path.isNotEmpty && url.path != '/') ||
      url.userInfo.isNotEmpty ||
      url.hasQuery ||
      url.hasFragment) {
    throw ArgumentError(
      'Native acceptance requires an explicit local HTTP API.',
    );
  }
  return url;
}

Uri nativeAcceptanceDriverHost({required bool isAndroid}) =>
    Uri.parse(isAndroid ? 'http://10.0.2.2:8855/' : 'http://127.0.0.1:8855/');

// Records method/path counts before delegation. Requests and responses remain
// real in native journeys; credentials, headers and bodies are never retained.
class ConversationRequestRecorder extends http.BaseClient {
  ConversationRequestRecorder(this._delegate);
  final http.Client _delegate;
  final _counts = <(String, String), int>{};

  int count(String method, String path) =>
      _counts[(method.toUpperCase(), path)] ?? 0;

  int get totalRequestAttempts =>
      _counts.values.fold(0, (total, count) => total + count);

  int get conversationMutationAttempts => _counts.entries
      .where(
        (entry) =>
            !{'GET', 'HEAD', 'OPTIONS'}.contains(entry.key.$1) &&
            (entry.key.$2 == '/v1/conversations' ||
                entry.key.$2.startsWith('/v1/conversations/')),
      )
      .fold(0, (total, entry) => total + entry.value);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    final key = (request.method.toUpperCase(), request.url.path);
    _counts.update(key, (value) => value + 1, ifAbsent: () => 1);
    return _delegate.send(request);
  }

  @override
  void close() => _delegate.close();
}

const nativeSettingsBaseline = <String, Object>{
  'djl.appearance.mode': 'light',
  'codex.appFontStyle': 'system',
  'codex.userBubbleColor': 'default',
};
const nativeSettingsTarget = <String, Object>{
  'djl.appearance.mode': 'dark',
  'codex.appFontStyle': 'geistMono',
  'codex.userBubbleColor': 'pink',
};

Future<void> establishNativeSettingsBaseline(SettingsStore store) async {
  for (final entry in nativeSettingsBaseline.entries) {
    await store.write(entry.key, entry.value);
  }
  await verifyNativeSettings(store, nativeSettingsBaseline);
}

Future<void> verifyNativeSettings(
  SettingsStore store,
  Map<String, Object> expected,
) async {
  final values = await store.read();
  for (final entry in expected.entries) {
    if (values[entry.key] != entry.value) {
      throw StateError(
        'Persisted native appearance does not match ${entry.key}.',
      );
    }
  }
}
