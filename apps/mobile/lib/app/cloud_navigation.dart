import 'package:flutter/foundation.dart';
import '../features/chat/domain/cloud_models.dart';

enum CloudDestination { chat, images, notifications, settings }

class CloudChatLaunch {
  const CloudChatLaunch({this.image, this.createImage = false});
  final Json? image;
  final bool createImage;
}

/// Per-process Cloud presentation state. Secure drafts and model choices remain
/// owned by their existing stores; changing a destination never sends a message.
class CloudNavigationController extends ChangeNotifier {
  String? _owner, _conversation;
  CloudDestination _destination = CloudDestination.chat;
  int _presentation = 0;
  CloudChatLaunch _launch = const CloudChatLaunch();
  bool _disposed = false;
  String? get owner => _owner;
  String? get conversationId => _conversation;
  CloudDestination get destination => _destination;
  int get presentation => _presentation;
  String? get visibleConversationId =>
      _destination == CloudDestination.chat ? _conversation : null;

  bool bindOwner(String? value) {
    if (_disposed || value == _owner) return false;
    final hadOwner = _owner != null;
    _owner = value;
    _conversation = null;
    _launch = const CloudChatLaunch();
    _presentation++;
    // A Settings choice made while the first profile loads remains usable.
    if (value == null || hadOwner) _destination = CloudDestination.chat;
    notifyListeners();
    return true;
  }

  void show(CloudDestination value) {
    if (_disposed || value == _destination) return;
    _destination = value;
    notifyListeners();
  }

  bool open(String id, {Json? image}) {
    if (_disposed || _owner == null) return false;
    if (id != _conversation || image != null) _presentation++;
    _conversation = id;
    _destination = CloudDestination.chat;
    _launch = CloudChatLaunch(image: image == null ? null : Map.of(image));
    notifyListeners();
    return true;
  }

  void newChat({bool createImage = false}) {
    if (_disposed) return;
    _conversation = null;
    _destination = CloudDestination.chat;
    _presentation++;
    _launch = CloudChatLaunch(createImage: createImage);
    notifyListeners();
  }

  bool acknowledge(
    String id, {
    required String owner,
    required int presentation,
  }) {
    if (_disposed ||
        owner != _owner ||
        presentation != _presentation ||
        _destination != CloudDestination.chat) {
      return false;
    }
    if (_conversation != id) {
      _conversation = id;
      notifyListeners();
    }
    return true;
  }

  CloudChatLaunch takeLaunch({
    required String owner,
    required int presentation,
  }) {
    if (_disposed || owner != _owner || presentation != _presentation) {
      return const CloudChatLaunch();
    }
    final value = _launch;
    _launch = const CloudChatLaunch();
    return value;
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
