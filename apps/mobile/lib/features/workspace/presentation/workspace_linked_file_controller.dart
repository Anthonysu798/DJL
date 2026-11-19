import 'dart:ui' as ui;
import 'package:flutter/foundation.dart';
import '../data/workspace_repository.dart';
import '../domain/workspace_models.dart';

class WorkspaceLinkedFileController extends ChangeNotifier {
  WorkspaceLinkedFileController(this.repository);
  final WorkspaceRepository repository;
  WorkspaceTextFile? text;
  WorkspaceImage? image;
  String? error, _path;
  bool loading = false, _disposed = false;
  int _generation = 0;

  static bool prefersText(String path) =>
      path.split('/').last.contains('.') &&
      const {
        'bash',
        'c',
        'cc',
        'cjs',
        'cpp',
        'cs',
        'css',
        'go',
        'h',
        'html',
        'java',
        'js',
        'json',
        'jsx',
        'kt',
        'm',
        'md',
        'mjs',
        'mm',
        'py',
        'rb',
        'rs',
        'scss',
        'sh',
        'sql',
        'swift',
        'toml',
        'ts',
        'tsx',
        'txt',
        'xml',
        'yaml',
        'yml',
        'zsh',
      }.contains(path.split('/').last.split('.').last.toLowerCase());

  Future<void> load(String path) async {
    if (_disposed) return;
    final generation = ++_generation;
    bool current() => !_disposed && generation == _generation;
    final cachedText = path == _path ? text : null;
    final cachedImage = path == _path ? image : null;
    _path = path;
    text = null;
    image = null;
    error = null;
    loading = true;
    notifyListeners();
    final errors = <String>[];
    for (final asText in [prefersText(path), !prefersText(path)]) {
      if (!current()) return;
      try {
        if (asText) {
          final value = await repository.readTextFile(path, cached: cachedText);
          if (current()) text = value;
        } else {
          final value = await repository.readImage(path, cached: cachedImage);
          if (!current()) return;
          if (!value.mimeType.toLowerCase().contains('svg') &&
              !value.name.toLowerCase().endsWith('.svg')) {
            final codec = await ui.instantiateImageCodec(value.bytes);
            try {
              final frame = await codec.getNextFrame();
              frame.image.dispose();
            } finally {
              codec.dispose();
            }
          }
          if (current()) image = value;
        }
        break;
      } catch (e) {
        if (!current()) return;
        final message = e.toString();
        if (!errors.contains(message)) errors.add(message);
      }
    }
    if (!current()) return;
    if (text == null && image == null) error = errors.join('\n');
    loading = false;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
