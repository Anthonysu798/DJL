import 'package:flutter/foundation.dart';
import '../data/workspace_repository.dart';
import '../domain/workspace_models.dart';
import '../../../l10n/l10n.dart';

class ProjectController extends ChangeNotifier {
  ProjectController(this.repository);
  final ProjectRepository repository;
  List<ProjectLocation> locations = [];
  ProjectListing? listing;
  List<ProjectDirectory>? matches;
  bool loading = false, creating = false, _disposed = false;
  int _generation = 0;
  String? error;
  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  Future<void> initialize(String? initialPath) async {
    final generation = ++_generation;
    loading = true;
    error = null;
    _notify();
    try {
      final result = await repository.quickLocations();
      if (_disposed || generation != _generation) return;
      locations = result;
    } catch (e) {
      if (_disposed || generation != _generation) return;
      error = e.toString();
      if (initialPath == null) {
        loading = false;
        _notify();
        return;
      }
    }
    if (_disposed) {
      return;
    }
    final start =
        initialPath ??
        locations
            .where((location) => location.id == 'developer')
            .firstOrNull
            ?.path ??
        locations.firstOrNull?.path;
    if (start == null || start.trim().isEmpty) {
      loading = false;
      error = appStrings.workspaceNoLocalFolders;
      _notify();
      return;
    }
    await browse(start);
  }

  Future<void> browse(String path) async {
    final generation = ++_generation;
    loading = true;
    error = null;
    matches = null;
    _notify();
    try {
      final result = await repository.listDirectory(path);
      if (!_disposed && generation == _generation) {
        listing = result;
      }
    } catch (e) {
      if (generation == _generation) {
        error = e.toString();
      }
    } finally {
      if (generation == _generation) {
        loading = false;
        _notify();
      }
    }
  }

  Future<void> search(String query) async {
    if (listing == null) {
      return;
    }
    final generation = ++_generation;
    if (query.trim().isEmpty) {
      matches = null;
      loading = false;
      error = null;
      _notify();
      return;
    }
    loading = true;
    error = null;
    _notify();
    try {
      final result = await repository.search(listing!.path, query.trim());
      if (!_disposed && generation == _generation) {
        matches = result;
      }
    } catch (e) {
      if (generation == _generation) {
        error = e.toString();
        matches = [];
      }
    } finally {
      if (generation == _generation) {
        loading = false;
        _notify();
      }
    }
  }

  Future<String?> create(String name) async {
    final trimmed = name.trim();
    if (_disposed ||
        listing == null ||
        loading ||
        creating ||
        trimmed.isEmpty) {
      return null;
    }
    final generation = ++_generation;
    creating = true;
    error = null;
    _notify();
    try {
      final path = await repository.createDirectory(listing!.path, trimmed);
      if (!_disposed && generation == _generation) return path;
    } catch (e) {
      if (!_disposed && generation == _generation) error = e.toString();
    } finally {
      creating = false;
      _notify();
    }
    return null;
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
