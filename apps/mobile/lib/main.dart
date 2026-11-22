import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'app/djl_app.dart';
import 'core/network/cloud_client.dart';
import 'core/security/credential_store.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  const endpoint = String.fromEnvironment(
    'DJL_CLOUD_API_URL',
    defaultValue: 'https://api.slcor.com',
  );
  final url = Uri.parse(endpoint);
  final local = {
    '127.0.0.1',
    'localhost',
    '10.0.2.2',
    '::1',
  }.contains(url.host);
  if ((url.scheme != 'https' &&
          !(kDebugMode && local && url.scheme == 'http')) ||
      url.host.isEmpty ||
      url.userInfo.isNotEmpty ||
      url.hasQuery ||
      url.hasFragment) {
    throw ArgumentError('Invalid DJL_CLOUD_API_URL');
  }
  runApp(
    DjlApp(
      client: CloudClient(baseUrl: url, credentials: PlatformCredentialStore()),
      // DJL Cloud sign-in is off for now: the phone is a remote for the DJL
      // desktop. Build with --dart-define=DJL_CLOUD_ACCOUNTS=true to bring
      // back sign-in, sign-up and Cloud chat.
      cloudAccounts: const bool.fromEnvironment('DJL_CLOUD_ACCOUNTS'),
    ),
  );
}
