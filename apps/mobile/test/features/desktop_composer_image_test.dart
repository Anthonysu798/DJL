import 'dart:ui' as ui;
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_controller.dart';

class NativePicker extends ImagePicker {
  XFile? result;
  Map<String, Object?>? options;
  @override
  Future<XFile?> pickImage({
    required ImageSource source,
    double? maxWidth,
    double? maxHeight,
    int? imageQuality,
    CameraDevice preferredCameraDevice = CameraDevice.rear,
    bool requestFullMetadata = true,
  }) async {
    options = {
      'source': source,
      'maxWidth': maxWidth,
      'maxHeight': maxHeight,
      'imageQuality': imageQuality,
      'requestFullMetadata': requestFullMetadata,
    };
    return result;
  }
}

Future<XFile> png(int width, int height) async {
  final recorder = ui.PictureRecorder();
  ui.Canvas(recorder).drawColor(const ui.Color(0xff334455), ui.BlendMode.src);
  final picture = recorder.endRecording();
  final image = await picture.toImage(width, height);
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  picture.dispose();
  return XFile.fromData(bytes!.buffer.asUint8List(), name: 'photo.png');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'phone picker requests the Swift size/quality bounds and validates the returned image',
    () async {
      final native = NativePicker()..result = await png(1, 1);
      final image = await DesktopComposerImagePicker(
        picker: native,
      ).pick(camera: true);
      expect(native.options, {
        'source': ImageSource.camera,
        'maxWidth': 1600.0,
        'maxHeight': 1600.0,
        'imageQuality': 60,
        'requestFullMetadata': false,
      });
      expect(image?.dataUrl, startsWith('data:image/png;base64,'));
      expect(image?.bytes, isNotEmpty);
      native.result = null;
      expect(await DesktopComposerImagePicker(picker: native).pick(), isNull);
      expect(native.options?['source'], ImageSource.gallery);
    },
  );
  test(
    'a plugin result that exceeds resize bounds or cannot decode becomes a visible picker failure',
    () async {
      final native = NativePicker()..result = await png(1601, 1);
      await expectLater(
        DesktopComposerImagePicker(picker: native).pick(),
        throwsFormatException,
      );
      native.result = XFile.fromData(
        Uint8List.fromList([1, 2, 3]),
        name: 'broken.png',
      );
      await expectLater(
        DesktopComposerImagePicker(picker: native).pick(),
        throwsA(anything),
      );
    },
  );
}
