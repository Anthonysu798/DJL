import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/chat/data/cloud_model_selection_store.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

const modelChoiceKey = 'djl.cloud.selectedModelID';

class ModelChoiceCredentials extends TestCredentials {
  bool failRead = false, failWrite = false;
  Completer<void>? nextWrite;
  int modelWrites = 0;
  @override
  Future<String?> read(String key) async {
    if (key == modelChoiceKey && failRead) {
      throw StateError('private storage detail');
    }
    return super.read(key);
  }

  @override
  Future<void> write(String key, String? value) async {
    if (key == modelChoiceKey) {
      modelWrites++;
      final gate = nextWrite;
      nextWrite = null;
      await gate?.future;
      if (failWrite) throw StateError('private storage detail');
    }
    return super.write(key, value);
  }
}

void main() {
  test(
    'source model key persists and exact cleanup keeps pairing/session keys',
    () async {
      final vault = ModelChoiceCredentials()
        ..values.addAll({
          'desktop.identity': 'keep pairing',
          'cloud.session': 'keep session',
        });
      final store = CloudModelSelectionStore(vault);
      await store.save('sonnet', generation: store.generation);
      expect(await CloudModelSelectionStore(vault).read(), 'sonnet');
      await store.clear();
      expect(vault.values[modelChoiceKey], isNull);
      expect(vault.values['desktop.identity'], 'keep pairing');
      expect(vault.values['cloud.session'], 'keep session');
    },
  );
  test(
    'clear fences held old model writes and later old-owner writers',
    () async {
      final vault = ModelChoiceCredentials();
      final store = CloudModelSelectionStore(vault);
      final old = store.generation;
      final gate = Completer<void>();
      vault.nextWrite = gate;
      final write = store.save('old', generation: old);
      await Future<void>.delayed(Duration.zero);
      expect(vault.modelWrites, 1);
      final clear = store.clear();
      final late = store.save('resurrect', generation: old);
      final next = store.save('new', generation: store.generation);
      gate.complete();
      expect(await write, false);
      await clear;
      expect(await late, false);
      expect(await next, true);
      expect(await CloudModelSelectionStore(vault).read(), 'new');
    },
  );
  test(
    'failed model read preserves the stored choice until a read retry',
    () async {
      final vault = ModelChoiceCredentials()..values[modelChoiceKey] = 'saved';
      final store = CloudModelSelectionStore(vault);
      vault.failRead = true;
      await expectLater(store.read(), throwsStateError);
      await expectLater(
        store.save('blind replacement', generation: store.generation),
        throwsStateError,
      );
      expect(vault.values[modelChoiceKey], 'saved');
      expect(vault.modelWrites, 0);
      vault.failRead = false;
      expect(await store.read(), 'saved');
    },
  );
  test(
    'failed writes retain the latest live choice and persist on retry',
    () async {
      final vault = ModelChoiceCredentials()..values[modelChoiceKey] = 'saved';
      final store = CloudModelSelectionStore(vault);
      expect(await store.read(), 'saved');
      vault.failWrite = true;
      await expectLater(
        store.save('latest', generation: store.generation),
        throwsStateError,
      );
      expect(store.value, 'latest');
      expect(store.dirty, true);
      expect(vault.values[modelChoiceKey], 'saved');
      vault.failWrite = false;
      expect(await store.save('latest', generation: store.generation), true);
      expect(store.dirty, false);
      expect(await CloudModelSelectionStore(vault).read(), 'latest');
    },
  );
}
