import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/settings/data/settings_store.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';

// Profile the real app against its existing local QA pairings.
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final credentials = PlatformCredentialStore();
  final settings = SettingsController(SharedSettingsStore());
  runApp(
    DjlApp(
      client: CloudClient(
        baseUrl: Uri.parse('https://10.0.2.2:8859'),
        credentials: credentials,
      ),
      settings: settings,
      desktop: DesktopController(
        PairingRepository(credentials, allowLocal: true),
        settings: settings,
      ),
    ),
  );
}
