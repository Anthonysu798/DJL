import 'dart:typed_data';
import 'dart:ui';
import 'package:gal/gal.dart';
import 'package:share_plus/share_plus.dart';

class NativeImageActions {
  Future<void> save(Uint8List bytes, String name) {
    final extension = RegExp(
      r'\.(png|jpe?g|webp)$',
      caseSensitive: false,
    ).firstMatch(name);
    return Gal.putImageBytes(
      bytes,
      name: extension != null && extension.start > 0
          ? name.substring(0, extension.start)
          : name,
    );
  }

  Future<void> share(Uint8List bytes, String mimeType, Rect origin) async {
    final extension = mimeType == 'image/jpeg'
        ? 'jpg'
        : mimeType == 'image/webp'
        ? 'webp'
        : 'png';
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile.fromData(bytes, mimeType: mimeType)],
        fileNameOverrides: ['djl-image.$extension'],
        sharePositionOrigin: origin,
      ),
    );
  }
}
