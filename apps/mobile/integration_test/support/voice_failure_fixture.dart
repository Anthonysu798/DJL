// Non-recording delayed-failure adapter shared by host and native QA only.
import 'dart:async';
import 'package:djl_mobile/features/voice/data/voice_driver.dart';

class DelayedFailureVoice implements VoiceDriver {
  DelayedFailureVoice({required this.failInitialization});
  final bool failInitialization;
  final oldInitialization = Completer<bool>();
  final oldListen = Completer<void>();
  int initializations = 0, starts = 0;
  void Function(String)? transcript;

  void failOldRequest() {
    if (failInitialization) {
      oldInitialization.completeError(StateError('Public QA old permission'));
    } else {
      oldListen.completeError(StateError('Public QA old listen'));
    }
  }

  @override
  Future<bool> initialize() {
    initializations++;
    return failInitialization && initializations == 1
        ? oldInitialization.future
        : Future.value(true);
  }

  @override
  Future<void> listen({
    required void Function(String) onText,
    required void Function() onDone,
    required void Function(String) onError,
  }) {
    starts++;
    transcript = onText;
    return !failInitialization && starts == 1
        ? oldListen.future
        : Future.value();
  }

  @override
  Future<void> cancelListening() async {}
  @override
  Future<void> stopListening() async {}
  @override
  Future<void> stopSpeaking() async {}
  @override
  Future<void> speak(String text) => throw StateError('No audio in QA adapter');
}
