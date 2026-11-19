// Exercises the production controller with no microphone, network or storage.
import 'package:djl_mobile/features/voice/presentation/voice_controller.dart';
import 'package:flutter/material.dart';
import 'support/voice_failure_fixture.dart';

void main() => runApp(const MaterialApp(home: VoiceFailureProbe()));

class VoiceFailureProbe extends StatefulWidget {
  const VoiceFailureProbe({super.key});
  @override
  State<VoiceFailureProbe> createState() => _VoiceFailureProbeState();
}

class _VoiceFailureProbeState extends State<VoiceFailureProbe> {
  String status = 'Ready', draft = 'Current';
  bool busy = false;
  int passed = 0;
  Future<void> run(bool initialization) async {
    setState(() => busy = true);
    final driver = DelayedFailureVoice(failInitialization: initialization);
    final controller = VoiceController(
      driver,
      onDraft: (value) => draft = value,
    );
    try {
      draft = 'Current';
      final old = controller.start('Old');
      await Future<void>.delayed(Duration.zero);
      await controller.suspend();
      await controller.start(draft);
      if (!controller.listening) throw StateError('New capture did not start');
      driver.failOldRequest();
      await old;
      if (!controller.listening ||
          controller.initializing ||
          controller.error != null) {
        throw StateError('Old failure changed current capture');
      }
      driver.transcript!('public new words');
      if (draft != 'Current public new words') {
        throw StateError('Draft changed');
      }
      await controller.stop();
      if (controller.listening) throw StateError('Current stop failed');
      passed++;
      status =
          '${initialization ? 'Initialize' : 'Listen'} stale failure: PASS';
    } catch (error) {
      status = 'FAIL: $error';
    } finally {
      controller.dispose();
      setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Voice ownership QA')),
    body: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Non-recording QA adapter; no microphone'),
          const Text('Production controller; simulated suspension'),
          Text('Passed cases: $passed'),
          Text(status),
          Text(draft),
          TextButton(
            onPressed: busy ? null : () => run(true),
            child: const Text('Check old initialize failure'),
          ),
          TextButton(
            onPressed: busy ? null : () => run(false),
            child: const Text('Check old listen failure'),
          ),
        ],
      ),
    ),
  );
}
