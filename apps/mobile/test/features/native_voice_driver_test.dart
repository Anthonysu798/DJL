import 'package:djl_mobile/features/voice/data/native_voice_driver.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_tts/flutter_tts.dart';

class RecordingTts extends FlutterTts {
  final calls = <Object>[];

  @override
  Future<dynamic> setIosAudioCategory(
    IosTextToSpeechAudioCategory category,
    List<IosTextToSpeechAudioCategoryOptions> options, [
    IosTextToSpeechAudioMode mode = IosTextToSpeechAudioMode.defaultMode,
  ]) async {
    calls.add([category, options, mode]);
    return 1;
  }

  @override
  Future<dynamic> awaitSpeakCompletion(bool value) async {
    calls.add(value);
    return 1;
  }

  @override
  Future<dynamic> speak(String text, {bool focus = false}) async {
    calls.add(text);
    return 1;
  }

  @override
  Future<dynamic> stop() async {
    calls.add('stop');
    return 1;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'read aloud configures spoken playback before starting speech',
    () async {
      final tts = RecordingTts();
      final driver = NativeVoiceDriver(tts: tts);

      await driver.speak('A local reply.');
      await driver.stopSpeaking();
      await driver.speak('Another reply.');

      final session = [
        IosTextToSpeechAudioCategory.playback,
        [IosTextToSpeechAudioCategoryOptions.duckOthers],
        IosTextToSpeechAudioMode.spokenAudio,
      ];
      expect(tts.calls, [
        session,
        true,
        'A local reply.',
        'stop',
        session,
        true,
        'Another reply.',
      ]);
    },
  );
}
