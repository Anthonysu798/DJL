import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/desktop_local_store.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_threads_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_composer_send_test.dart' show mixed;
import 'desktop_fork_test.dart' show ForkTransport, controller;
import 'desktop_requests_test.dart' show TestTransport;

void main() {
  test(
    'mixed drafts remain encrypted and isolated by paired Mac and thread after recreation',
    () async {
      final root = await Directory.systemTemp.createTemp('djl-mixed-draft-');
      final credentials = TestCredentials();
      try {
        final state = ThreadLocalState()
          ..setComposerDraft('source', mixed(text: 'private draft marker'));
        final store = DesktopLocalStore(credentials, root: root);
        await store.save('mac-a', state.toJson());
        await store.save('mac-b', ThreadLocalState().toJson());
        final encoded = await root
            .list(recursive: true)
            .where((v) => v is File)
            .cast<File>()
            .asyncMap((f) => f.readAsString())
            .join();
        expect(encoded, isNot(contains('private draft marker')));
        expect(encoded, isNot(contains('data:image')));
        expect(encoded, isNot(contains('plugin://drive')));
        final loaded = ThreadLocalState.fromJson(
          await DesktopLocalStore(credentials, root: root).load('mac-a'),
        );
        expect(loaded.composerDraft('source').text, 'private draft marker');
        expect(loaded.composerDraft('source').images.single.id, 'image-1');
        expect(loaded.composerDraft('source').contexts.map((c) => c.kind), [
          DesktopContextKind.skill,
          DesktopContextKind.plugin,
          DesktopContextKind.file,
        ]);
        expect(loaded.composerDraft('other-thread').isEmpty, isTrue);
        expect(
          ThreadLocalState.fromJson(
            await store.load('mac-b'),
          ).composerDraft('source').isEmpty,
          isTrue,
        );
      } finally {
        await root.delete(recursive: true);
      }
    },
  );
  test(
    'a malformed mixed draft prevents cache overwrite so recoverable encrypted file remains intact',
    () async {
      final root = await Directory.systemTemp.createTemp('djl-invalid-draft-');
      final pairs = PairingRepository(TestCredentials());
      final store = DesktopLocalStore(pairs.credentials, root: root);
      final transport = TestTransport(pairs);
      final threads = DesktopThreadsController(transport, store);
      try {
        await store.save('mac-a', {
          'composerDrafts': {
            't1': {
              'images': [
                {'id': 'broken', 'name': 'x', 'dataUrl': 'broken-payload'},
              ],
            },
          },
        });
        final file =
            (await root
                    .list(recursive: true)
                    .where((v) => v is File)
                    .cast<File>()
                    .toList())
                .single;
        final before = await file.readAsString();
        await threads.attach('mac-a');
        expect(threads.localError, isNotNull);
        threads.data.setComposerDraft('new', mixed());
        await threads.saveNow();
        expect(await file.readAsString(), before);
      } finally {
        threads.dispose();
        await transport.dispose();
        await root.delete(recursive: true);
      }
    },
  );
  test(
    'fork retains the source mixed draft while new chat drafts evolve independently',
    () async {
      final transport = ForkTransport(PairingRepository(TestCredentials()));
      final desktop = controller(transport);
      desktop.threadList.data.setComposerDraft(
        'source',
        mixed(text: 'source draft'),
      );
      expect(await desktop.forkThread(), isTrue);
      expect(
        desktop.threadList.data.composerDraft('source').text,
        'source draft',
      );
      expect(desktop.threadList.data.composerDraft('forked').isEmpty, isTrue);
      desktop.threadList.data.setComposerDraft(
        'forked',
        mixed(text: 'fork draft').copyWith(images: [], contexts: []),
      );
      expect(
        desktop.threadList.data.composerDraft('source').images,
        hasLength(1),
      );
      expect(desktop.threadList.data.composerDraft('forked').images, isEmpty);
      desktop.dispose();
    },
  );
}
