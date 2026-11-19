// Native rendering fixture only: in-memory credentials/transport, no service access.
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import '../../test/features/desktop_question_cancellation_test.dart'
    show QuestionCancelTransport, questionPrompt;
import '../../test/features/desktop_history_reconciliation_test.dart'
    show historyPage;
import '../../test/features/desktop_reasoning_controller_test.dart'
    show ReasoningPairings;
import '../../test/features/desktop_activity_test.dart' show ActivityCacheStore;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const _QuestionPreview());
}

class _QuestionPreview extends StatefulWidget {
  const _QuestionPreview();
  @override
  State<_QuestionPreview> createState() => _QuestionPreviewState();
}

class _QuestionPreviewState extends State<_QuestionPreview> {
  QuestionCancelTransport? _transport;
  DesktopController? _desktop;
  bool _loading = false;
  ThemeMode _theme = ThemeMode.light;
  int _revision = 0;

  Future<void> _reset() async {
    if (_loading) return;
    setState(() => _loading = true);
    final transport = QuestionCancelTransport();
    transport.history = historyPage([], running: true);
    final desktop = DesktopController(
      transport.pairings,
      connection: transport,
      localStore: ActivityCacheStore(),
    );
    await desktop.connect((transport.pairings as ReasoningPairings).pair);
    await desktop.openThread({
      'id': 'thread',
      'cwd': '/qa',
    }, readOnlyNavigation: true);
    if (desktop.error != null) throw StateError(desktop.error!);
    desktop.thread = {...desktop.thread!, 'name': 'Question composer QA80'};
    desktop.threadList.data.setComposerDraft(
      'thread',
      DesktopComposerDraft(text: 'Retained local QA draft'),
    );
    if (!mounted) {
      desktop.dispose();
      return;
    }
    final previous = _desktop;
    setState(() {
      _transport = transport;
      _desktop = desktop;
      _revision++;
      _loading = false;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => previous?.dispose());
  }

  @override
  void dispose() {
    _desktop?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: djlTheme(Brightness.light),
    darkTheme: djlTheme(Brightness.dark),
    themeMode: _theme,
    home: _desktop == null
        ? Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: _loading ? null : _reset,
                child: Text(
                  _loading ? 'Loading fixture...' : 'Open question fixture',
                ),
              ),
            ),
          )
        : Column(
            children: [
              SafeArea(
                bottom: false,
                child: Material(
                  child: Wrap(
                    children: [
                      TextButton(
                        onPressed: _loading ? null : _reset,
                        child: const Text('Reset fixture'),
                      ),
                      TextButton(
                        onPressed: () {
                          _transport!.interrupt = Completer();
                          questionPrompt(_transport!, _desktop!);
                        },
                        child: const Text('Ask question'),
                      ),
                      TextButton(
                        onPressed: () {
                          final gate = _transport!.interrupt;
                          if (gate != null && !gate.isCompleted) {
                            gate.complete({});
                          }
                        },
                        child: const Text('Release cancellation'),
                      ),
                      TextButton(
                        onPressed: () {
                          final gate = _transport!.interrupt;
                          if (gate != null && !gate.isCompleted) {
                            gate.completeError(
                              StateError('QA cancellation rejected'),
                            );
                          }
                        },
                        child: const Text('Reject cancellation'),
                      ),
                      TextButton(
                        onPressed: () => setState(
                          () => _theme = _theme == ThemeMode.light
                              ? ThemeMode.dark
                              : ThemeMode.light,
                        ),
                        child: const Text('Theme'),
                      ),
                    ],
                  ),
                ),
              ),
              Expanded(
                child: DesktopChatPage(
                  key: ValueKey(_revision),
                  controller: _desktop!,
                ),
              ),
            ],
          ),
  );
}
