import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_response_footer.dart';

void main() {
  test('fix1 history watermark must also precede the interrupt revision', () {
    final lifecycle = DesktopResponseLifecycle();
    lifecycle.starting('thread', 'turn');
    final beforeInterrupt = lifecycle.revision;
    lifecycle.interrupt('thread', 'turn');
    lifecycle.history('thread', [
      {'id': 'turn', 'status': 'completed'},
    ], beforeInterrupt);
    expect(lifecycle.facts('thread').interrupting, {'turn'});
    expect(lifecycle.facts('thread').suppressesLatest, isTrue);
    final afterInterrupt = lifecycle.revision;
    lifecycle.history('thread', [
      {'id': 'turn', 'status': 'completed'},
    ], afterInterrupt);
    expect(lifecycle.facts('thread').interrupting, isEmpty);
  });

  for (final alias in [
    'cancelled',
    'canceled',
    'ABORTED',
    ' interrupted ',
    'user_stopped',
    'user-stopped',
  ]) {
    test('received stop alias $alias suppresses history and live', () {
      expect(
        desktopResponseHistoryOutcome({'status': alias}),
        DesktopResponseOutcome.stopped,
      );
      expect(
        desktopResponseLiveOutcome({
          'turn': {'status': alias},
        }),
        DesktopResponseOutcome.stopped,
      );
    });
  }
  for (final alias in ['idle', 'notloaded', 'completed', 'done', 'finished']) {
    test(
      'received completion alias $alias supports string and object status',
      () {
        expect(
          desktopResponseHistoryOutcome({
            'status': {'status_type': alias},
          }),
          DesktopResponseOutcome.completed,
        );
        expect(
          desktopResponseLiveOutcome({
            'event': {
              'status': {'type': alias},
            },
          }),
          DesktopResponseOutcome.completed,
        );
      },
    );
  }
  test(
    'failure message takes precedence and history result aliases are explicit',
    () {
      expect(
        desktopResponseLiveOutcome({
          'turn': {
            'status': 'completed',
            'error': {'message': 'Request failed'},
          },
        }),
        DesktopResponseOutcome.failed,
      );
      expect(
        desktopResponseHistoryOutcome({'result': 'failed'}),
        DesktopResponseOutcome.failed,
      );
      expect(
        desktopResponseHistoryOutcome({
          'status': {'statusType': 'in_progress'},
        }),
        DesktopResponseOutcome.running,
      );
    },
  );
  test(
    'absent unknown malformed and recognizable synthetic statuses stay unknown',
    () {
      for (final value in <Map<String, dynamic>>[
        {},
        {'status': ''},
        {'status': 'unexpected'},
        {'status': 7},
        {
          'status': {'type': 42},
        },
        {'status': 'completed', 'djlHistoryCompacted': true},
        {'status': 'completed', 'djlSynthetic': true},
        {'status': 'completed', 'id': 'djl-history-compacted-one'},
        {'status': 'completed', 'synthetic': true},
        {'status': 'completed', 'isSynthetic': true},
      ]) {
        expect(
          desktopResponseHistoryOutcome(value),
          DesktopResponseOutcome.unknown,
        );
      }
      expect(desktopResponseLiveOutcome({}), DesktopResponseOutcome.unknown);
      expect(
        desktopResponseLiveOutcome({'status': 'unrecognized'}),
        DesktopResponseOutcome.unknown,
      );
    },
  );
}
