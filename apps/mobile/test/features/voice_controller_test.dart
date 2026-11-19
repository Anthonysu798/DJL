import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/voice/data/voice_driver.dart';
import 'package:djl_mobile/features/voice/presentation/voice_controller.dart';

class TestVoice implements VoiceDriver {
  bool allowed = true;
  int stops = 0, starts = 0;
  void Function(String)? result;
  void Function(String)? failure;
  final playback = Completer<void>();
  final spoken = <String>[];
  @override
  Future<bool> initialize() async => allowed;
  @override
  Future<void> listen({
    required void Function(String) onText,
    required void Function() onDone,
    required void Function(String) onError,
  }) async {
    starts++;
    result = onText;
    failure = onError;
  }

  @override
  Future<void> stopListening() async {
    stops++;
  }

  @override
  Future<void> cancelListening() async {
    stops++;
  }

  @override
  Future<void> speak(String text) {
    spoken.add(text);
    return playback.future;
  }

  @override
  Future<void> stopSpeaking() async {
    stops++;
  }
}

void main() {
  test(
    'automatic speech requires the expected successful new run and consumes it once',
    () async {
      final driver = TestVoice();
      final controller = VoiceController(driver, onDraft: (_) {});
      Future<void> reply(String run, {bool succeeded = true}) =>
          controller.readReply(
            runId: run,
            succeeded: succeeded,
            messageId: 'message-$run',
            text: 'Reply $run',
          );
      await reply('history');
      controller.expectReply('new');
      await reply('another-run');
      await reply('new', succeeded: false);
      expect(driver.spoken, isEmpty);
      final reading = reply('new');
      await Future<void>.delayed(Duration.zero);
      expect(driver.spoken, ['Reply new']);
      await reply('new');
      expect(driver.spoken, ['Reply new']);
      controller.expectReply('background');
      await controller.suspend();
      await reply('background');
      expect(driver.spoken, ['Reply new']);
      driver.playback.complete();
      await reading;
      controller.dispose();
      controller.expectReply('disposed');
      await reply('disposed');
      expect(driver.spoken, ['Reply new']);
    },
  );
  test(
    'partial dictation replaces only its transcript and never sends',
    () async {
      final driver = TestVoice();
      var draft = 'Hello';
      final controller = VoiceController(driver, onDraft: (v) => draft = v);
      await controller.start(draft);
      driver.result!('world');
      driver.result!('world again');
      expect(draft, 'Hello world again');
      await controller.suspend();
      driver.result!('late transcript');
      expect(draft, 'Hello world again');
      expect(controller.listening, isFalse);
      controller.dispose();
    },
  );
  test('permission rejection leaves editable input and clear error', () async {
    final driver = TestVoice()..allowed = false;
    final controller = VoiceController(driver, onDraft: (_) {});
    await controller.start('');
    expect(driver.starts, 0);
    expect(controller.error, isNotNull);
    expect(controller.listening, isFalse);
    controller.dispose();
  });
  test(
    'background stops speech and stale completion cannot revive playback',
    () async {
      final driver = TestVoice();
      final controller = VoiceController(driver, onDraft: (_) {});
      final reading = controller.read('m', 'A reply');
      await Future<void>.delayed(Duration.zero);
      expect(controller.speakingMessageId, 'm');
      await controller.suspend();
      driver.playback.complete();
      await reading;
      expect(controller.speakingMessageId, isNull);
      expect(driver.stops, greaterThan(0));
      controller.dispose();
    },
  );
}
