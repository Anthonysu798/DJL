import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract interface class CredentialStore {
  Future<String?> read(String key);
  Future<void> write(String key, String? value);
}

class PlatformCredentialStore implements CredentialStore {
  PlatformCredentialStore()
    : _storage = const FlutterSecureStorage(
        aOptions: AndroidOptions(resetOnError: false),
        iOptions: IOSOptions(
          accessibility: KeychainAccessibility.first_unlock_this_device,
        ),
      );
  final FlutterSecureStorage _storage;
  @override
  Future<String?> read(String key) => _storage.read(key: key);
  @override
  Future<void> write(String key, String? value) => value == null
      ? _storage.delete(key: key)
      : _storage.write(key: key, value: value);
}
