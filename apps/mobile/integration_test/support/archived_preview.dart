// Disposable native presentation: no network, secure storage or permission requests.
import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/settings/presentation/local_settings_page.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import '../../test/features/settings/archived_chats_page_test.dart'
    show ArchiveTransport;
import '../../test/features/settings/settings_controller_test.dart'
    show MemorySettingsStore;
import '../../test/features/desktop_activity_test.dart' show ActivityCacheStore;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const _ArchivedPreview());
}

class _ArchivedPreview extends StatefulWidget {
  const _ArchivedPreview();
  @override
  State<_ArchivedPreview> createState() => _ArchivedPreviewState();
}

class _ArchivedPreviewState extends State<_ArchivedPreview> {
  final _settings = SettingsController(MemorySettingsStore());
  final _transport = ArchiveTransport(), _cache = ActivityCacheStore();
  late final _desktop = DesktopController(
    _transport.pairings,
    connection: _transport,
    localStore: _cache,
    settings: _settings,
  );
  bool _open = false, _loading = false;

  Future<void> _enter(bool populated) async {
    if (_loading) return;
    setState(() => _loading = true);
    await _settings.load();
    if (populated) {
      final now = DateTime.now().millisecondsSinceEpoch;
      await _cache.save('mac-a', {
        'threads': [
          {
            'id': 'earlier',
            'name': 'Earlier archived chat',
            'archived': true,
            'updatedAt': now - 86400000,
          },
          {
            'id': 'newest',
            'name': 'Newest archived chat',
            'archived': true,
            'updatedAt': now - 3600000,
          },
          {
            'id': 'child',
            'parentThreadId': 'newest',
            'name': 'Child archived chat',
            'archived': true,
            'updatedAt': now - 7200000,
          },
        ],
      });
    }
    await _desktop.threadList.attach('mac-a');
    if (mounted) {
      setState(() {
        _open = true;
        _loading = false;
      });
    }
  }

  @override
  void dispose() {
    _desktop.dispose();
    _settings.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _settings,
    builder: (context, _) => MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: djlTheme(Brightness.light, font: _settings.font),
      darkTheme: djlTheme(Brightness.dark, font: _settings.font),
      themeMode: _settings.theme,
      home: _open
          ? LocalSettingsPage(
              controller: _settings,
              desktop: _desktop,
              signedIn: false,
              onCloud: () {},
              onMyMacs: () {},
              taskStatus: const Text(
                'Task status is unavailable in this memory-only fixture.',
              ),
            )
          : Scaffold(
              body: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    FilledButton(
                      onPressed: _loading ? null : () => _enter(true),
                      child: const Text('Open archived fixture'),
                    ),
                    TextButton(
                      onPressed: _loading ? null : () => _enter(false),
                      child: const Text('Open empty archived fixture'),
                    ),
                  ],
                ),
              ),
            ),
    ),
  );
}
