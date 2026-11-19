import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/auth/presentation/auth_controller.dart';

class UnavailableCredentials implements CredentialStore {
  @override
  Future<String?> read(String key) async =>
      throw StateError('keychain unavailable');
  @override
  Future<void> write(String key, String? value) async =>
      throw StateError('keychain unavailable');
}

void main() {
  test(
    'secure storage failure exits loading and gives a recoverable sign-in state',
    () async {
      final controller = AuthController(
        CloudClient(
          baseUrl: Uri.parse('https://example.test'),
          credentials: UnavailableCredentials(),
        ),
      );
      await controller.restore();
      expect(controller.ready, isTrue);
      expect(controller.signedIn, isFalse);
      expect(controller.error, contains('secure storage'));
      controller.dispose();
    },
  );
}
