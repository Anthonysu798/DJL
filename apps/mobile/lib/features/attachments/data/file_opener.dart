import 'dart:io';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// Hands a file to the system: Quick Look on iOS, the app that opens this type
/// on Android. Falls back to the share sheet when nothing can show it.
class FileOpener {
  const FileOpener();
  static const _channel = MethodChannel('djl.mobile/files');

  Future<String> _write(Uint8List bytes, String name) async {
    final folder = Directory(
      '${(await getTemporaryDirectory()).path}/djl-attachments',
    );
    await folder.create(recursive: true);
    // Keep the real name so the viewer shows it; strip path separators.
    final safe = name.replaceAll(RegExp(r'[/\\\x00]'), '_');
    final file = File('${folder.path}/$safe');
    await file.writeAsBytes(bytes, flush: true);
    return file.path;
  }

  /// Returns false when no viewer took the file and the share sheet opened.
  Future<bool> open(
    Uint8List bytes,
    String name,
    String mimeType, {
    Rect? origin,
  }) async {
    final path = await _write(bytes, name);
    try {
      if (await _channel.invokeMethod<bool>('open', {
            'path': path,
            'mimeType': mimeType,
          }) ==
          true) {
        return true;
      }
    } on MissingPluginException {
      // Older native builds; fall through to sharing.
    } on PlatformException {
      // No viewer for this type.
    }
    await share(bytes, name, mimeType, origin: origin);
    return false;
  }

  Future<void> share(
    Uint8List bytes,
    String name,
    String mimeType, {
    Rect? origin,
  }) async {
    final path = await _write(bytes, name);
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile(path, mimeType: mimeType, name: name)],
        sharePositionOrigin: origin,
      ),
    );
  }
}
