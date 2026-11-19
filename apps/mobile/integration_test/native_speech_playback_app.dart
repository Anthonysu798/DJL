// Native speech-output probe only. No app state, network, dictation or credentials.
import 'package:djl_mobile/features/voice/data/native_voice_driver.dart';
import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';

void main() => runApp(const MaterialApp(home: SpeechPlaybackProbe()));

class SpeechPlaybackProbe extends StatefulWidget {
  const SpeechPlaybackProbe({super.key});

  @override
  State<SpeechPlaybackProbe> createState() => _SpeechPlaybackProbeState();
}

class _SpeechPlaybackProbeState extends State<SpeechPlaybackProbe> {
  late final FlutterTts tts;
  late final NativeVoiceDriver driver;
  String status = 'Ready';
  bool started = false, completed = false, running = false;

  @override
  void initState() {
    super.initState();
    tts = FlutterTts();
    driver = NativeVoiceDriver(tts: tts);
    tts.setStartHandler(() => started = true);
    tts.setCompletionHandler(() => completed = true);
  }

  Future<void> read() async {
    setState(() {
      running = true;
      started = completed = false;
      status = 'Speaking';
    });
    try {
      await driver.speak('DJL local speech playback check.');
      // Native completion and its Dart result can arrive in either order.
      await Future<void>.delayed(const Duration(milliseconds: 100));
      if (mounted) {
        setState(() {
          status = started && completed
              ? 'Native speech started and completed'
              : 'Missing native speech callback';
        });
      }
    } catch (error) {
      if (mounted) setState(() => status = 'Speech failed: $error');
    } finally {
      if (mounted) setState(() => running = false);
    }
  }

  @override
  void dispose() {
    driver.stopSpeaking();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('DJL speech output QA')),
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(status),
          ElevatedButton(
            onPressed: running ? null : read,
            child: const Text('Read local QA sentence'),
          ),
        ],
      ),
    ),
  );
}
