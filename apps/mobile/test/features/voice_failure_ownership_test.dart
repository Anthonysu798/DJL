import 'package:djl_mobile/features/voice/presentation/voice_controller.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/support/voice_failure_fixture.dart';

void main() {
  for (final initialization in [true, false]) {
    test(
      'old ${initialization ? 'initialize' : 'listen'} failure preserves new capture',
      () async {
        final driver = DelayedFailureVoice(failInitialization: initialization);
        var draft = 'Current';
        final controller = VoiceController(
          driver,
          onDraft: (value) => draft = value,
        );
        addTearDown(controller.dispose);
        final old = controller.start('Old');
        await Future<void>.delayed(Duration.zero);
        await controller.suspend();
        await controller.start(draft);
        expect(controller.listening, isTrue);
        driver.failOldRequest();
        await old;
        expect(controller.listening, isTrue);
        expect(controller.initializing, isFalse);
        expect(controller.error, isNull);
        driver.transcript!('public new words');
        expect(draft, 'Current public new words');
        await controller.stop();
        expect(controller.listening, isFalse);
      },
    );
  }
  test(
    'current initialization failure still stops capture and reports typed fallback',
    () async {
      final driver = DelayedFailureVoice(failInitialization: true);
      final controller = VoiceController(driver, onDraft: (_) {});
      addTearDown(controller.dispose);
      final current = controller.start('Keep');
      driver.failOldRequest();
      await current;
      expect(controller.listening, isFalse);
      expect(controller.initializing, isFalse);
      expect(controller.error, contains('You can still type'));
    },
  );
}
