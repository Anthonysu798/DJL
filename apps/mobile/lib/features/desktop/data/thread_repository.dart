import '../../pairing/data/pairing_repository.dart';
import 'remote_transport.dart';
import '../../../l10n/l10n.dart';

class ThreadRepository {
  ThreadRepository(this.transport, {required this.macDeviceId});
  final RemoteTransport transport;
  final String macDeviceId;
  Future<RemoteJson> _call(String method, RemoteJson params) async {
    if (!transport.connected || transport.macDeviceId != macDeviceId) {
      throw StateError(appStrings.desktopPairedDisconnectedOrChanged);
    }
    final result = await transport.request(method, params);
    if (transport.macDeviceId != macDeviceId) {
      throw StateError(appStrings.desktopPairedChangedRefreshChats);
    }
    return result;
  }

  Future<RemoteJson> list(String? cursor) => _call('thread/list', {
    'sourceKinds': ['cli', 'vscode', 'appServer', 'exec', 'unknown'],
    'cursor': cursor,
    'limit': 100,
  });
  Future<void> rename(String id, String name) async {
    await _call('thread/name/set', {'thread_id': id, 'name': name});
  }

  Future<void> archive(String id, bool archived) async {
    await _call(archived ? 'thread/archive' : 'thread/unarchive', {
      'threadId': id,
    });
  }
}
