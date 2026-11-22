import 'dart:convert';
import 'dart:ui' as ui;
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:image_picker/image_picker.dart';
import 'package:mime/mime.dart';
import 'package:uuid/uuid.dart';
import '../domain/desktop_composer.dart';
import '../../../l10n/l10n.dart';

typedef DesktopComposerScope = ({String? mac, String? thread, String? cwd});

/// The desktop path deliberately does not change Cloud's AttachmentPicker behavior.
class DesktopComposerImagePicker {
  DesktopComposerImagePicker({ImagePicker? picker})
    : _picker = picker ?? ImagePicker();
  final ImagePicker _picker;
  Future<DesktopComposerImage?> pick({bool camera = false}) async {
    final result = await _picker.pickImage(
      source: camera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 60,
      requestFullMetadata: false,
    );
    if (result == null) return null;
    final bytes = await result.readAsBytes();
    if (bytes.isEmpty || bytes.length > desktopImageByteLimit * 3 ~/ 4) {
      throw FormatException(appStrings.desktopImageEmptyOrTooLarge);
    }
    final mime = lookupMimeType(result.name, headerBytes: bytes);
    if (mime == null || !mime.startsWith('image/')) {
      throw FormatException(appStrings.desktopImageUnsupported);
    }
    final codec = await ui.instantiateImageCodec(bytes);
    try {
      final frame = await codec.getNextFrame();
      try {
        if (frame.image.width > 1600 || frame.image.height > 1600) {
          throw FormatException(appStrings.desktopImageResizeFailed);
        }
      } finally {
        frame.image.dispose();
      }
    } finally {
      codec.dispose();
    }
    final url = 'data:$mime;base64,${base64Encode(bytes)}';
    if (utf8.encode(url).length > desktopImageByteLimit) {
      throw FormatException(appStrings.desktopImageTooLarge);
    }
    return DesktopComposerImage(
      id: const Uuid().v4(),
      name: result.name,
      dataUrl: url,
    );
  }
}

class DesktopComposerImageSlot {
  const DesktopComposerImageSlot(this.id, {this.image, this.error});
  final String id;
  final DesktopComposerImage? image;
  final String? error;
  bool get loading => image == null && error == null;
}

class DesktopComposerController extends ChangeNotifier {
  DesktopComposerController({DesktopComposerImagePicker? picker})
    : picker = picker ?? DesktopComposerImagePicker();
  final DesktopComposerImagePicker picker;
  DesktopComposerScope? scope;
  String? _draftId;
  String text = '';
  String? _contextCwd;
  String? get contextScopeError =>
      _contexts.isNotEmpty && _contextCwd != scope?.cwd
      ? appStrings.desktopContextFolderChanged
      : null;
  final _slots = <DesktopComposerImageSlot>[];
  final _contexts = <DesktopComposerContext>[];
  List<DesktopComposerImageSlot> get slots => List.unmodifiable(_slots);
  List<DesktopComposerContext> get contexts => List.unmodifiable(_contexts);
  bool _disposed = false;
  int _generation = 0;
  DesktopComposerDraft get draft => DesktopComposerDraft(
    text: text,
    cwd: _contexts.isEmpty ? null : _contextCwd,
    images: _slots
        .map((v) => v.image)
        .whereType<DesktopComposerImage>()
        .toList(),
    contexts: _contexts,
  );
  bool get canSend =>
      contextScopeError == null &&
      !draft.isEmpty &&
      _slots.every((v) => v.image != null);
  bool get canPick => _slots.length < 4;
  bool get canRestoreDraft =>
      !_disposed && text.trim().isEmpty && _slots.isEmpty && _contexts.isEmpty;

  bool restoreDraft(DesktopComposerDraft saved) {
    if (!canRestoreDraft) return false;
    _generation++;
    text = saved.text;
    _contextCwd = saved.contexts.isEmpty ? scope?.cwd : saved.cwd;
    _slots.addAll(
      saved.images.map(
        (image) => DesktopComposerImageSlot(image.id, image: image),
      ),
    );
    _contexts.addAll(saved.contexts);
    _notify();
    return true;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  // Creation promotes this same logical draft; pending phone picker jobs stay
  // with it. Ordinary navigation still uses bind() to invalidate those jobs.
  void adoptCreatedThread(DesktopComposerScope next) {
    final previous = scope;
    if (previous == null ||
        previous.thread != null ||
        next.thread == null ||
        previous.mac != next.mac) {
      return;
    }
    scope = next;
    _draftId = null;
    if (_contextCwd == previous.cwd) _contextCwd = next.cwd;
    _notify();
  }

  void bind(
    DesktopComposerScope next,
    DesktopComposerDraft saved, {
    String? draftId,
  }) {
    if (scope == next && _draftId == draftId) return;
    _draftId = draftId;
    _generation++;
    scope = next;
    text = saved.text;
    _contextCwd = saved.contexts.isEmpty ? next.cwd : saved.cwd;
    _slots
      ..clear()
      ..addAll(
        saved.images.map((v) => DesktopComposerImageSlot(v.id, image: v)),
      );
    _contexts
      ..clear()
      ..addAll(saved.contexts);
    _notify();
  }

  void setText(String value) {
    if (text == value) return;
    text = value;
    _notify();
  }

  void addContext(DesktopComposerContext value) {
    if (contextScopeError != null || _contexts.any((v) => v.key == value.key)) {
      return;
    }
    if (_contexts.isEmpty) _contextCwd = scope?.cwd;
    _contexts.add(value);
    _notify();
  }

  void removeContext(String key) {
    _contexts.removeWhere((v) => v.key == key);
    _notify();
  }

  void removeImage(String id) {
    _slots.removeWhere((v) => v.id == id);
    _notify();
  }

  void clearSent(DesktopComposerDraft sent) {
    final remaining = draft.without(sent);
    text = remaining.text;
    _slots.removeWhere(
      (v) =>
          v.image != null && !remaining.images.any((i) => i.id == v.image!.id),
    );
    _contexts
      ..clear()
      ..addAll(remaining.contexts);
    _notify();
  }

  Future<void> pickImage({bool camera = false}) async {
    if (_disposed || !canPick) return;
    final generation = _generation, id = const Uuid().v4();
    _slots.add(DesktopComposerImageSlot(id));
    _notify();
    try {
      final image = await picker.pick(camera: camera);
      if (_disposed || generation != _generation) return;
      final index = _slots.indexWhere((v) => v.id == id);
      if (index < 0) return;
      if (image == null) {
        _slots.removeAt(index);
      } else {
        _slots[index] = DesktopComposerImageSlot(id, image: image);
      }
    } catch (e) {
      if (_disposed || generation != _generation) return;
      final index = _slots.indexWhere((v) => v.id == id);
      if (index >= 0) {
        _slots[index] = DesktopComposerImageSlot(
          id,
          error: e is PlatformException
              ? e.message ?? appStrings.desktopPickerOpenFailed
              : e.toString(),
        );
      }
    }
    if (!_disposed && generation == _generation) _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
