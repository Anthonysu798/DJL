// Public memory-only native diagnostic for the real conversation page.
import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/core/design/djl_icons.dart';
import '../test/features/desktop_reasoning_controller_test.dart'
    show ReasoningTransport, ReasoningPairings;
import '../test/features/desktop_activity_test.dart' show ActivityCacheStore;

Future<DesktopController> publicCopyConversation() async {
  final transport = ReasoningTransport()
    ..history = {
      'id': 'thread',
      'turns': [
        for (var i = 0; i < 6; i++)
          {
            'id': 'turn-$i',
            'status': 'completed',
            'items': [
              {
                'id': 'user-$i',
                'type': 'userMessage',
                'text': 'Public memory-only question $i',
              },
              {
                'id': 'answer-$i',
                'type': 'agentMessage',
                'text': i == 5
                    ? 'Known public response134 🧑‍💻'
                    : 'Earlier public response $i.\n\n'
                          'Keep history and native keyboard layout intact.\n\n'
                          'No account, network or remote command is involved.',
              },
            ],
          },
      ],
    };
  final desktop = DesktopController(
    transport.pairings,
    connection: transport,
    localStore: ActivityCacheStore(),
  );
  await desktop.connect((transport.pairings as ReasoningPairings).pair);
  if (desktop.error != null) throw StateError(desktop.error!);
  await desktop.openThread({'id': 'thread'}, readOnlyNavigation: true);
  if (desktop.error != null) throw StateError(desktop.error!);
  desktop.thread = {...desktop.thread!, 'name': 'Public conversation QA134'};
  desktop.models = [
    {'id': 'qa', 'model': 'qa-model', 'displayName': 'Public memory runtime'},
  ];
  desktop.model = 'qa';
  desktop.effort = 'medium';
  return desktop;
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const PublicCopyConversationRender());
}

class PublicCopyConversationRender extends StatefulWidget {
  const PublicCopyConversationRender({super.key});

  @override
  State<PublicCopyConversationRender> createState() =>
      _PublicCopyConversationRenderState();
}

class _PublicCopyConversationRenderState
    extends State<PublicCopyConversationRender> {
  late final _scene = publicCopyConversation();
  DesktopController? _desktop;
  int _refresh = 0;

  @override
  void dispose() {
    _desktop?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: djlTheme(Brightness.light),
    home: Scaffold(
      appBar: AppBar(
        title: Text('Public view $_refresh'),
        actions: [
          IconButton(
            tooltip: 'Refresh public view',
            onPressed: () => setState(() => _refresh++),
            icon: const Icon(DjlIcons.refresh),
          ),
          IconButton(
            tooltip: 'Dismiss public keyboard',
            onPressed: () => FocusManager.instance.primaryFocus?.unfocus(),
            icon: const Icon(Icons.keyboard_hide),
          ),
        ],
      ),
      body: FutureBuilder<DesktopController>(
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
          return DesktopChatPage(controller: desktop);
        },
      ),
    ),
  );
}
