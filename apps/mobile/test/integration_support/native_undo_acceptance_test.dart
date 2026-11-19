import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/support/native_undo_acceptance.dart';

Map<String, dynamic> trace(List<Map<String, Object>> requests, int sequence) =>
    {'requests': requests, 'requestSequence': sequence};

Map<String, dynamic> saved() => {
  'platform': 'ios',
  'macDeviceId': 'qa-mac',
  'threadId': 'thread-1',
  'turnId': 'turn-1',
  'entryId': jsonEncode(['thread-1', 'turn-1']),
  'assistant': 'assistant-1',
  'cwd': '/tmp/disposable-qa',
  'beforeContent': '',
  'turnStartCount': 3,
  'applyCount': 1,
  'startSequence': 4,
  'requestSequence': 10,
};

void main() {
  List<({String id, String pin})> fixturePairs(
    List<({String id, String pin})> pairs,
  ) => nativeUndoFixturePairs(
    pairs,
    macIdOf: (pair) => pair.id,
    pinOf: (pair) => pair.pin,
    expectedMacId: 'qa-mac',
    expectedPin: 'qa-pin',
  );

  test('same-ID different-pin refuses before any cleanup or replacement', () {
    final mutations = <String>[];
    void cleanupAndReplace() {
      final targets = fixturePairs([
        (id: 'qa-mac', pin: 'qa-pin'),
        (id: 'unrelated-mac', pin: 'unrelated-pin'),
        (id: 'qa-mac', pin: 'different-pin'),
      ]);
      for (final target in targets) {
        mutations.add('forget:${target.id}');
      }
      mutations.add('pair');
    }

    expect(cleanupAndReplace, throwsStateError);
    expect(mutations, isEmpty);
  });
  test(
    'cleanup targets only exact fixture ID and pin, leaving unrelated pairs',
    () {
      final removed = <({String id, String pin})>[];
      final unrelated = (id: 'unrelated-mac', pin: 'qa-pin');
      final exact = (id: 'qa-mac', pin: 'qa-pin');
      for (final target in fixturePairs([unrelated, exact])) {
        removed.add(target);
      }
      expect(removed, [exact]);
      expect(fixturePairs([unrelated]), isEmpty);
    },
  );
  test('counts both apply RPCs, excluding previews and older mutations', () {
    expect(
      nativeUndoApplyCount(
        trace([
          {'sequence': 1, 'method': 'workspace/revertPatchApply'},
          {'sequence': 2, 'method': 'workspace/revertPatchPreview'},
          {'sequence': 3, 'method': 'workspace/revertPatchApply'},
          {'sequence': 4, 'method': 'workspace/revertPatchBatchPreview'},
          {'sequence': 5, 'method': 'workspace/revertPatchBatchApply'},
          {'sequence': 6, 'method': 'turn/start'},
        ], 6),
        afterSequence: 1,
      ),
      2,
    );
  });
  test(
    'missing, duplicated, reordered or malformed trace cannot prove zero',
    () {
      for (final snapshot in [
        trace([
          {'sequence': 3, 'method': 'thread/read'},
        ], 3),
        trace([
          {'sequence': 2, 'method': 'thread/read'},
          {'sequence': 2, 'method': 'thread/read'},
        ], 3),
        trace([
          {'sequence': 3, 'method': 'thread/read'},
          {'sequence': 2, 'method': 'thread/read'},
        ], 3),
        trace([
          {'sequence': 2},
        ], 2),
        trace([], 0),
        <String, dynamic>{'requestSequence': 1},
      ]) {
        expect(
          () => nativeUndoApplyCount(snapshot, afterSequence: 1),
          throwsStateError,
        );
      }
      expect(nativeUndoApplyCount(trace([], 1), afterSequence: 1), 0);
    },
  );
  test(
    'restore fixture requires exact platform, Mac, workspace and entry IDs',
    () {
      bool valid(Map<String, dynamic> value) => nativeUndoRestoreFixtureMatches(
        value,
        platform: 'ios',
        macId: 'qa-mac',
        cwd: '/tmp/disposable-qa',
      );
      expect(valid(saved()), isTrue);
      for (final changed in <String, Object?>{
        'platform': 'android',
        'macDeviceId': 'another-mac',
        'cwd': '/tmp/another-workspace',
        'threadId': 'another-thread',
        'turnId': 'another-turn',
        'entryId': '["thread-1","another-turn"]',
        'assistant': '',
        'beforeContent': null,
        'turnStartCount': null,
        'applyCount': 0,
        'startSequence': -1,
        'requestSequence': 3,
      }.entries) {
        expect(valid({...saved(), changed.key: changed.value}), isFalse);
      }
    },
  );
}
