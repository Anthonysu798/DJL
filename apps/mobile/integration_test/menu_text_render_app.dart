// Public memory-only native menu text-size comparison;no real stores/services.
import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_navigation_menu.dart';
import '../test/features/desktop_reasoning_controller_test.dart'
    show ReasoningTransport, ReasoningPairings;
import '../test/features/desktop_activity_test.dart' show ActivityCacheStore;

Future<DesktopController> publicTextMenu() async {
  final transport = ReasoningTransport()..online = true;
  final pair = (transport.pairings as ReasoningPairings).pair;
  final desktop =
      DesktopController(
          transport.pairings,
          connection: transport,
          localStore: ActivityCacheStore(),
        )
        ..active = pair
        ..trusted = [pair]
        ..state = 'connected';
  await desktop.threadList.attach(pair.macDeviceId);
  for (var i = 1; i <= 6; i++) {
    desktop.threadList.data.upsert({
      'id': 'text137-$i',
      'title': 'Public context row $i',
      'updatedAt': 1800000000 - i * 60,
    });
  }
  return desktop;
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MenuTextRender());
}

class MenuTextRender extends StatefulWidget {
  const MenuTextRender({super.key});

  @override
  State<MenuTextRender> createState() => _MenuTextRenderState();
}

class _MenuTextRenderState extends State<MenuTextRender> {
  late final _scene = publicTextMenu();
  DesktopController? _desktop;
  bool _maximum = false;

  @override
  void dispose() {
    _desktop?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: djlTheme(Brightness.light),
    home: FutureBuilder<DesktopController>(
      future: _scene,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Center(
            child: Text('Public fixture failed: ${snapshot.error}'),
          );
        }
        final desktop = snapshot.data;
        if (desktop == null) {
          return const Center(child: CircularProgressIndicator());
        }
        _desktop = desktop;
        return Scaffold(
          body: LayoutBuilder(
            builder: (context, constraints) => Row(
              children: [
                SizedBox(
                  width: constraints.maxWidth * .7,
                  child: MediaQuery(
                    data: MediaQuery.of(context).copyWith(
                      textScaler: TextScaler.linear(_maximum ? 53 / 17 : 1),
                    ),
                    child: DesktopNavigationMenu(
                      controller: desktop,
                      selectedThreadId: 'text137-1',
                      onThread: (_) {},
                      onNewChat: () {},
                      onRemote: () {},
                      isCurrent: () => true,
                    ),
                  ),
                ),
                Expanded(
                  child: Column(
                    children: [
                      const SizedBox(height: 80),
                      TextButton(
                        onPressed: () => setState(() => _maximum = false),
                        child: const Text('Default text'),
                      ),
                      TextButton(
                        onPressed: () => setState(() => _maximum = true),
                        child: const Text('Maximum text'),
                      ),
                      Text('Body ${_maximum ? 53 : 17}'),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    ),
  );
}
