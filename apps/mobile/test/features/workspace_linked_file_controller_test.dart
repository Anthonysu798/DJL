import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'package:djl_mobile/features/workspace/presentation/workspace_linked_file_controller.dart';
import 'workspace_repository_test.dart' show WorkspaceTransport;

class PreviewTransport extends WorkspaceTransport {
  final pending = <Completer<RemoteJson>>[];
  bool held = false;
  RemoteJson? textResponse;
  RemoteJson? imageResponse;
  final failures = <String>{};
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    if (held) {
      final result = Completer<RemoteJson>();
      pending.add(result);
      return result.future;
    }
    if (failures.contains(method)) throw StateError('Cannot $method');
    return method == 'workspace/readFile'
        ? textResponse ?? textReply(params['path'] as String)
        : imageResponse ?? imageReply(params['path'] as String);
  }
}

RemoteJson textReply(String path) => {
  'path': '/repo/$path',
  'fileName': path,
  'byteLength': 8,
  'mtimeMs': 12,
  'encoding': 'utf-8',
  'lineCount': 2,
  'content': 'hello\nhi',
};
RemoteJson imageReply(String path) => {
  'path': '/repo/$path',
  'fileName': path,
  'byteLength': 80,
  'mtimeMs': 12,
  'mimeType': 'image/svg+xml',
  'previewMaxPixelDimension': 1600,
  'dataBase64': base64Encode(
    utf8.encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>',
    ),
  ),
};
WorkspaceLinkedFileController preview(PreviewTransport t) =>
    WorkspaceLinkedFileController(
      WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('a non-image payload falls back to readable text', () async {
    final t = PreviewTransport()
      ..imageResponse = {
        ...imageReply('unknown.bin'),
        'fileName': 'unknown.bin',
        'mimeType': 'image/png',
        'dataBase64': base64Encode(utf8.encode('plain file')),
      };
    final c = preview(t);
    await c.load('unknown.bin');
    expect(t.calls.map((e) => e['method']), [
      'workspace/readImage',
      'workspace/readFile',
    ]);
    expect(c.text!.content, 'hello\nhi');
    expect(c.image, isNull);
    c.dispose();
  });
  test('known text uses readFile; unknown and SVG use readImage', () async {
    final t = PreviewTransport();
    final controller = preview(t);
    for (final path in ['README.MD', 'x.tsx', 'x.yml', 'x.txt']) {
      await controller.load(path);
      expect(t.calls.last['method'], 'workspace/readFile');
      expect(controller.text, isNotNull);
    }
    for (final path in ['x.svg', 'x.png', 'x.unknown', 'Dockerfile']) {
      await controller.load(path);
      expect(t.calls.last['method'], 'workspace/readImage');
      expect(controller.image, isNotNull);
    }
    controller.dispose();
  });
  test('failure falls back once and combines distinct errors', () async {
    final t = PreviewTransport()..failures.add('workspace/readFile');
    final c = preview(t);
    await c.load('x.md');
    expect(t.calls.map((e) => e['method']), [
      'workspace/readFile',
      'workspace/readImage',
    ]);
    expect(c.image, isNotNull);
    expect(c.error, isNull);
    t.failures.add('workspace/readImage');
    await c.load('x.png');
    expect(c.error, contains('Cannot workspace/readImage'));
    expect(c.error, contains('Cannot workspace/readFile'));
    expect(c.loading, isFalse);
    c.dispose();
  });
  test('reload reuses same-path metadata, never another path', () async {
    final t = PreviewTransport();
    final controller = preview(t);
    await controller.load('x.md');
    await controller.load('x.md');
    expect((t.calls.last['params'] as Map)['ifByteLength'], 8);
    expect((t.calls.last['params'] as Map)['ifMtimeMs'], 12);
    await controller.load('y.md');
    expect(
      (t.calls.last['params'] as Map).containsKey('ifByteLength'),
      isFalse,
    );
    controller.dispose();
  });
  test(
    'late failure never starts fallback in a new or disposed preview',
    () async {
      final t = PreviewTransport()..held = true;
      final c = preview(t);
      final old = c.load('old.md');
      final current = c.load('new.md');
      t.pending[0].completeError(StateError('old request failed'));
      await old;
      expect(t.calls, hasLength(2));
      t.pending[1].complete(textReply('new.md'));
      await current;
      expect(c.text!.name, 'new.md');
      final disposed = c.load('disposed.md');
      c.dispose();
      t.pending[2].completeError(StateError('disposed request failed'));
      await disposed;
      expect(t.calls, hasLength(3));
    },
  );
  test('late success cannot replace the current preview', () async {
    final t = PreviewTransport()..held = true;
    final c = preview(t);
    final old = c.load('old.svg'), current = c.load('new.md');
    t.pending[1].complete(textReply('new.md'));
    await current;
    t.pending[0].complete(imageReply('old.svg'));
    await old;
    expect(c.text!.name, 'new.md');
    expect(c.image, isNull);
    c.dispose();
  });
}
