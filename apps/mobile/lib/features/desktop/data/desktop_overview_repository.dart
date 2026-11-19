import '../../pairing/data/pairing_repository.dart';
import 'remote_transport.dart';

class DesktopOverviewRepository {
  DesktopOverviewRepository(this.transport) : _mac = transport.macDeviceId;
  final RemoteTransport transport;
  final String? _mac;

  Future<RemoteJson> _read(String method) async {
    if (!transport.connected || transport.macDeviceId != _mac) {
      throw StateError('The paired desktop is disconnected or changed.');
    }
    final response = await transport.request(method, {});
    if (!transport.connected || transport.macDeviceId != _mac) {
      throw StateError('The paired desktop changed. Refresh its overview.');
    }
    return response;
  }

  Future<List<String>> projectlessRoots() async =>
      ((await _read('project/projectlessRoots'))['roots'] as List? ?? [])
          .whereType<String>()
          .toList();
}
