abstract interface class VoiceDriver {
  Future<bool> initialize();
  Future<void> listen({
    required void Function(String) onText,
    required void Function() onDone,
    required void Function(String) onError,
  });
  Future<void> stopListening();
  Future<void> cancelListening();
  Future<void> speak(String text);
  Future<void> stopSpeaking();
}
