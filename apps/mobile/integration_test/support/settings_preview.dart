// Isolated native rendering entry: memory-only settings, credentials and desktop.
import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/settings/presentation/local_settings_page.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/status/data/status_surface.dart';
import 'package:djl_mobile/features/status/presentation/status_permission_controls.dart';
import '../../test/features/desktop_reasoning_controller_test.dart'
    show ReasoningTransport;
import '../../test/features/desktop_activity_test.dart' show ActivityCacheStore;
import '../../test/features/settings/settings_controller_test.dart'
    show MemorySettingsStore;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const _SettingsPreview());
}

class _SettingsPreview extends StatefulWidget {
  const _SettingsPreview();
  @override
  State<_SettingsPreview> createState() => _SettingsPreviewState();
}

class _SettingsPreviewState extends State<_SettingsPreview> {
  final _settings = SettingsController(MemorySettingsStore());
  late final _transport = ReasoningTransport();
  late final _desktop = DesktopController(
    _transport.pairings,
    connection: _transport,
    localStore: ActivityCacheStore(),
  );
  bool _open = false, _loading = false;

  Future<void> _enter() async {
    if (_loading) return;
    setState(() => _loading = true);
    await _settings.load();
    if (!mounted) return;
    setState(() {
      _open = true;
      _loading = false;
    });
  }

  @override
  void dispose() {
    _settings.dispose();
    _desktop.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _settings,
    builder: (context, _) => MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: djlTheme(
        Brightness.light,
        font: _settings.font,
        bubble: _settings.bubble,
        liquidGlass: _settings.liquidGlass,
      ),
      darkTheme: djlTheme(
        Brightness.dark,
        font: _settings.font,
        bubble: _settings.bubble,
        liquidGlass: _settings.liquidGlass,
      ),
      themeMode: _settings.theme,
      home: !_open
          ? Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: _loading ? null : _enter,
                  child: const Text('Open settings fixture'),
                ),
              ),
            )
          : LocalSettingsPage(
              controller: _settings,
              desktop: _desktop,
              signedIn: false,
              onCloud: () {},
              onMyMacs: () {},
              taskStatus: StatusPermissionControls(
                backend: const MethodChannelStatusSurface(),
                onRetry: () async {},
              ),
            ),
    ),
  );
}
