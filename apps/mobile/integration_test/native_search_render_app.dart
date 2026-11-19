// Actual phone menu and platform search;all rows and stores are public/memory-only.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/platform/native_text_search.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_navigation_menu.dart';
import '../test/features/desktop_reasoning_controller_test.dart'
    show ReasoningTransport, ReasoningPairings;
import '../test/features/desktop_activity_test.dart' show ActivityCacheStore;
import 'support/native_search_cases.dart';

Future<DesktopController> publicSearchMenu() async {
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
  final titles = [
    'Straße',
    'ΟΣ',
    'Café',
    'Cafe\u0301',
    'İstanbul',
    'plain ASCII',
  ];
  for (var i = 0; i < titles.length; i++) {
    desktop.threadList.data.upsert({
      'id': 'search138-$i',
      'title': titles[i],
      'updatedAt': 1800000000 - i,
    });
  }
  return desktop;
}

Future<String> verifyNativeSearch() async {
  final failed = <int>[];
  for (final (index, value) in nativeSearchCases.indexed) {
    final actual = await nativeSearchMatches([value.title], value.query);
    final passes = value.matches
        ? actual.length == 1 && actual.single == 0
        : actual.isEmpty;
    if (!passes) failed.add(index);
  }
  return 'Native search ${nativeSearchCases.length - failed.length}/${nativeSearchCases.length}'
      '${failed.isEmpty ? '' : ': ${failed.join(',')}'}';
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const NativeSearchRender());
}

class NativeSearchRender extends StatefulWidget {
  const NativeSearchRender({super.key});
  @override
  State<NativeSearchRender> createState() => _NativeSearchRenderState();
}

class _NativeSearchRenderState extends State<NativeSearchRender> {
  late final _scene = publicSearchMenu();
  late final _verification = verifyNativeSearch();
  DesktopController? _desktop;
  String _clipboard = 'Public search only';
  @override
  void dispose() {
    _desktop?.dispose();
    super.dispose();
  }

  Widget copyQuery(String label, String value) => TextButton(
    onPressed: () async {
      await Clipboard.setData(ClipboardData(text: value));
      if (mounted) setState(() => _clipboard = '$label copied');
    },
    child: Text('Copy $label query'),
  );

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: djlTheme(Brightness.light),
    home: FutureBuilder<DesktopController>(
      future: _scene,
      builder: (context, snapshot) {
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
                  child: DesktopNavigationMenu(
                    controller: desktop,
                    onThread: (_) {},
                    onNewChat: () {},
                    onRemote: () {},
                    isCurrent: () => true,
                  ),
                ),
                Expanded(
                  child: Column(
                    children: [
                      const SizedBox(height: 70),
                      FutureBuilder<String>(
                        future: _verification,
                        builder: (context, result) => Text(
                          result.hasError
                              ? 'Native search failed: ${result.error}'
                              : result.data ?? 'Checking native search',
                        ),
                      ),
                      copyQuery('German', 'strasse'),
                      copyQuery('Greek', 'ος'),
                      copyQuery('accent', 'Cafe\u0301'),
                      copyQuery('plain', 'Cafe'),
                      copyQuery('dotted-I', 'istanbul'),
                      Text(_clipboard),
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
