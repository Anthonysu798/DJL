import 'package:flutter/foundation.dart';
import '../../../core/network/client_configuration.dart';
import '../../chat/domain/cloud_models.dart';
import '../data/image_repository.dart';
import '../domain/gallery_image.dart';

class ImageController extends ChangeNotifier {
  ImageController(this.repository) : _revision = repository.client.revision;
  final ImageRepository repository;
  final int _revision;
  List<GalleryImage> images = [];
  ClientConfiguration configuration = const ClientConfiguration();
  String? cursor, error;
  bool loading = false, _disposed = false;
  bool get _current => !_disposed && repository.client.revision == _revision;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> refresh({bool more = false}) async {
    if (loading) return;
    loading = true;
    error = null;
    _notify();
    try {
      final response = await repository.page(cursor: more ? cursor : null);
      if (!_current) return;
      configuration = ClientConfiguration.fromJson(
        await repository.client.request(
          'GET',
          'v1/client-config',
          authenticated: false,
        ),
      );
      if (!_current) return;
      final next = (response['images'] as List).map(
        (j) => GalleryImage.fromJson(j as Json),
      );
      images = more
          ? [
              ...images,
              ...next.where((n) => !images.any((i) => i.fileId == n.fileId)),
            ]
          : next.toList();
      cursor = response['nextCursor'] as String?;
    } catch (e) {
      if (_current) error = e.toString();
    } finally {
      if (_current) {
        loading = false;
        _notify();
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
