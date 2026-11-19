import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/settings/domain/paired_usage.dart';

void main() {
  test('Swift keyed windows retain durations, percentages and reset units', () {
    final buckets = decodePairedUsage({
      'rateLimitsByLimitId': {
        'codex_7d': {
          'primary': {
            'usedPercent': 6,
            'windowDurationMins': 10080,
            'resetsAt': 1742500000000,
          },
        },
        'codex_5h': {
          'limitName': 'Codex',
          'primary': {
            'usedPercent': 3,
            'windowDurationMins': 300,
            'resetsAt': 1742000000,
          },
        },
      },
    });
    expect(buckets.map((b) => b.id), ['codex_5h', 'codex_7d']);
    final rows = PairedUsageBucket.visibleRows(buckets);
    expect(rows.map((r) => r.label), ['5h', 'Weekly']);
    expect(rows.map((r) => r.window.remainingPercent), [97, 94]);
    expect(
      rows.first.window.resetsAt,
      DateTime.fromMillisecondsSinceEpoch(1742000000000, isUtc: true),
    );
    expect(
      rows.last.window.resetsAt,
      DateTime.fromMillisecondsSinceEpoch(1742500000000, isUtc: true),
    );
  });

  test('direct snake-case windows and nested results follow the source', () {
    final rows = PairedUsageBucket.visibleRows(
      decodePairedUsage({
        'result': {
          'rate_limits': {
            'primary_window': {
              'used_percent': ' 110 ',
              'window_minutes': 300.9,
            },
            'secondary_window': {
              'used_percent': -5,
              'window_duration_mins': 10080,
              'resets_at': '2025-03-15T12:30:00Z',
            },
          },
        },
      }),
    );
    expect(rows.map((r) => r.label), ['5h', 'Weekly']);
    expect(rows.map((r) => r.window.remainingPercent), [0, 100]);
    expect(rows.last.window.resetsAt, DateTime.utc(2025, 3, 15, 12, 30));
  });

  test(
    'duplicate visible windows choose higher usage then the earlier reset',
    () {
      final rows = PairedUsageBucket.visibleRows(
        decodePairedUsage({
          'rateLimitsByLimitId': {
            'low': {
              'primary': {'usedPercent': 20, 'windowDurationMins': 300},
            },
            'high-late': {
              'primary': {
                'usedPercent': 40,
                'windowDurationMins': 300,
                'resetsAt': 1742500000,
              },
            },
            'high-early': {
              'primary': {
                'usedPercent': 40,
                'windowDurationMins': 300,
                'resetsAt': 1742000000,
              },
            },
          },
        }),
      );
      expect(rows, hasLength(1));
      expect(rows.single.window.remainingPercent, 60);
      expect(
        rows.single.window.resetsAt,
        DateTime.fromMillisecondsSinceEpoch(1742000000000, isUtc: true),
      );
    },
  );

  test('partial updates keep the other window and merge by limit identity', () {
    final old = decodePairedUsage({
      'rateLimitsByLimitId': {
        'plan': {
          'limitName': 'Plan',
          'primary': {'usedPercent': 10, 'windowDurationMins': 300},
          'secondary': {'usedPercent': 30, 'windowDurationMins': 10080},
        },
      },
    });
    final merged = mergePairedUsage(
      old,
      decodePairedUsage({
        'rateLimitsByLimitId': {
          'plan': {
            'primary': {'usedPercent': 25, 'windowDurationMins': 300},
          },
        },
      }),
    );
    expect(merged.single.name, 'Plan');
    expect(
      PairedUsageBucket.visibleRows(
        merged,
      ).map((r) => r.window.remainingPercent),
      [75, 70],
    );
    expect(mergePairedUsage(merged, []), merged);
  });

  test(
    'malformed windows stay unavailable and valid empty windows use source defaults',
    () {
      expect(
        decodePairedUsage({
          'rateLimits': {'primary': 'invalid'},
        }),
        isEmpty,
      );
      expect(decodePairedUsage({'rateLimitsByLimitId': {}}), isEmpty);
      final rows = PairedUsageBucket.visibleRows(
        decodePairedUsage({'primary': {}}),
      );
      expect(rows.single.label, 'primary');
      expect(rows.single.window.remainingPercent, 100);
      expect(rows.single.window.resetsAt, isNull);
    },
  );
}
