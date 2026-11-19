// Isolated UI fixture: all RPCs and preferences stay in memory.
import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/host/presentation/host_controller.dart';
import 'package:djl_mobile/features/settings/presentation/settings_bridge_card.dart';
import '../../test/features/host/host_controller_test.dart'
    show HostStore, HostTransport;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const _BridgePreview());
}

class _BridgePreview extends StatefulWidget {
  const _BridgePreview();
  @override
  State<_BridgePreview> createState() => _BridgePreviewState();
}

class _BridgePreviewState extends State<_BridgePreview> {
  final _transport = HostTransport();
  late final _host = HostController(_transport, store: HostStore());
  bool _open = false, _dark = false, _online = true;

  @override
  void dispose() {
    _host.dispose();
    super.dispose();
  }

  void _bind() => _host.bind(
    device: 'bridge-ui-fixture',
    session: _online ? 'memory-only' : null,
    connected: _online,
    trusted: true,
  );

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    themeAnimationDuration: Duration.zero,
    theme: djlTheme(_dark ? Brightness.dark : Brightness.light),
    home: Scaffold(
      backgroundColor: _dark ? Colors.black : const Color(0xfff2f2f7),
      appBar: _open
          ? AppBar(
              title: const Text('Bridge QA'),
              actions: [
                TextButton(
                  onPressed: () => setState(() => _dark = !_dark),
                  child: const Text('Fixture theme'),
                ),
                TextButton(
                  onPressed: () {
                    setState(() => _online = !_online);
                    _bind();
                  },
                  child: Text(_online ? 'Go offline' : 'Go online'),
                ),
              ],
            )
          : null,
      body: !_open
          ? Center(
              child: FilledButton(
                onPressed: () {
                  _transport.status['bridgeVersion'] = '1.9';
                  _transport.status['bridgeLatestVersion'] = '1.10';
                  _bind();
                  setState(() => _open = true);
                },
                child: const Text('Open bridge fixture'),
              ),
            )
          : SafeArea(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [SettingsBridgeCard(controller: _host)],
              ),
            ),
    ),
  );
}
