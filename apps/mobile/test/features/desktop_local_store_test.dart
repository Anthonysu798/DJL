import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/desktop_local_store.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

void main() {
  test(
    'offline history is encrypted, survives recreation, and is isolated between paired Macs',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'djl-encrypted-cache-',
      );
      final credentials = TestCredentials();
      try {
        final store = DesktopLocalStore(credentials, root: root);
        final record = {
          'threads': [
            {'id': 't1', 'name': 'Private title'},
          ],
          'timelines': {
            't1': [
              {'text': 'Private conversation body'},
            ],
          },
        };
        await store.save('mac-a', record);
        final files = await root
            .list(recursive: true)
            .where((e) => e is File)
            .cast<File>()
            .toList();
        expect(files, hasLength(1));
        final encrypted = await files.single.readAsString();
        expect(encrypted, isNot(contains('Private title')));
        expect(encrypted, isNot(contains('Private conversation body')));
        expect(
          (await DesktopLocalStore(
            credentials,
            root: root,
          ).load('mac-a'))['threads'],
          record['threads'],
        );
        expect(await store.load('mac-b'), isEmpty);
        await store.save('mac-b', {'title': 'Other Mac'});
        expect((await store.load('mac-a'))['timelines'], record['timelines']);
        await store.delete('mac-a');
        expect(await store.load('mac-a'), isEmpty);
        expect((await store.load('mac-b'))['title'], 'Other Mac');
      } finally {
        await root.delete(recursive: true);
      }
    },
  );
  test(
    'tampered cache cannot be decoded and concurrent writes retain their order',
    () async {
      final root = await Directory.systemTemp.createTemp('djl-cache-order-');
      try {
        final store = DesktopLocalStore(TestCredentials(), root: root);
        await Future.wait([
          store.save('qa', {'value': 'first'}),
          store.save('qa', {'value': 'last'}),
        ]);
        expect((await store.load('qa'))['value'], 'last');
        final file =
            (await root
                    .list(recursive: true)
                    .where((e) => e is File)
                    .cast<File>()
                    .toList())
                .single;
        final box =
            jsonDecode(await file.readAsString()) as Map<String, dynamic>;
        final bytes = base64Decode(box['ciphertext'] as String);
        bytes[0] ^= 1;
        box['ciphertext'] = base64Encode(bytes);
        await file.writeAsString(jsonEncode(box));
        await expectLater(store.load('qa'), throwsA(isA<Exception>()));
      } finally {
        await root.delete(recursive: true);
      }
    },
  );
}
