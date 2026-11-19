// Interactive native rendering fixture. Never used by the ordinary app entrypoint.
import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import '../../test/features/desktop_plan_widgets_test.dart'
    show PlanActionTransport;
import '../../test/features/desktop_history_reconciliation_test.dart'
    show historyPage, historyUser, historyAnswer;
import '../../test/features/desktop_reasoning_controller_test.dart'
    show ReasoningPairings;
import '../../test/features/desktop_activity_test.dart' show ActivityCacheStore;

Future<DesktopController> _scene(bool result, {bool legacy = false}) async {
  final transport = PlanActionTransport();
  final rows = [
    historyUser(
      'preview-user',
      'preview-turn',
      'Keep the plan discoverable while preserving the conversation.',
    ),
    if (legacy)
      historyAnswer(
        'preview-legacy',
        'preview-turn',
        '''A few quick questions before I finalize the plan:

1. Which rollout path should we take?
- Ship it now
- Stage it behind a flag

2. Choose two checks to run?
- iOS Simulator
- Pixel 9
- Encrypted gateway

Once you answer, I will finalize the plan.''',
      )
    else if (result)
      {
        'id': 'preview-result',
        'type': 'plan',
        'turnId': 'preview-turn',
        'text':
            '# Focused implementation\n\n- Preserve paired sessions.\n- Keep draft text intact.\n- Render the compact plan capsule.\n- Keep the detail sheet scrollable.\n- Verify both mobile platforms.\n- Retain the original workspace files.',
      }
    else
      historyAnswer(
        'preview-assistant',
        'preview-turn',
        'I’ll keep the focused work visible while the task plan updates.',
      ),
  ];
  transport.history = historyPage(rows, running: !result && !legacy);
  final desktop = DesktopController(
    transport.pairings,
    connection: transport,
    localStore: ActivityCacheStore(),
  );
  await desktop.connect((transport.pairings as ReasoningPairings).pair);
  if (desktop.error != null) throw StateError(desktop.error!);
  await desktop.openThread({
    'id': 'thread',
    'cwd': '/qa',
  }, readOnlyNavigation: true);
  if (desktop.error != null) throw StateError(desktop.error!);
  desktop.thread = {...desktop.thread!, 'name': 'Plan render QA79'};
  desktop.models = [
    {'id': 'qa', 'model': 'qa-model', 'displayName': 'Local test runtime'},
  ];
  desktop.model = 'qa';
  desktop.effort = 'medium';
  if (legacy) {
    desktop.threadList.data.planSessions['thread'] = {
      'identityPin': desktop.active!.data['macIdentityPublicKey'],
      'source': 'compatibilityFallback',
    };
  } else if (!result) {
    transport.events.add({
      'method': 'item/started',
      'params': {
        'threadId': 'thread',
        'turnId': 'preview-turn',
        'item': {
          'id': 'todo-list-preview',
          'type': 'todoList',
          'text':
              'Preparing the rollout in small, safe steps so the response stays visible while work is happening.',
          'explanation':
              'The assistant is organizing the work before execution.',
          'plan': [
            {
              'step':
                  'Inspect the current conversation layout and top overlay behavior',
              'status': 'completed',
            },
            {
              'step':
                  'Move the active plan out of the timeline overlay and into a compact accessory',
              'status': 'in_progress',
            },
            {
              'step':
                  'Open the full task list in a sheet when the compact row is tapped',
              'status': 'pending',
            },
          ],
        },
      },
    });
  }
  return desktop;
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(_PreviewBootstrap());
}

class _PreviewBootstrap extends StatefulWidget {
  @override
  State<_PreviewBootstrap> createState() => _PreviewBootstrapState();
}

class _PreviewBootstrapState extends State<_PreviewBootstrap> {
  Future<DesktopController>? _loading;

  @override
  Widget build(BuildContext context) => FutureBuilder<DesktopController>(
    future: _loading,
    builder: (context, snapshot) {
      if (snapshot.hasData) return _PlanPreview(initial: snapshot.data!);
      return MaterialApp(
        home: Scaffold(
          body: SafeArea(
            child: Center(
              child: _loading == null
                  ? FilledButton(
                      onPressed: () => setState(() {
                        _loading = _scene(false);
                      }),
                      child: const Text('Open plan fixture'),
                    )
                  : Text(
                      snapshot.hasError
                          ? 'Render fixture setup failed: ${snapshot.error}'
                          : 'Loading render fixture...',
                    ),
            ),
          ),
        ),
      );
    },
  );
}

class _PlanPreview extends StatefulWidget {
  const _PlanPreview({required this.initial});
  final DesktopController initial;
  @override
  State<_PlanPreview> createState() => _PlanPreviewState();
}

class _PlanPreviewState extends State<_PlanPreview> {
  late DesktopController _desktop = widget.initial;
  ThemeMode _theme = ThemeMode.system;
  int _revision = 0;
  bool _loading = false;
  Future<void> _select(bool result, {bool legacy = false}) async {
    if (_loading) return;
    setState(() => _loading = true);
    final next = await _scene(result, legacy: legacy);
    if (!mounted) {
      next.dispose();
      return;
    }
    final previous = _desktop;
    setState(() {
      _desktop = next;
      _revision++;
      _loading = false;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => previous.dispose());
  }

  @override
  void dispose() {
    _desktop.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'DJL Plan Render QA79',
    builder: (context, child) =>
        ColoredBox(color: Theme.of(context).colorScheme.surface, child: child!),
    debugShowCheckedModeBanner: false,
    theme: djlTheme(Brightness.light),
    darkTheme: djlTheme(Brightness.dark),
    themeMode: _theme,
    home: Column(
      children: [
        SafeArea(
          bottom: false,
          child: Material(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 10),
                    child: Text('Render fixture'),
                  ),
                  TextButton(
                    onPressed: _loading ? null : () => _select(false),
                    child: const Text('Progress'),
                  ),
                  TextButton(
                    onPressed: _loading ? null : () => _select(true),
                    child: const Text('Result'),
                  ),
                  TextButton(
                    onPressed: _loading
                        ? null
                        : () => _select(false, legacy: true),
                    child: const Text('Legacy questions'),
                  ),
                  IconButton(
                    tooltip: 'Toggle preview theme',
                    onPressed: () => setState(
                      () => _theme = _theme == ThemeMode.dark
                          ? ThemeMode.light
                          : ThemeMode.dark,
                    ),
                    icon: const Icon(Icons.brightness_6_outlined),
                  ),
                ],
              ),
            ),
          ),
        ),
        Expanded(
          child: DesktopChatPage(
            key: ValueKey(_revision),
            controller: _desktop,
          ),
        ),
      ],
    ),
  );
}
