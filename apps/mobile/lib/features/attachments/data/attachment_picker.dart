import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mime/mime.dart';

class PickedAttachment {
  const PickedAttachment(this.name, this.mime, this.bytes);
  final String name, mime;
  final Uint8List bytes;
}

class AttachmentPicker {
  Future<PickedAttachment?> file() async {
    final result = await FilePicker.platform.pickFiles(withData: true);
    final file = result?.files.single;
    if (file == null) return null;
    final bytes = file.bytes;
    if (bytes == null) throw StateError('Could not read the selected file.');
    return PickedAttachment(
      file.name,
      lookupMimeType(file.name, headerBytes: bytes) ??
          'application/octet-stream',
      bytes,
    );
  }

  /// Any number of files of any type.
  Future<List<PickedAttachment>> files() async {
    final result = await FilePicker.platform.pickFiles(
      withData: true,
      allowMultiple: true,
    );
    return [
      for (final file in result?.files ?? const <PlatformFile>[])
        if (file.bytes case final bytes?)
          PickedAttachment(
            file.name,
            lookupMimeType(file.name, headerBytes: bytes) ??
                'application/octet-stream',
            bytes,
          ),
    ];
  }

  /// Any number of photos from the library.
  Future<List<PickedAttachment>> images() async {
    // A quality setting makes iOS hand back JPEG instead of HEIC, which the
    // desktop cannot read.
    final result = await ImagePicker().pickMultiImage(imageQuality: 90);
    return [
      for (final image in result)
        await image.readAsBytes().then(
          (bytes) => PickedAttachment(
            image.name,
            lookupMimeType(image.name, headerBytes: bytes) ?? 'image/jpeg',
            bytes,
          ),
        ),
    ];
  }

  Future<PickedAttachment?> image({bool camera = false}) async {
    final result = await ImagePicker().pickImage(
      source: camera ? ImageSource.camera : ImageSource.gallery,
    );
    if (result == null) return null;
    final bytes = await result.readAsBytes();
    return PickedAttachment(
      result.name,
      lookupMimeType(result.name, headerBytes: bytes) ?? 'image/jpeg',
      bytes,
    );
  }
}
