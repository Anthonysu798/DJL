import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/foundation.dart';
import 'package:djl_mobile/features/status/data/status_surface.dart';
import '../../integration_test/support/native_status_acceptance.dart';

class Surface implements StatusSurface {
  final methods = <String>[];
  @override
  Future<bool> end(Map<String, Object?> payload) async {
    methods.add('end');
    return true;
  }

  @override
  Future<bool> update(Map<String, Object?> payload) async {
    methods.add('update');
    return true;
  }
}

Map<String, Object?> updateSample({
  bool updated = false,
  String platform = 'ios',
}) => {
  'supported': true,
  'platform': platform,
  'pid': 123,
  'count': 1,
  'genericPrivateFieldsAbsent': true,
  'nonsemanticAttributes': true,
  'readableGenericFieldsSafe': true,
  'publicGeneric': true,
  'privateVisibility': true,
  'channelLow': true,
  'contentIntentOwned': true,
  'contentIntentImmutable': true,
  'genericInitialOrder': !updated,
  'genericUpdatedOrder': updated,
};

void main() {
  group('native stale metadata diagnostics', () {
    Map<String, Object?> sample() => {
      ...updateSample(),
      'permissionAllowed': true,
      'deadlineMatches': true,
      'stale': false,
      'nativeObservedAtEpochMs': 1800000000000,
      'nativeStaleDateEpochMs': 1800000025000,
      'nativeActivityStateCode': 0,
    };
    test(
      'actual staleDate independently gates iOS hold and stays out of checkpoint',
      () {
        final messages = <String>[];
        final previous = debugPrint;
        debugPrint = (message, {wrapWidth}) {
          messages.add(message!);
        };
        addTearDown(() => debugPrint = previous);
        final valid = NativeStatusMeta.decode(sample());
        nativeStatusBeforeDeadlineHold(valid, 1800000025000);
        expect(valid.checkpoint, {'pid': 123, 'count': 1});
        expect(messages, [
          'DJL_STATUS_DIAG_BEFORE_HOLD nativeObservedAtEpochMs=1800000000000 nativeStaleDateEpochMs=1800000025000 nativeActivityStateCode=0',
        ]);
        for (final staleDate in [0, 1800000024999, 1800000025001]) {
          expect(
            () => nativeStatusBeforeDeadlineHold(
              NativeStatusMeta.decode({
                ...sample(),
                'nativeStaleDateEpochMs': staleDate,
              }),
              1800000025000,
            ),
            throwsStateError,
          );
        }
        final missing = sample()
          ..removeWhere((key, value) => key.startsWith('native'));
        expect(
          () => nativeStatusBeforeDeadlineHold(
            NativeStatusMeta.decode(missing),
            1800000025000,
          ),
          throwsStateError,
        );
        for (final override in [
          {'count': 0},
          {'permissionAllowed': false},
          {'deadlineMatches': false},
        ]) {
          expect(
            () => nativeStatusBeforeDeadlineHold(
              NativeStatusMeta.decode({...sample(), ...override}),
              1800000025000,
            ),
            throwsStateError,
          );
        }
        final android = NativeStatusMeta.decode({
          ...missing,
          'platform': 'android',
        });
        nativeStatusBeforeDeadlineHold(android, 1800000025000);
        expect(messages, hasLength(4));
      },
    );
    test(
      'all or none separate scalars preserve count bounds and refuse malformed metadata',
      () {
        NativeStatusMeta.decode(sample());
        for (final key in [
          'nativeObservedAtEpochMs',
          'nativeStaleDateEpochMs',
          'nativeActivityStateCode',
        ]) {
          expect(
            () => NativeStatusMeta.decode(sample()..remove(key)),
            throwsStateError,
          );
          for (final bad in [null, true, '1', 1.5, -1, 9007199254740992]) {
            expect(
              () => NativeStatusMeta.decode({...sample(), key: bad}),
              throwsStateError,
            );
          }
        }
        for (final override in [
          {'nativeObservedAtEpochMs': 0},
          {'nativeActivityStateCode': 5},
          {'nativeActivityStateCode': 1},
          {'stale': true},
          {'platform': 'android'},
          {'runningCount': 4},
          {'failedCount': -1},
          {'readyCount': 1800000000000},
          {'lineCount': 4},
          {'count': 2},
          {'privateRawState': 'secret'},
        ]) {
          expect(
            () => NativeStatusMeta.decode({...sample(), ...override}),
            throwsStateError,
          );
        }
        NativeStatusMeta.decode({
          ...sample(),
          'nativeObservedAtEpochMs': 9007199254740991,
          'nativeStaleDateEpochMs': 0,
          'nativeActivityStateCode': 4,
        });
        NativeStatusMeta.decode({
          ...sample(),
          'stale': true,
          'nativeActivityStateCode': 1,
        });
      },
    );
    test(
      'failed wait reads once with writes locked and propagates exact original failure and stack',
      () async {
        final messages = <String>[];
        final previous = debugPrint;
        debugPrint = (message, {wrapWidth}) {
          messages.add(message!);
        };
        addTearDown(() => debugPrint = previous);
        for (final changedPid in [false, true]) {
          final surface = Surface(), original = StateError('private original');
          final stack = StackTrace.fromString('private original stack');
          final session = NativeStatusSession(surface);
          var reads = 0;
          try {
            await session.holdDeadline(
              pid: 123,
              waitForHost: () => Future<void>.error(original, stack),
              readNative: () async {
                reads++;
                await expectLater(session.end(), throwsStateError);
                await expectLater(session.restart(), throwsStateError);
                await expectLater(
                  session.publish(nativeStatusPayload(1800000000000)),
                  throwsStateError,
                );
                await expectLater(session.attempt({}), throwsStateError);
                return NativeStatusMeta.decode({
                  ...sample(),
                  'pid': changedPid ? 124 : 123,
                });
              },
            );
            fail('must preserve host failure');
          } catch (error, trace) {
            expect(identical(error, original), true);
            expect(trace.toString(), stack.toString());
          }
          expect(reads, 1);
          expect(surface.methods, isEmpty);
          expect(
            messages.last,
            'DJL_STATUS_DIAG_AFTER_FAILED_HOLD nativeObservedAtEpochMs=1800000000000 nativeStaleDateEpochMs=1800000025000 nativeActivityStateCode=0 samePid=${!changedPid} noWrites=true',
          );
          await session.end();
          expect(surface.methods, ['end']);
        }
        expect(messages.join(), isNot(contains('private')));
      },
    );
    test(
      'successful iOS hold keeps its original read and stale acceptance without diagnostics',
      () async {
        final messages = <String>[];
        final previous = debugPrint;
        debugPrint = (message, {wrapWidth}) {
          messages.add(message!);
        };
        addTearDown(() => debugPrint = previous);
        final surface = Surface();
        final session = NativeStatusSession(surface);
        var reads = 0;
        final expected = NativeStatusMeta.decode({
          ...sample(),
          'stale': true,
          'nativeActivityStateCode': 1,
        });
        final result = await session.holdDeadline(
          pid: 123,
          waitForHost: () async {},
          readNative: () async {
            reads++;
            return expected;
          },
        );
        expect(result, same(expected));
        expect(reads, 1);
        expect(messages, isEmpty);
        expect(surface.methods, isEmpty);
      },
    );
    test(
      'failed hold read dispatch consumes the same two-second budget',
      () async {
        final messages = <String>[];
        final previous = debugPrint;
        debugPrint = (message, {wrapWidth}) {
          messages.add(message!);
        };
        addTearDown(() => debugPrint = previous);
        final session = NativeStatusSession(Surface());
        final original = StateError('private host error');
        var reads = 0;
        final watch = Stopwatch()..start();
        await expectLater(
          session.holdDeadline(
            pid: 123,
            waitForHost: () => Future<void>.error(original),
            readNative: () {
              reads++;
              final dispatch = Stopwatch()..start();
              while (dispatch.elapsed < const Duration(milliseconds: 1200)) {}
              return Future.delayed(
                const Duration(milliseconds: 1200),
                () => NativeStatusMeta.decode(sample()),
              );
            },
          ),
          throwsA(same(original)),
        );
        expect(reads, 1);
        expect(watch.elapsedMilliseconds, lessThan(2300));
        expect(messages, ['DJL_STATUS_DIAG_AFTER_FAILED_HOLD UNAVAILABLE']);
        await Future<void>.delayed(const Duration(milliseconds: 500));
        expect(messages, hasLength(1));
      },
    );
    for (final mode in ['throws', 'timeout', 'lateFailure', 'absent']) {
      test(
        'failed hold $mode emits only unavailable and keeps the original failure',
        () async {
          final messages = <String>[];
          final previous = debugPrint;
          debugPrint = (message, {wrapWidth}) {
            messages.add(message!);
          };
          addTearDown(() => debugPrint = previous);
          final session = NativeStatusSession(Surface());
          final original = StateError('private host error');
          final pending = Completer<NativeStatusMeta>();
          var reads = 0;
          final watch = Stopwatch()..start();
          await expectLater(
            session.holdDeadline(
              pid: 123,
              waitForHost: () => Future<void>.error(original),
              readNative: () {
                reads++;
                if (mode == 'throws') throw StateError('private probe error');
                if (mode == 'absent') {
                  return Future.value(NativeStatusMeta.decode(updateSample()));
                }
                return pending.future;
              },
            ),
            throwsA(same(original)),
          );
          watch.stop();
          expect(reads, 1);
          expect(messages, ['DJL_STATUS_DIAG_AFTER_FAILED_HOLD UNAVAILABLE']);
          if (mode == 'timeout' || mode == 'lateFailure') {
            expect(watch.elapsedMilliseconds, greaterThanOrEqualTo(1900));
            expect(watch.elapsedMilliseconds, lessThan(3000));
            if (mode == 'lateFailure') {
              pending.completeError(StateError('private late failure'));
            } else {
              pending.complete(NativeStatusMeta.decode(sample()));
            }
            await Future<void>.delayed(Duration.zero);
            expect(messages, hasLength(1));
          }
          await session.end();
        },
      );
    }
  });

  test(
    'public payloads use exact bounded generic and canonical detailed protocol',
    () {
      final now = DateTime.utc(2026).millisecondsSinceEpoch;
      final generic = nativeStatusPayload(now);
      final encoded = generic.toString();
      for (final text in [
        'threadId',
        'title',
        'detail:',
        'url',
        'macId',
        'qa-status-public-',
      ]) {
        expect(encoded, isNot(contains(text)));
      }
      final detailed = nativeStatusPayload(now, detailed: true);
      final row =
          ((detailed['buckets'] as Map)['running'] as List).first as Map;
      expect(row['url'], nativeStatusPublicURL.toString());
      final deadline = nativeStatusPayload(
        now,
        detailed: true,
        shortDeadline: true,
      );
      expect(deadline['nextDeadline'], now + 25000);
      expect(((deadline['buckets'] as Map)['running'] as List), hasLength(3));
    },
  );
  test('generic opening permits ordinary home but never a thread route', () {
    expect(nativeStatusOrdinaryOpen([]), true);
    expect(nativeStatusOrdinaryOpen([Uri.parse('djl://home')]), true);
    expect(nativeStatusOrdinaryOpen([nativeStatusPublicURL]), false);
    expect(
      nativeStatusOrdinaryOpen([Uri.parse('djl://thread/private')]),
      false,
    );
  });
  test(
    'native metadata refuses raw fields and generic privacy false positives',
    () {
      expect(
        () => NativeStatusMeta.decode({
          'platform': 'ios',
          'pid': 123,
          'count': 1,
          'url': 'private',
        }),
        throwsStateError,
      );
      final ios = NativeStatusMeta.decode({
        'supported': true,
        'platform': 'ios',
        'pid': 123,
        'count': 1,
        'genericPrivateFieldsAbsent': false,
        'nonsemanticAttributes': true,
      });
      expect(ios.genericSafe, false);
      final android = NativeStatusMeta.decode({
        'supported': true,
        'platform': 'android',
        'pid': 123,
        'count': 1,
        'readableGenericFieldsSafe': true,
        'publicGeneric': true,
        'privateVisibility': true,
        'channelLow': true,
        'contentIntentOwned': true,
        'contentIntentImmutable': false,
      });
      expect(android.genericSafe, false);
    },
  );
  test(
    'deadline hold prohibits writes and queries same PID before any later end',
    () async {
      final surface = Surface();
      final session = NativeStatusSession(surface);
      await session.restart();
      await session.publish(
        nativeStatusPayload(
          DateTime.now().millisecondsSinceEpoch,
          shortDeadline: true,
        ),
      );
      final before = List.of(surface.methods);
      final held = Completer<void>();
      final release = Completer<void>();
      var reads = 0;
      final result = session.holdDeadline(
        pid: 123,
        waitForHost: () async {
          held.complete();
          await release.future;
        },
        readNative: () async {
          reads++;
          return NativeStatusMeta.decode({
            'supported': true,
            'platform': 'android',
            'pid': 123,
            'count': 0,
            'permissionAllowed': true,
          });
        },
      );
      await held.future;
      await expectLater(session.end(), throwsStateError);
      await expectLater(
        session.publish(
          nativeStatusPayload(DateTime.now().millisecondsSinceEpoch),
        ),
        throwsStateError,
      );
      expect(surface.methods, before);
      expect(reads, 0);
      release.complete();
      final after = await result;
      expect(after.count, 0);
      expect(reads, 1);
      expect(surface.methods, before);
      await session.end();
      expect(surface.methods.last, 'end');
    },
  );
  test(
    'restart or wrong native expiry cannot satisfy suspended deadline',
    () async {
      for (final raw in [
        {
          'supported': true,
          'platform': 'android',
          'pid': 124,
          'count': 0,
          'permissionAllowed': true,
        },
        {
          'supported': true,
          'platform': 'android',
          'pid': 123,
          'count': 1,
          'permissionAllowed': true,
        },
        {
          'supported': true,
          'platform': 'ios',
          'pid': 123,
          'count': 1,
          'stale': false,
          'permissionAllowed': true,
        },
      ]) {
        final session = NativeStatusSession(Surface());
        await expectLater(
          session.holdDeadline(
            pid: 123,
            waitForHost: () async {},
            readNative: () async => NativeStatusMeta.decode(raw),
          ),
          throwsStateError,
        );
      }
    },
  );
  test(
    'permission or channel denial cannot masquerade as native timeout',
    () async {
      final session = NativeStatusSession(Surface());
      await expectLater(
        session.holdDeadline(
          pid: 123,
          waitForHost: () async {},
          readNative: () async => NativeStatusMeta.decode({
            'supported': true,
            'platform': 'android',
            'pid': 123,
            'count': 0,
            'permissionAllowed': false,
          }),
        ),
        throwsStateError,
      );
    },
  );

  group('bounded generic update observation', () {
    for (final platform in ['ios', 'android']) {
      test(
        '$platform exact updated first returns the same sample without ticking',
        () async {
          final updated = NativeStatusMeta.decode(
            updateSample(updated: true, platform: platform),
          );
          var reads = 0, ticks = 0;
          final result = await nativeStatusObserveGenericUpdate(
            expectedPid: 123,
            expectedPlatform: platform,
            read: () async {
              reads++;
              return updated;
            },
            tick: (_) async {
              ticks++;
            },
          );
          expect(identical(result, updated), true);
          expect(
            result.genericSafe && result.flag('genericUpdatedOrder'),
            true,
          );
          expect(reads, 1);
          expect(ticks, 0);
        },
      );
    }
    test(
      'initial initial updated converges without changing the exact oracle',
      () async {
        var elapsed = Duration.zero, reads = 0;
        final ticks = <Duration>[];
        final result = await nativeStatusObserveGenericUpdate(
          expectedPid: 123,
          expectedPlatform: 'ios',
          read: () async =>
              NativeStatusMeta.decode(updateSample(updated: ++reads == 3)),
          tick: (duration) async {
            ticks.add(duration);
            elapsed += duration;
          },
          elapsed: () => elapsed,
        );
        expect(result.genericSafe && result.flag('genericUpdatedOrder'), true);
        expect(reads, 3);
        expect(ticks, [
          const Duration(milliseconds: 200),
          const Duration(milliseconds: 200),
        ]);
      },
    );
    test(
      'permanent initial exhausts two seconds without a read at the deadline',
      () async {
        var elapsed = Duration.zero, reads = 0, ticks = 0;
        await expectLater(
          nativeStatusObserveGenericUpdate(
            expectedPid: 123,
            expectedPlatform: 'ios',
            read: () async {
              reads++;
              return NativeStatusMeta.decode(updateSample());
            },
            tick: (duration) async {
              ticks++;
              elapsed += duration;
            },
            elapsed: () => elapsed,
          ),
          throwsStateError,
        );
        expect(elapsed, const Duration(seconds: 2));
        expect(reads, 10);
        expect(ticks, 10);
      },
    );
    final invalid = <String, Map<String, Object?>>{
      'neither order': {
        'genericInitialOrder': false,
        'genericUpdatedOrder': false,
      },
      'private': {'genericPrivateFieldsAbsent': false},
      'semantic identity': {'nonsemanticAttributes': false},
      'wrong PID': {'pid': 124},
      'wrong platform': {'platform': 'android'},
      'zero count': {'count': 0},
      'two count': {'count': 2},
      'unsupported': {'supported': false},
      'unknown schema field': {'schemaVersion': 2},
      'invalid flag type': {'genericUpdatedOrder': 1},
    };
    for (final entry in invalid.entries) {
      for (final intermediate in [false, true]) {
        test(
          '${entry.key} ${intermediate ? 'intermediate' : 'first'} refuses before later good sample',
          () async {
            var elapsed = Duration.zero, reads = 0, ticks = 0;
            final badRead = intermediate ? 2 : 1;
            await expectLater(
              nativeStatusObserveGenericUpdate(
                expectedPid: 123,
                expectedPlatform: 'ios',
                read: () async {
                  reads++;
                  return NativeStatusMeta.decode({
                    ...updateSample(updated: reads > badRead),
                    if (reads == badRead) ...entry.value,
                  });
                },
                tick: (duration) async {
                  ticks++;
                  elapsed += duration;
                },
                elapsed: () => elapsed,
              ),
              throwsStateError,
            );
            expect(reads, badRead);
            expect(ticks, intermediate ? 1 : 0);
          },
        );
      }
    }
    for (final entry in {
      'private': {'genericPrivateFieldsAbsent': false},
      'wrong PID': {'pid': 124},
      'wrong platform': {'platform': 'android'},
      'zero count': {'count': 0},
    }.entries) {
      test('updated flag cannot bypass ${entry.key} guard', () async {
        await expectLater(
          nativeStatusObserveGenericUpdate(
            expectedPid: 123,
            expectedPlatform: 'ios',
            read: () async => NativeStatusMeta.decode({
              ...updateSample(updated: true),
              ...entry.value,
            }),
            tick: (_) async =>
                fail('Invalid updated sample must fail immediately'),
            elapsed: () => Duration.zero,
          ),
          throwsStateError,
        );
      });
    }
    test('expired budget before first read dispatches no operation', () async {
      var clockReads = 0, reads = 0, ticks = 0;
      await expectLater(
        nativeStatusObserveGenericUpdate(
          expectedPid: 123,
          expectedPlatform: 'ios',
          read: () async {
            reads++;
            return NativeStatusMeta.decode(updateSample(updated: true));
          },
          tick: (_) async {
            ticks++;
          },
          elapsed: () =>
              clockReads++ == 0 ? Duration.zero : const Duration(seconds: 2),
        ),
        throwsStateError,
      );
      expect(reads, 0);
      expect(ticks, 0);
    });
    test(
      'arbitrary monotonic origins retain the same two-second budget',
      () async {
        for (final origin in [
          const Duration(days: -36500),
          const Duration(days: 36500),
        ]) {
          var elapsed = origin, reads = 0;
          await expectLater(
            nativeStatusObserveGenericUpdate(
              expectedPid: 123,
              expectedPlatform: 'ios',
              read: () async {
                reads++;
                return NativeStatusMeta.decode(updateSample());
              },
              tick: (duration) async {
                elapsed += duration;
              },
              elapsed: () => elapsed,
            ),
            throwsStateError,
          );
          expect(reads, 10);
          expect(elapsed - origin, const Duration(seconds: 2));
        }
      },
    );
    test('unavailable read fails once with no tick', () async {
      var reads = 0, ticks = 0;
      await expectLater(
        nativeStatusObserveGenericUpdate(
          expectedPid: 123,
          expectedPlatform: 'ios',
          read: () async {
            reads++;
            throw StateError('Native status read-only observer unavailable.');
          },
          tick: (_) async {
            ticks++;
          },
          elapsed: () => Duration.zero,
        ),
        throwsStateError,
      );
      expect(reads, 1);
      expect(ticks, 0);
    });
    for (final micros in [1999999, 2000000, 2000001]) {
      test(
        'updated read at $micros microseconds respects strict ceiling',
        () async {
          var elapsed = Duration.zero;
          final result = nativeStatusObserveGenericUpdate(
            expectedPid: 123,
            expectedPlatform: 'ios',
            read: () async {
              elapsed = Duration(microseconds: micros);
              return NativeStatusMeta.decode(updateSample(updated: true));
            },
            tick: (_) async => fail('Updated reads must not tick'),
            elapsed: () => elapsed,
          );
          if (micros < 2000000) {
            expect((await result).flag('genericUpdatedOrder'), true);
          } else {
            await expectLater(result, throwsStateError);
          }
        },
      );
    }
    test(
      'tick is clamped to remaining budget and late tick cannot read again',
      () async {
        var elapsed = Duration.zero, reads = 0;
        final ticks = <Duration>[];
        await expectLater(
          nativeStatusObserveGenericUpdate(
            expectedPid: 123,
            expectedPlatform: 'ios',
            read: () async {
              reads++;
              elapsed = const Duration(milliseconds: 1950);
              return NativeStatusMeta.decode(updateSample());
            },
            tick: (duration) async {
              ticks.add(duration);
              elapsed += const Duration(milliseconds: 51);
            },
            elapsed: () => elapsed,
          ),
          throwsStateError,
        );
        expect(reads, 1);
        expect(ticks, [const Duration(milliseconds: 50)]);
      },
    );
    for (final lateError in [false, true]) {
      testWidgets(
        'hung read times out and late ${lateError ? 'error' : 'success'} is consumed',
        (tester) async {
          final pending = Completer<NativeStatusMeta>();
          var elapsed = Duration.zero, reads = 0, ticks = 0;
          final result = nativeStatusObserveGenericUpdate(
            expectedPid: 123,
            expectedPlatform: 'ios',
            read: () {
              reads++;
              return pending.future;
            },
            tick: (_) async {
              ticks++;
            },
            elapsed: () => elapsed,
          );
          final refused = expectLater(result, throwsStateError);
          elapsed = const Duration(seconds: 2);
          await tester.pump(const Duration(seconds: 2));
          await refused;
          if (lateError) {
            pending.completeError(StateError('Late public test failure'));
          } else {
            pending.complete(
              NativeStatusMeta.decode(updateSample(updated: true)),
            );
          }
          await tester.pump();
          expect(reads, 1);
          expect(ticks, 0);
        },
      );
    }
    for (final boundary in ['read', 'tick']) {
      testWidgets(
        '$boundary dispatch time is deducted from its pending timeout',
        (tester) async {
          final pendingRead = Completer<NativeStatusMeta>();
          final pendingTick = Completer<void>();
          var elapsed = Duration.zero, reads = 0, ticks = 0;
          Object? failure;
          var succeeded = false;
          final result = nativeStatusObserveGenericUpdate(
            expectedPid: 123,
            expectedPlatform: 'ios',
            read: () {
              reads++;
              if (boundary == 'read') {
                elapsed = const Duration(milliseconds: 1950);
                return pendingRead.future;
              }
              return Future.value(NativeStatusMeta.decode(updateSample()));
            },
            tick: (_) {
              ticks++;
              elapsed = const Duration(milliseconds: 1950);
              return pendingTick.future;
            },
            elapsed: () => elapsed,
          );
          final observed = result.then<void>(
            (_) {
              succeeded = true;
            },
            onError: (Object error) {
              failure = error;
            },
          );
          await tester.pump();
          elapsed = const Duration(seconds: 2);
          await tester.pump(const Duration(milliseconds: 50));
          expect(failure, isStateError);
          expect(succeeded, false);
          pendingRead.complete(
            NativeStatusMeta.decode(updateSample(updated: true)),
          );
          pendingTick.complete();
          await tester.pump();
          await observed;
          expect(reads, 1);
          expect(ticks, boundary == 'read' ? 0 : 1);
          expect(succeeded, false);
        },
      );
    }
    testWidgets(
      'hung tick is bounded by remaining budget and late error is consumed',
      (tester) async {
        final pending = Completer<void>();
        var elapsed = Duration.zero, reads = 0;
        final ticks = <Duration>[];
        final result = nativeStatusObserveGenericUpdate(
          expectedPid: 123,
          expectedPlatform: 'ios',
          read: () async {
            reads++;
            elapsed = const Duration(milliseconds: 1950);
            return NativeStatusMeta.decode(updateSample());
          },
          tick: (duration) {
            ticks.add(duration);
            return pending.future;
          },
          elapsed: () => elapsed,
        );
        final refused = expectLater(result, throwsStateError);
        await tester.pump();
        elapsed = const Duration(seconds: 2);
        await tester.pump(const Duration(milliseconds: 50));
        await refused;
        pending.completeError(StateError('Late public test failure'));
        await tester.pump();
        expect(reads, 1);
        expect(ticks, [const Duration(milliseconds: 50)]);
      },
    );
  });
}
