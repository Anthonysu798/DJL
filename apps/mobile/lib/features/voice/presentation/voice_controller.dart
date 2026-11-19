import 'dart:async';
import 'package:flutter/foundation.dart';
import '../data/voice_driver.dart';

String appendTranscript(String draft, String transcript) {
  final value = transcript.trim();
  if (value.isEmpty) return draft;
  return draft +
      (draft.isEmpty || RegExp(r'\s$').hasMatch(draft) ? '' : ' ') +
      value;
}

class VoiceController extends ChangeNotifier {
  VoiceController(this.driver, {required this.onDraft});
  final VoiceDriver driver;
  final ValueChanged<String> onDraft;
  bool listening = false,
      initializing = false,
      _disposed = false,
      _foreground = true;
  Completer<void>? _resumeGate;
  String? error, speakingMessageId;
  String? _expectedReply;
  int _dictationGeneration = 0, _speechGeneration = 0;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void setForeground(bool value) {
    if (_disposed) return;
    _foreground = value;
    if (value) _releaseResumeGate();
  }

  void _releaseResumeGate() {
    final gate = _resumeGate;
    _resumeGate = null;
    gate?.complete();
  }

  Future<void> start(String draft) async {
    if (_disposed || initializing || listening || !_foreground) return;
    final generation = ++_dictationGeneration;
    initializing = true;
    error = null;
    _notify();
    try {
      final ready = await driver.initialize();
      if (_disposed || generation != _dictationGeneration) return;
      if (!ready) {
        error =
            'Allow microphone and speech access in device settings. On-device speech must be available for your language.';
        return;
      }
      if (!_foreground) {
        await (_resumeGate ??= Completer<void>()).future;
        if (_disposed || generation != _dictationGeneration || !_foreground) {
          return;
        }
      }
      listening = true;
      await driver.listen(
        onText: (text) {
          if (!_disposed && generation == _dictationGeneration) {
            onDraft(appendTranscript(draft, text));
          }
        },
        onDone: () {
          if (generation == _dictationGeneration) {
            listening = false;
            _notify();
          }
        },
        onError: (message) {
          if (generation == _dictationGeneration) {
            error = message;
            listening = false;
            _notify();
          }
        },
      );
    } catch (_) {
      if (generation == _dictationGeneration) {
        error = 'Voice input is unavailable. You can still type your message.';
        listening = false;
      }
    } finally {
      if (generation == _dictationGeneration) {
        initializing = false;
        _notify();
      }
    }
  }

  Future<void> stop() async {
    try {
      await driver.stopListening();
    } catch (_) {
      error = 'Could not stop voice input.';
    }
    listening = false;
    _notify();
  }

  Future<void> read(String messageId, String text) async {
    if (_disposed || !_foreground) return;
    final previous = speakingMessageId, generation = ++_speechGeneration;
    await driver.stopSpeaking();
    if (_disposed || generation != _speechGeneration) return;
    if (previous == messageId) {
      speakingMessageId = null;
      _notify();
      return;
    }
    speakingMessageId = messageId;
    error = null;
    _notify();
    try {
      await driver.speak(text);
    } catch (_) {
      if (generation == _speechGeneration) {
        error = 'Speech playback is unavailable on this device.';
      }
    } finally {
      if (generation == _speechGeneration) {
        speakingMessageId = null;
        _notify();
      }
    }
  }

  void expectReply(String runId) {
    if (!_disposed) _expectedReply = runId;
  }

  Future<void> readReply({
    required String runId,
    required bool succeeded,
    required String messageId,
    required String text,
  }) async {
    if (_disposed || !succeeded || _expectedReply != runId) return;
    _expectedReply = null;
    if (text.trim().isNotEmpty) await read(messageId, text);
  }

  Future<void> suspend({bool preservePermissionRequest = false}) async {
    final pendingPermission =
        preservePermissionRequest && initializing && !listening;
    _expectedReply = null;
    if (!pendingPermission) {
      _dictationGeneration++;
      initializing = false;
      listening = false;
      _releaseResumeGate();
    }
    _speechGeneration++;
    speakingMessageId = null;
    _notify();
    try {
      await Future.wait([
        if (!pendingPermission) driver.cancelListening(),
        driver.stopSpeaking(),
      ]);
    } catch (_) {
      if (!_disposed) {
        error =
            'Voice could not stop cleanly. Close this screen before continuing.';
        _notify();
      }
    }
  }

  Future<void> _shutdown() async {
    try {
      await Future.wait([driver.cancelListening(), driver.stopSpeaking()]);
    } catch (_) {}
  }

  @override
  void dispose() {
    _disposed = true;
    _dictationGeneration++;
    _speechGeneration++;
    _releaseResumeGate();
    unawaited(_shutdown());
    super.dispose();
  }
}
