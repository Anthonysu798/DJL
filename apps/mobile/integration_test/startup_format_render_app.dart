import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/settings/data/settings_store.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';

// Render the real startup failure for existing local QA relay records.
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final credentials = PlatformCredentialStore();
  final settings = SettingsController(SharedSettingsStore());
  final host = defaultTargetPlatform == TargetPlatform.android
      ? '10.0.2.2'
      : '127.0.0.1';
  runApp(
    DjlApp(
      client: CloudClient(
        baseUrl: Uri.parse('http://$host:8859'),
        credentials: credentials,
      ),
      settings: settings,
      desktop: DesktopController(
        PairingRepository(credentials),
        settings: settings,
      ),
    ),
  );
}
