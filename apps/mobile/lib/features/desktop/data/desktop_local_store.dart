import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart' as hash;
import 'package:cryptography/cryptography.dart';
import 'package:path_provider/path_provider.dart';
import '../../../core/security/credential_store.dart';
import '../../pairing/data/pairing_repository.dart';

/// New Flutter cache format. The Swift app's private container is not migrated by this development identity.
class DesktopLocalStore {
  DesktopLocalStore(this.credentials, {this.root});
  final CredentialStore credentials;
  final Directory? root;
  final _cipher = AesGcm.with256bits();
  Future<SecretKey>? _keyFuture;
  Future<void> _writes = Future<void>.value();
  Future<void> flush() => _writes;
  Future<SecretKey> _loadKey() async {
    const name = 'desktop.local.key.v1';
    final encoded = await credentials.read(name);
    if (encoded != null) {
      final bytes = base64Decode(encoded);
      if (bytes.length != 32) {
        throw StateError('The local history key is unavailable.');
      }
      return SecretKey(bytes);
    }
    final key = await _cipher.newSecretKey();
    await credentials.write(name, base64Encode(await key.extractBytes()));
    return key;
  }

  Future<SecretKey> _key() async {
    final job = _keyFuture ??= _loadKey();
    try {
      return await job;
    } catch (_) {
      if (identical(_keyFuture, job)) {
        _keyFuture = null;
      }
      rethrow;
    }
  }

  Future<File> _file(String mac) async {
    if (mac.trim().isEmpty) {
      throw ArgumentError('A paired desktop is required.');
    }
    final base = root ?? await getApplicationSupportDirectory();
    final id = hash.sha256.convert(utf8.encode(mac)).toString();
    return File('${base.path}/desktop-cache-v1/$id.json');
  }

  List<int> _aad(String mac) => utf8.encode('djl-mobile-local-v1:$mac');
  Future<RemoteJson> load(String mac) async {
    await _writes;
    final file = await _file(mac);
    if (!await file.exists()) {
      return {};
    }
    final value = jsonDecode(await file.readAsString()) as RemoteJson;
    if (value['v'] != 1) {
      throw const FormatException('Unsupported local history format.');
    }
    final plaintext = await _cipher.decrypt(
      SecretBox(
        base64Decode(value['ciphertext'] as String),
        nonce: base64Decode(value['nonce'] as String),
        mac: Mac(base64Decode(value['tag'] as String)),
      ),
      secretKey: await _key(),
      aad: _aad(mac),
    );
    return jsonDecode(utf8.decode(plaintext)) as RemoteJson;
  }

  Future<void> save(String mac, RemoteJson value) {
    // Capture a stable snapshot before awaiting queued encryption or filesystem work.
    final plaintext = utf8.encode(jsonEncode(value));
    final write = _writes.then((_) async {
      final box = await _cipher.encrypt(
        plaintext,
        secretKey: await _key(),
        nonce: _cipher.newNonce(),
        aad: _aad(mac),
      );
      final file = await _file(mac);
      await file.parent.create(recursive: true);
      final temp = File('${file.path}.tmp');
      await temp.writeAsString(
        jsonEncode({
          'v': 1,
          'nonce': base64Encode(box.nonce),
          'ciphertext': base64Encode(box.cipherText),
          'tag': base64Encode(box.mac.bytes),
        }),
        flush: true,
      );
      await temp.rename(file.path);
    });
    _writes = write.catchError((Object _) {});
    return write;
  }

  Future<void> delete(String mac) {
    final remove = _writes.then((_) async {
      final file = await _file(mac);
      if (await file.exists()) {
        await file.delete();
      }
    });
    _writes = remove.catchError((Object _) {});
    return remove;
  }
}
