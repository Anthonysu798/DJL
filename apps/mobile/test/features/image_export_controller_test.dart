import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gal/gal.dart';
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/images/data/native_image_actions.dart';
import 'package:djl_mobile/features/images/presentation/image_export_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

class _BytesRepository extends CloudRepository {
  _BytesRepository(super.client);
  @override
  Future<Uint8List> fileData(String id) async => Uint8List.fromList([1, 2, 3]);
}

class _GalleryActions extends NativeImageActions {
  Object? failure;
  int saves = 0;
  @override
  Future<void> save(Uint8List bytes, String name) async {
    saves++;
    if (failure != null) throw failure!;
  }
}

void main() {
  for (final entry in {
    GalExceptionType.accessDenied: 'permission',
    GalExceptionType.notEnoughSpace: 'space',
    GalExceptionType.notSupportedFormat: 'format',
    GalExceptionType.unexpected: 'unexpected',
  }.entries) {
    test(
      'native gallery ${entry.key.name} leaves a readable error and permits retry',
      () async {
        final client = CloudClient(
          baseUrl: Uri.parse('https://qa.invalid'),
          credentials: TestCredentials(),
          client: MockClient(
            (_) async => throw StateError('Unexpected service request'),
          ),
        );
        final actions = _GalleryActions()
          ..failure = GalException(
            type: entry.key,
            platformException: PlatformException(
              code: entry.key.code,
              message: 'native-debug-details',
            ),
            stackTrace: StackTrace.current,
          );
        final controller = ImageExportController(
          _BytesRepository(client),
          actions: actions,
        );
        try {
          await controller.save('public-file');
          expect(controller.busy, isFalse);
          expect(controller.notice, isNull);
          expect(controller.error!.toLowerCase(), contains(entry.value));
          expect(controller.error, isNot(contains('GalException')));
          expect(controller.error, isNot(contains(entry.key.code)));
          actions.failure = null;
          await controller.save('public-file');
          expect(actions.saves, 2);
          expect(controller.error, isNull);
          expect(controller.notice, 'Saved to Photos.');
          expect(controller.busy, isFalse);
        } finally {
          controller.dispose();
          client.close();
        }
      },
    );
  }
}
