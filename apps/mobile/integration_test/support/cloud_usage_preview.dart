// Native presentation qualification only. Every HTTP/storage/voice dependency
// is volatile; the production controller, Page and reset flow remain unchanged.
import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import '../../test/fixtures/cloud_usage_fixture.dart';
import '../../test/features/voice_controller_test.dart' show TestVoice;

CloudUsageFixture? lastUsageFixture;
void main() => runApp(const _UsagePreview());

class _UsagePreview extends StatefulWidget {
  const _UsagePreview();
  @override
  State<_UsagePreview> createState() => _UsagePreviewState();
}

class _UsagePreviewState extends State<_UsagePreview> {
  CloudUsageFixture? _fixture;
  bool _dark = false;
  @override
  Widget build(BuildContext context) {
    if (_fixture case final fixture?) {
      return MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: djlTheme(Brightness.light),
        darkTheme: djlTheme(Brightness.dark),
        themeMode: _dark ? ThemeMode.dark : ThemeMode.light,
        home: _UsagePreviewPage(fixture: fixture),
      );
    }
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: SafeArea(
          child: Column(
            children: [
              for (final dark in [false, true])
                for (final blocked in [false, true])
                  TextButton(
                    onPressed: () {
                      final fixture = CloudUsageFixture(
                        restoredBlocked: blocked,
                      );
                      lastUsageFixture = fixture;
                      setState(() {
                        _dark = dark;
                        _fixture = fixture;
                      });
                    },
                    child: Text(
                      '${dark ? 'Dark' : 'Light'} ${blocked ? 'blocked run' : 'pending send'} fixture',
                    ),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

class _UsagePreviewPage extends StatefulWidget {
  const _UsagePreviewPage({required this.fixture});
  final CloudUsageFixture fixture;
  @override
  State<_UsagePreviewPage> createState() => _UsagePreviewPageState();
}

class _UsagePreviewPageState extends State<_UsagePreviewPage> {
  bool _armed = false;
  @override
  void initState() {
    super.initState();
    widget.fixture.chat.addListener(_changed);
  }

  void _changed() {
    final f = widget.fixture, chat = f.chat;
    if (!_armed &&
        !f.restoredBlocked &&
        chat.composerReady &&
        chat.model != null &&
        !chat.loading) {
      _armed = true;
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        if (!mounted) return;
        chat.updateComposerDraft('Usage QA pending prompt');
        await chat.send('Usage QA pending prompt');
      });
    }
    if (mounted && chat.reducer?.status == 'succeeded') {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() {});
      });
    }
  }

  @override
  void dispose() {
    widget.fixture.chat.removeListener(_changed);
    widget.fixture.client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.fixture;
    return Stack(
      children: [
        ChatPage(controller: f.chat, voiceDriver: TestVoice()),
        if (f.chat.reducer?.status == 'succeeded')
          Positioned(
            top: MediaQuery.viewPaddingOf(context).top + 50,
            left: 12,
            right: 12,
            child: IgnorePointer(
              child: Material(
                color: Theme.of(context).colorScheme.surface,
                child: Text(
                  'Memory resets: ${f.redemptions.length}; message attempts: ${f.messages.length}',
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          ),
      ],
    );
  }
}
