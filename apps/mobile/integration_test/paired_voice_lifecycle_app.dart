// Native production-page lifecycle probe with no recording or real storage/RPC.
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:flutter/material.dart';
import 'support/paired_voice_fixture.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final fixture = await pairedVoiceFixture();
  fixture.voice.releaseOnInactive = true;
  WidgetsBinding.instance.addObserver(fixture.voice);
  runApp(
    MaterialApp(
      theme: djlTheme(Brightness.light),
      home: PairedVoiceProbe(fixture: fixture),
    ),
  );
}

class PairedVoiceProbe extends StatefulWidget {
  const PairedVoiceProbe({super.key, required this.fixture});
  final PairedVoiceFixture fixture;
  @override
  State<PairedVoiceProbe> createState() => _PairedVoiceProbeState();
}

class _PairedVoiceProbeState extends State<PairedVoiceProbe> {
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(widget.fixture.voice);
    widget.fixture.desktop.dispose();
    widget.fixture.voice.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.fixture;
    return Stack(
      children: [
        DesktopChatPage(controller: f.desktop, voiceDriver: f.voice),
        Positioned(
          top: 120,
          left: 16,
          right: 16,
          child: Material(
            color: Theme.of(context).colorScheme.surfaceContainer,
            child: AnimatedBuilder(
              animation: f.voice,
              builder: (_, _) => Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('Non-recording QA adapter; no microphone'),
                  Text('QA initialization calls: ${f.voice.initializations}'),
                  Text('QA permission completions: ${f.voice.grants}'),
                  Text('QA listen calls: ${f.voice.starts}'),
                  Text('QA offscreen starts: ${f.voice.offscreenStarts}'),
                  TextButton(
                    onPressed: f.voice.starts > 0
                        ? () => f.voice.transcript?.call('public QA words')
                        : null,
                    child: const Text('Inject public QA transcript'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
