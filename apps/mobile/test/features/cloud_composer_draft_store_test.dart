import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/chat/data/cloud_composer_draft_store.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

const draftRecord = 'cloud.composer.drafts.v1';

class DraftCredentials extends TestCredentials {
  bool failRead = false, failWrite = false;
  Completer<void>? nextWrite;
  int draftWrites = 0;
  @override
  Future<String?> read(String key) async {
    if (key == draftRecord && failRead) throw StateError('locked');
    return super.read(key);
  }

  @override
  Future<void> write(String key, String? value) async {
    if (key == draftRecord) {
      draftWrites++;
      final gate = nextWrite;
      nextWrite = null;
      await gate?.future;
      if (failWrite) throw StateError('storage unavailable');
    }
    return super.write(key, value);
  }
}

void main() {
  test(
    'an empty new draft never erases an existing draft returned by an idempotent creation retry',
    () async {
      final vault = DraftCredentials();
      final store = CloudComposerDraftStore(vault);
      await store.save(
        'a',
        'existing',
        'keep follow-up',
        generation: store.generation,
      );
      final beforeWrites = vault.draftWrites;
      expect(
        await store.move('a', 'new', 'existing', generation: store.generation),
        true,
      );
      expect(await store.read('a', 'existing'), 'keep follow-up');
      expect(vault.draftWrites, beforeWrites);
    },
  );
  test(
    'exact Unicode drafts survive recreation and stay scoped to account and conversation',
    () async {
      final vault = DraftCredentials()
        ..values.addAll({
          'cloud.session': 'qa-session',
          'desktop.identity': 'paired-fixture',
        });
      final store = CloudComposerDraftStore(vault);
      final lease = store.generation;
      await store.save(
        'user:org',
        'new',
        '待办\n  keep spaces  ',
        generation: lease,
      );
      await store.save(
        'user:org',
        'conversation',
        'follow-up',
        generation: lease,
      );
      await store.save('other:org', 'new', 'other account', generation: lease);
      final restored = CloudComposerDraftStore(vault);
      expect(await restored.read('user:org', 'new'), '待办\n  keep spaces  ');
      expect(await restored.read('user:org', 'conversation'), 'follow-up');
      expect(await restored.read('other:org', 'new'), 'other account');
      expect(await restored.read('user:other-org', 'new'), '');
      expect(vault.values['cloud.session'], 'qa-session');
      expect(vault.values['desktop.identity'], 'paired-fixture');
    },
  );

  test(
    'new draft moves atomically to the created conversation and empty clears only its owner',
    () async {
      final vault = DraftCredentials();
      final store = CloudComposerDraftStore(vault);
      final lease = store.generation;
      await store.save('a', 'new', 'next edit', generation: lease);
      await store.save('b', 'new', 'keep b', generation: lease);
      expect(await store.move('a', 'new', 'created', generation: lease), true);
      final restored = CloudComposerDraftStore(vault);
      expect(await restored.read('a', 'new'), '');
      expect(await restored.read('a', 'created'), 'next edit');
      await store.save('a', 'created', '', generation: lease);
      expect(await CloudComposerDraftStore(vault).read('b', 'new'), 'keep b');
      await store.save('b', 'new', '', generation: lease);
      expect(vault.values.containsKey(draftRecord), false);
    },
  );

  test(
    'account reset fences queued and later old writers without deleting paired credentials',
    () async {
      final vault = DraftCredentials()
        ..values['desktop.identity'] = 'keep pairing';
      final store = CloudComposerDraftStore(vault);
      final oldLease = store.generation;
      final held = Completer<void>();
      vault.nextWrite = held;
      final oldWrite = store.save(
        'old',
        'new',
        'private old draft',
        generation: oldLease,
      );
      await Future<void>.delayed(Duration.zero);
      expect(vault.draftWrites, 1);
      final clearing = store.clearAll();
      final lateOldWrite = store.save(
        'old',
        'new',
        'must not reappear',
        generation: oldLease,
      );
      final newWrite = store.save(
        'new',
        'new',
        'new owner',
        generation: store.generation,
      );
      held.complete();
      expect(await oldWrite, false);
      await clearing;
      expect(await lateOldWrite, false);
      expect(await newWrite, true);
      final restored = CloudComposerDraftStore(vault);
      expect(await restored.read('old', 'new'), '');
      expect(await restored.read('new', 'new'), 'new owner');
      expect(vault.values['desktop.identity'], 'keep pairing');
    },
  );

  test(
    'unreadable draft payload is preserved and never replaced by a blind save',
    () async {
      final vault = DraftCredentials()
        ..values[draftRecord] = '{"private-marker":{"new":42}}';
      final original = vault.values[draftRecord];
      final store = CloudComposerDraftStore(vault);
      await expectLater(
        store.read('private-marker', 'new'),
        throwsA(isA<FormatException>()),
      );
      await expectLater(
        store.save(
          'private-marker',
          'new',
          'replacement',
          generation: store.generation,
        ),
        throwsA(isA<FormatException>()),
      );
      expect(vault.values[draftRecord], original);
      expect(vault.draftWrites, 0);
    },
  );

  test(
    'read retry recovers and failed write keeps the latest text in memory for explicit retry',
    () async {
      final vault = DraftCredentials();
      final initial = CloudComposerDraftStore(vault);
      await initial.save('a', 'new', 'saved', generation: initial.generation);
      final store = CloudComposerDraftStore(vault);
      vault.failRead = true;
      await expectLater(store.read('a', 'new'), throwsStateError);
      vault.failRead = false;
      expect(await store.read('a', 'new'), 'saved');
      final previous = vault.values[draftRecord];
      vault.failWrite = true;
      await expectLater(
        store.save('a', 'new', 'latest unsaved', generation: store.generation),
        throwsStateError,
      );
      expect(vault.values[draftRecord], previous);
      expect(await store.read('a', 'new'), 'latest unsaved');
      expect(store.dirty, true);
      vault.failWrite = false;
      expect(await store.flush(generation: store.generation), true);
      expect(store.dirty, false);
      expect(
        await CloudComposerDraftStore(vault).read('a', 'new'),
        'latest unsaved',
      );
    },
  );
}
