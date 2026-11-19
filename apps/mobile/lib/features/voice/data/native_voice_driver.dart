import 'dart:io';
import 'package:flutter/services.dart';
import 'package:uuid/uuid.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'voice_driver.dart';

/// Dictation remains on device. Unsupported recognizers report an error rather than uploading audio.
class NativeVoiceDriver implements VoiceDriver {
  NativeVoiceDriver({FlutterTts? tts}) : _tts = tts;

  final _speech = SpeechToText();
  final _android = const MethodChannel('djl.mobile/voice');
  final _sessionId = const Uuid().v4();
  FlutterTts? _tts;
  void Function()? _done;
  void Function(String)? _error;
  @override
  Future<bool> initialize() async {
    if (Platform.isAndroid) {
      return await _android.invokeMethod<bool>('initialize') ?? false;
    }
    return _speech.initialize(
      onStatus: (status) {
        if (status == 'done') _done?.call();
      },
      onError: (error) => _error?.call(
        error.errorMsg.contains('permission')
            ? 'Allow microphone and speech access in device settings to dictate.'
            : 'On-device dictation is unavailable for this language or device. You can still type your message.',
      ),
    );
  }

  @override
  Future<void> listen({
    required void Function(String) onText,
    required void Function() onDone,
    required void Function(String) onError,
  }) async {
    _done = onDone;
    _error = onError;
    if (Platform.isAndroid) {
      _android.setMethodCallHandler((call) async {
        if (call.method != 'event') return;
        final event = Map<String, dynamic>.from(call.arguments as Map);
        if (event['sessionId'] != _sessionId) return;
        switch (event['type']) {
          case 'text':
            onText(event['text'] as String);
          case 'done':
            onDone();
          case 'error':
            onError(
              'On-device dictation is unavailable for this language or device. You can still type your message.',
            );
        }
      });
      await _android.invokeMethod<void>('listen', {'sessionId': _sessionId});
      return;
    }
    await _speech.listen(
      onResult: (result) => onText(result.recognizedWords),
      listenOptions: SpeechListenOptions(
        onDevice: true,
        partialResults: true,
        listenMode: ListenMode.dictation,
        cancelOnError: true,
      ),
    );
  }

  @override
  Future<void> stopListening() async {
    if (Platform.isAndroid) {
      await _android.invokeMethod<void>('stop', {'sessionId': _sessionId});
    } else {
      await _speech.stop();
    }
  }

  @override
  Future<void> cancelListening() async {
    if (Platform.isAndroid) {
      await _android.invokeMethod<void>('cancel', {'sessionId': _sessionId});
    } else {
      await _speech.cancel();
    }
  }

  @override
  Future<void> speak(String text) async {
    final tts = _tts ??= FlutterTts();
    if (Platform.isAndroid) {
      final voices = (await tts.getVoices as List).whereType<Map>();
      final language = Platform.localeName.split(RegExp('[_-]')).first;
      final local = voices
          .where(
            (v) =>
                v['network_required'] == '0' &&
                (v['locale'] as String).startsWith(language),
          )
          .firstOrNull;
      if (local == null) {
        throw StateError('An installed on-device voice is required.');
      }
      await tts.setVoice({
        'name': local['name'] as String,
        'locale': local['locale'] as String,
      });
    }
    await tts.setIosAudioCategory(IosTextToSpeechAudioCategory.playback, [
      IosTextToSpeechAudioCategoryOptions.duckOthers,
    ], IosTextToSpeechAudioMode.spokenAudio);
    await tts.awaitSpeakCompletion(true);
    await tts.speak(text);
  }

  @override
  Future<void> stopSpeaking() async {
    await _tts?.stop();
  }
}
