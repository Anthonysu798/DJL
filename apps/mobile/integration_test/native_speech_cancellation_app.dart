// Native output cancellation only. No accounts, storage, network or dictation.
import 'dart:async';
import 'package:djl_mobile/features/voice/data/native_voice_driver.dart';
import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';

void main() => runApp(const MaterialApp(home: SpeechCancellationProbe()));

class SpeechCancellationProbe extends StatefulWidget {
  const SpeechCancellationProbe({super.key});

  @override
  State<SpeechCancellationProbe> createState() =>
      _SpeechCancellationProbeState();
}

class _SpeechCancellationProbeState extends State<SpeechCancellationProbe> {
  final tts = FlutterTts();
  late final driver = NativeVoiceDriver(tts: tts);
  String status = 'Ready';
  bool running = false;
  int cancellations = 0, completions = 0;
  bool progressed = false;

  Future<void> check() async {
    setState(() {
      running = true;
      cancellations = completions = 0;
      progressed = false;
      status = 'Waiting for native speech start';
    });
    final started = Completer<void>();
    final progress = Completer<void>();
    tts.setStartHandler(() {
      if (!started.isCompleted) started.complete();
    });
    tts.setProgressHandler((text, start, end, word) {
      if (start >= 20 && !progress.isCompleted) progress.complete();
    });
    tts.setCancelHandler(() => cancellations++);
    tts.setCompletionHandler(() => completions++);
    try {
      final speech = driver.speak(
        List.filled(60, 'DJL local cancellation check.').join(' '),
      );
      final outcome = speech.then((_) => true);
      await started.future.timeout(const Duration(seconds: 15));
      await progress.future.timeout(const Duration(seconds: 15));
      progressed = true;
      await driver.stopSpeaking();
      final settled = await outcome.timeout(
        const Duration(seconds: 2),
        onTimeout: () => false,
      );
      if (mounted) {
        setState(() {
          status = settled
              ? 'Cancelled speech settled'
              : 'Cancelled speech is still pending';
        });
      }
    } catch (error) {
      await driver.stopSpeaking();
      if (mounted) setState(() => status = 'Cancellation check failed: $error');
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
    appBar: AppBar(title: const Text('DJL cancellation QA')),
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(status),
          Text('Progressed: $progressed'),
          Text('Cancel callbacks: $cancellations'),
          Text('Completion callbacks: $completions'),
          ElevatedButton(
            onPressed: running ? null : check,
            child: const Text('Run native cancellation check'),
          ),
        ],
      ),
    ),
  );
}
