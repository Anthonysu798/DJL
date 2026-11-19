import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/support/native_draft_acceptance.dart';

Map<String, dynamic> sample({
  int sequence = 0,
  List<Map<String, dynamic>> requests = const [],
}) => {
  'applicationMessageCount': sequence,
  'requestSequence': sequence,
  'threadStartAttemptCount': 0,
  'threadCount': 1,
  'turnStartCount': 0,
  'turnCount': 0,
  'threadResumeCount': 0,
  'requests': requests,
};

void main() {
  test('requires every nonnegative integer counter and typed trace', () {
    for (final key in [
      'applicationMessageCount',
      'requestSequence',
      'threadStartAttemptCount',
      'threadCount',
      'turnStartCount',
      'turnCount',
      'threadResumeCount',
    ]) {
      for (final invalid in [null, -1, 1.5, '0', true]) {
        expect(
          () => NativeDraftSnapshot({...sample(), key: invalid}, 0),
          throwsStateError,
        );
      }
    }
    expect(
      () => NativeDraftSnapshot({...sample(), 'requests': null}, 0),
      throwsStateError,
    );
    expect(() => NativeDraftSnapshot(sample(), -1), throwsStateError);
    for (final trace in [
      ['invalid'],
      [
        {'sequence': 1, 'method': 3},
      ],
      [
        {'sequence': -1, 'method': 'thread/start'},
      ],
      [
        {'method': 'thread/start'},
      ],
      List.generate(257, (i) => {'sequence': i + 1, 'method': 'thread/read'}),
    ]) {
      expect(
        () => NativeDraftSnapshot({...sample(), 'requests': trace}, 0),
        throwsStateError,
      );
    }
  });
  test('quiet entry compares cumulative attempts as well as allocations', () {
    final before = NativeDraftSnapshot(sample(), 3);
    expect(
      () => before.expectQuiet(NativeDraftSnapshot(sample(), 3)),
      returnsNormally,
    );
    for (final key in [
      'applicationMessageCount',
      'requestSequence',
      'threadStartAttemptCount',
      'threadCount',
      'turnStartCount',
      'turnCount',
      'threadResumeCount',
    ]) {
      expect(
        () => before.expectQuiet(
          NativeDraftSnapshot({
            ...sample(),
            key: (sample()[key] as int) + 1,
          }, 3),
        ),
        throwsStateError,
      );
    }
    expect(
      () => before.expectQuiet(NativeDraftSnapshot(sample(), 4)),
      throwsStateError,
    );
  });
  test(
    'picker requires exactly two ordered methods, no hidden notification or Cloud attempt',
    () {
      final before = NativeDraftSnapshot(sample(), 0);
      final reads = [
        {'sequence': 1, 'method': 'project/quickLocations'},
        {'sequence': 2, 'method': 'project/listDirectory'},
      ];
      expect(
        () => before.expectPicker(
          NativeDraftSnapshot(sample(sequence: 2, requests: reads), 0),
        ),
        returnsNormally,
      );
      for (final requests in [
        reads.reversed.toList(),
        [
          ...reads,
          {'sequence': 3, 'method': 'skills/list'},
        ],
        [reads.first],
        [
          {'sequence': 1, 'method': 'thread/start'},
          reads.last,
        ],
      ]) {
        expect(
          () => before.expectPicker(
            NativeDraftSnapshot(
              sample(sequence: requests.length, requests: requests),
              0,
            ),
          ),
          throwsStateError,
        );
      }
      expect(
        () => before.expectPicker(
          NativeDraftSnapshot({
            ...sample(sequence: 2, requests: reads),
            'applicationMessageCount': 3,
          }, 0),
        ),
        throwsStateError,
      );
      expect(
        () => before.expectPicker(
          NativeDraftSnapshot(sample(sequence: 2, requests: reads), 1),
        ),
        throwsStateError,
      );
    },
  );
  test('trace gaps, overflow and decreasing counters refuse false success', () {
    final before = NativeDraftSnapshot(sample(), 0);
    for (final value in [
      sample(
        sequence: 2,
        requests: [
          {'sequence': 2, 'method': 'project/listDirectory'},
        ],
      ),
      sample(
        sequence: 2,
        requests: [
          {'sequence': 1, 'method': 'project/quickLocations'},
          {'sequence': 1, 'method': 'project/listDirectory'},
        ],
      ),
      sample(
        sequence: 257,
        requests: List.generate(
          256,
          (i) => {'sequence': i + 2, 'method': 'thread/read'},
        ),
      ),
    ]) {
      expect(
        () => before.methodsSince(NativeDraftSnapshot(value, 0)),
        throwsStateError,
      );
    }
    expect(
      () => NativeDraftSnapshot(sample(sequence: 2), 0).methodsSince(before),
      throwsStateError,
    );
  });
  test(
    'promotion requires exactly one attempt allocation initial turn and fixed actual shape',
    () {
      final before = NativeDraftSnapshot(sample(), 0);
      final promoted = {
        ...sample(
          sequence: 2,
          requests: [
            {'sequence': 1, 'method': 'thread/start'},
            {'sequence': 2, 'method': 'turn/start'},
          ],
        ),
        'threadStartAttemptCount': 1,
        'threadCount': 2,
        'turnStartCount': 1,
        'turnCount': 1,
        'lastThreadStartShape': {
          'cwdPresent': false,
          'cwdIsRoot': false,
          'djlScope': 'studio',
        },
        'lastTurn': {'threadId': 'real-2'},
      };
      expect(
        () => before.expectPromotion(
          NativeDraftSnapshot(promoted, 0),
          thread: 'real-2',
          project: false,
        ),
        returnsNormally,
      );
      for (final changed in [
        {'threadStartAttemptCount': 2},
        {'turnStartCount': 0},
        {'threadCount': 1},
        {
          'lastTurn': {'threadId': 'local-owner'},
        },
        {
          'lastThreadStartShape': {
            'cwdPresent': true,
            'cwdIsRoot': false,
            'djlScope': 'studio',
          },
        },
      ]) {
        expect(
          () => before.expectPromotion(
            NativeDraftSnapshot({...promoted, ...changed}, 0),
            thread: 'real-2',
            project: false,
          ),
          throwsStateError,
        );
      }
    },
  );
}
