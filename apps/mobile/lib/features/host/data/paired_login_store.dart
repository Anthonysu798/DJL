import 'dart:convert';
import '../../../../core/security/credential_store.dart';
import '../../../../app/paired_login_callback.dart';
import '../domain/paired_login.dart';

/// Swift's logical codex.gpt.pendingLoginState and pendingLoginCallbackState
/// share one secure record here, scoped by trusted device AND its identity pin.
/// No callback or authorization address belongs in ordinary preferences.
class PairedLoginStore {
  PairedLoginStore(this.credentials, {this.allowLocal = false});
  final CredentialStore credentials;
  final bool allowLocal;
  final _writes = <LoginIdentity, Future<void>>{};
  String _key(LoginIdentity identity) =>
      'codex.gpt.pendingLoginState.${base64Url.encode(utf8.encode(jsonEncode([identity.device, identity.pin])))}';
  Future<LoginRecord> read(LoginIdentity identity) async {
    await _writes[identity]?.catchError((Object _) {});
    final text = await credentials.read(_key(identity));
    if (text == null) return const LoginRecord();
    final raw = jsonDecode(text) as Map;
    final saved = raw['pending'];
    PendingLogin? pending;
    if (saved is Map) {
      final created = loginDate(saved['createdAt']);
      if (created == null) {
        throw const FormatException('Invalid saved sign-in.');
      }
      pending = PendingLogin.decode(
        Map<String, dynamic>.from(saved),
        now: created,
        allowLocal: allowLocal,
      );
    }
    final cb = raw['callback'];
    LoginCallback? callback;
    if (cb is Map &&
        cb['loginId'] == pending?.loginId &&
        cb['callbackUrl'] is String) {
      final uri = Uri.tryParse(cb['callbackUrl'] as String),
          created = loginDate(cb['createdAt']);
      if (uri == null || pairedLoginCallback(uri) == null || created == null) {
        throw const FormatException('Invalid saved callback.');
      }
      callback = LoginCallback(pending!.loginId, uri.toString(), created);
    }
    return LoginRecord(
      pending: pending,
      callback: callback,
      uncertainStart: raw['uncertainStart'] == true,
      remoteUnconfirmed: raw['remoteUnconfirmed'] == true,
      callbackAttempted: raw['callbackAttempted'] == true,
    );
  }

  Future<void> write(LoginIdentity identity, LoginRecord record) {
    final work = (_writes[identity] ?? Future.value())
        .catchError((Object _) {})
        .then(
          (_) => credentials.write(_key(identity), jsonEncode(record.toJson())),
        );
    _writes[identity] = work;
    return work;
  }

  Future<void> forget(LoginIdentity identity) {
    final work = (_writes[identity] ?? Future.value())
        .catchError((Object _) {})
        .then((_) => credentials.write(_key(identity), null));
    _writes[identity] = work;
    return work;
  }
}
