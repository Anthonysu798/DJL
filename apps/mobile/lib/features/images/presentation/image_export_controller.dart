import 'dart:ui';
import 'package:flutter/foundation.dart';
import 'package:gal/gal.dart';
import '../../chat/data/cloud_repository.dart';
import '../data/native_image_actions.dart';
import '../../../l10n/l10n.dart';

class ImageExportController extends ChangeNotifier {
  ImageExportController(this.repository, {NativeImageActions? actions})
    : _actions = actions ?? NativeImageActions(),
      _revision = repository.client.revision;
  final CloudRepository repository;
  final NativeImageActions _actions;
  final int _revision;
  bool busy = false, _disposed = false;
  String? error, notice;
  bool get _current => !_disposed && repository.client.revision == _revision;
  Future<void> save(String fileId) async {
    if (busy || !_current) return;
    busy = true;
    error = null;
    notice = null;
    notifyListeners();
    try {
      final bytes = await repository.fileData(fileId);
      if (!_current) return;
      await _actions.save(bytes, 'djl-image-$fileId');
      if (_current) notice = appStrings.imagesSaved;
    } catch (e) {
      if (_current) error = e is GalException ? e.type.message : e.toString();
    } finally {
      if (_current) {
        busy = false;
        notifyListeners();
      }
    }
  }

  Future<void> share(String fileId, String mimeType, Rect origin) async {
    if (busy || !_current) return;
    busy = true;
    error = null;
    notice = null;
    notifyListeners();
    try {
      final bytes = await repository.fileData(fileId);
      if (!_current) return;
      await _actions.share(bytes, mimeType, origin);
    } catch (e) {
      if (_current) error = e.toString();
    } finally {
      if (_current) {
        busy = false;
        notifyListeners();
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
