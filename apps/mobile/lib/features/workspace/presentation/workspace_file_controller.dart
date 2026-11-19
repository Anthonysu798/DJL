import 'package:flutter/foundation.dart';
import '../data/workspace_repository.dart';
import '../domain/workspace_models.dart';

class WorkspaceFileController extends ChangeNotifier {
  WorkspaceFileController(this.repository);
  final WorkspaceRepository repository;
  WorkspaceTextFile? text;
  WorkspaceImage? image;
  String? error;
  String? _lastPath;
  bool loading = false, _disposed = false;
  int _generation = 0;
  Future<void> load(String path, {required bool asImage}) async {
    final generation = ++_generation;
    loading = true;
    error = null;
    final cachedText = _lastPath == path ? text : null,
        cachedImage = _lastPath == path ? image : null;
    _lastPath = path;
    text = null;
    image = null;
    notifyListeners();
    try {
      if (asImage) {
        final result = await repository.readImage(path, cached: cachedImage);
        if (!_disposed && generation == _generation) {
          image = result;
        }
      } else {
        final result = await repository.readTextFile(path, cached: cachedText);
        if (!_disposed && generation == _generation) {
          text = result;
        }
      }
    } catch (e) {
      if (generation == _generation) {
        error = e.toString();
      }
    } finally {
      if (!_disposed && generation == _generation) {
        loading = false;
        notifyListeners();
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
