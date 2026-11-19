import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/git/data/git_repository.dart';
import 'package:djl_mobile/features/git/presentation/git_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_requests_test.dart' show TestTransport;

class DiffReadTransport extends TestTransport {
  DiffReadTransport(super.pairings);
  Completer<RemoteJson>? reply;
  @override
  String? get macDeviceId => 'diff-mac';
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': Map.of(params)});
    return reply?.future ?? {'patch': '+previous patch'};
  }
}

void main() {
  test(
    'a failed new diff load cannot retain the earlier successful patch',
    () async {
      final transport = DiffReadTransport(PairingRepository(TestCredentials()));
      final controller = GitController(
        GitRepository(transport, cwd: '/qa/diff'),
      );
      await controller.loadDiff();
      expect(controller.patch, '+previous patch');
      final reply = transport.reply = Completer<RemoteJson>();
      final loading = controller.loadDiff();
      expect(controller.patch, isNull);
      reply.completeError(StateError('QA diff read failed'));
      await loading;
      expect(controller.patch, isNull);
      expect(controller.error, contains('QA diff read failed'));
      expect(controller.loading, isFalse);
      expect(transport.calls.map((call) => call['method']), [
        'git/diff',
        'git/diff',
      ]);
      controller.dispose();
      await transport.dispose();
    },
  );
}
