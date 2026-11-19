import 'dart:convert';

// A truncated trace cannot prove that a mutation did not happen.
int nativeUndoApplyCount(Map snapshot, {required int afterSequence}) {
  final requests = snapshot['requests'], end = snapshot['requestSequence'];
  if (requests is! List ||
      end is! int ||
      afterSequence < 0 ||
      end < afterSequence) {
    throw StateError('Invalid native undo request window.');
  }
  var next = afterSequence + 1, count = 0;
  for (final request in requests) {
    if (request is! Map || request['sequence'] is! int) {
      throw StateError('Malformed native undo request trace.');
    }
    if ((request['sequence'] as int) <= afterSequence) continue;
    if (request['sequence'] != next++ || request['method'] is! String) {
      throw StateError('Incomplete native undo request trace.');
    }
    if ({
      'workspace/revertPatchApply',
      'workspace/revertPatchBatchApply',
    }.contains(request['method'])) {
      count++;
    }
  }
  if (next != end + 1) throw StateError('Truncated native undo request trace.');
  return count;
}

bool nativeUndoRestoreFixtureMatches(
  Map expected, {
  required String platform,
  required String macId,
  required String cwd,
}) {
  if (expected['platform'] != platform ||
      expected['macDeviceId'] != macId ||
      expected['cwd'] != cwd) {
    return false;
  }
  for (final key in ['threadId', 'turnId', 'entryId', 'assistant']) {
    if (expected[key] is! String || (expected[key] as String).isEmpty) {
      return false;
    }
  }
  if (expected['beforeContent'] is! String) return false;
  for (final key in [
    'turnStartCount',
    'applyCount',
    'startSequence',
    'requestSequence',
  ]) {
    if (expected[key] is! int || (expected[key] as int) < 0) return false;
  }
  if (expected['applyCount'] != 1 ||
      (expected['startSequence'] as int) >=
          (expected['requestSequence'] as int)) {
    return false;
  }
  return expected['entryId'] ==
      jsonEncode([expected['threadId'], expected['turnId']]);
}

// Select all QA cleanup targets before any caller can mutate a saved pairing.
List<T> nativeUndoFixturePairs<T>(
  Iterable<T> saved, {
  required String Function(T) macIdOf,
  required String Function(T) pinOf,
  required String expectedMacId,
  required String expectedPin,
}) {
  final targets = <T>[];
  for (final pair in saved) {
    if (macIdOf(pair) != expectedMacId) continue;
    if (pinOf(pair) != expectedPin) {
      throw StateError(
        'Saved QA desktop identity differs from the fixture pin.',
      );
    }
    targets.add(pair);
  }
  return targets;
}
