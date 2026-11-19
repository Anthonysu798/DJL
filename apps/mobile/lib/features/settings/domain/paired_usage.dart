import 'package:uuid/uuid.dart';

class PairedUsageWindow {
  const PairedUsageWindow({
    required this.usedPercent,
    this.minutes,
    this.resetsAt,
  });
  final int usedPercent;
  final int? minutes;
  final DateTime? resetsAt;
  int get clampedUsedPercent => usedPercent.clamp(0, 100).toInt();
  int get remainingPercent => 100 - clampedUsedPercent;
}

class PairedUsageRow {
  const PairedUsageRow(this.id, this.label, this.window);
  final String id, label;
  final PairedUsageWindow window;
}

class PairedUsageBucket {
  const PairedUsageBucket({
    required this.id,
    this.name,
    this.primary,
    this.secondary,
  });
  final String id;
  final String? name;
  final PairedUsageWindow? primary, secondary;
  PairedUsageWindow? get first => primary ?? secondary;
  String get label => _label(first?.minutes) ?? name ?? id;
  List<PairedUsageRow> get rows => [
    if (primary != null)
      PairedUsageRow(
        '$id-primary',
        _label(primary!.minutes) ?? name ?? id,
        primary!,
      ),
    if (secondary != null)
      PairedUsageRow(
        '$id-secondary',
        _label(secondary!.minutes) ?? name ?? id,
        secondary!,
      ),
  ];
  static List<PairedUsageRow> visibleRows(List<PairedUsageBucket> buckets) {
    final values = <String, PairedUsageRow>{};
    for (final row in buckets.expand((b) => b.rows)) {
      final old = values[row.label];
      if (old == null ||
          row.window.clampedUsedPercent > old.window.clampedUsedPercent ||
          row.window.clampedUsedPercent == old.window.clampedUsedPercent &&
              row.window.resetsAt != null &&
              (old.window.resetsAt == null ||
                  row.window.resetsAt!.isBefore(old.window.resetsAt!))) {
        values[row.label] = row;
      }
    }
    return values.values.toList()..sort((a, b) {
      final duration = _compareMinutes(a.window.minutes, b.window.minutes);
      return duration != 0
          ? duration
          : a.label.toLowerCase().compareTo(b.label.toLowerCase());
    });
  }
}

String? _label(int? minutes) {
  if (minutes == null || minutes <= 0) return null;
  if (minutes % 10080 == 0) {
    return minutes == 10080 ? 'Weekly' : '${minutes ~/ 10080}w';
  }
  if (minutes % 1440 == 0) return '${minutes ~/ 1440}d';
  if (minutes % 60 == 0) return '${minutes ~/ 60}h';
  return '${minutes}m';
}

int _compareMinutes(int? a, int? b) => a == null
    ? (b == null ? 0 : 1)
    : b == null
    ? -1
    : a.compareTo(b);

List<PairedUsageBucket> decodePairedUsage(Object? payload) {
  var object = _map(payload);
  while (object != null) {
    final keyed =
        _map(object['rateLimitsByLimitId']) ??
        _map(object['rate_limits_by_limit_id']);
    if (keyed != null) {
      return _sort([
        for (final entry in keyed.entries) ?_bucket(entry.key, entry.value),
      ]);
    }
    final nested = _map(object['rateLimits']) ?? _map(object['rate_limits']);
    if (nested != null) {
      if (_direct(nested)) return _sort(_directBuckets(nested));
      final bucket = _bucket(null, nested);
      if (bucket != null) return [bucket];
    }
    final result = _map(object['result']);
    if (result != null) {
      object = result;
      continue;
    }
    return _direct(object) ? _sort(_directBuckets(object)) : [];
  }
  return [];
}

List<PairedUsageBucket> mergePairedUsage(
  List<PairedUsageBucket> old,
  List<PairedUsageBucket> incoming,
) {
  final values = {for (final bucket in old) bucket.id: bucket};
  for (final bucket in incoming) {
    final previous = values[bucket.id];
    values[bucket.id] = PairedUsageBucket(
      id: bucket.id,
      name: bucket.name ?? previous?.name,
      primary: bucket.primary ?? previous?.primary,
      secondary: bucket.secondary ?? previous?.secondary,
    );
  }
  return _sort(values.values.toList());
}

List<PairedUsageBucket> _sort(List<PairedUsageBucket> buckets) =>
    buckets..sort((a, b) {
      final duration = _compareMinutes(a.first?.minutes, b.first?.minutes);
      return duration != 0
          ? duration
          : a.label.toLowerCase().compareTo(b.label.toLowerCase());
    });
Map<String, dynamic>? _map(Object? value) =>
    value is Map && value.keys.every((key) => key is String)
    ? Map<String, dynamic>.from(value)
    : null;
Object? _windowValue(Map<String, dynamic> object, String key) =>
    object.containsKey(key) ? object[key] : object['${key}_window'];
bool _direct(Map<String, dynamic> object) => [
  'primary',
  'secondary',
  'primary_window',
  'secondary_window',
].any(object.containsKey);
List<PairedUsageBucket> _directBuckets(Map<String, dynamic> object) => [
  if (_window(_windowValue(object, 'primary')) case final window?)
    PairedUsageBucket(
      id: 'primary',
      name: _string([
        object['limitName'],
        object['limit_name'],
        object['name'],
      ]),
      primary: window,
    ),
  if (_window(_windowValue(object, 'secondary')) case final window?)
    PairedUsageBucket(
      id: 'secondary',
      name: _string([object['secondaryName'], object['secondary_name']]),
      primary: window,
    ),
];
PairedUsageBucket? _bucket(String? key, Object? value) {
  final object = _map(value);
  if (object == null) return null;
  final primary = _window(_windowValue(object, 'primary'));
  final secondary = _window(_windowValue(object, 'secondary'));
  if (primary == null && secondary == null) return null;
  return PairedUsageBucket(
    id:
        _string([key, object['limitId'], object['limit_id'], object['id']]) ??
        const Uuid().v4(),
    name: _string([object['limitName'], object['limit_name'], object['name']]),
    primary: primary,
    secondary: secondary,
  );
}

PairedUsageWindow? _window(Object? value) {
  final object = _map(value);
  if (object == null) return null;
  return PairedUsageWindow(
    usedPercent: _integer([object['usedPercent'], object['used_percent']]) ?? 0,
    minutes: _integer([
      object['windowDurationMins'],
      object['window_duration_mins'],
      object['windowMinutes'],
      object['window_minutes'],
    ]),
    resetsAt: _resetAt(object),
  );
}

String? _string(Iterable<Object?> values) {
  for (final value in values) {
    if (value is String && value.trim().isNotEmpty) return value.trim();
  }
  return null;
}

int? _integer(Iterable<Object?> values) {
  for (final value in values) {
    if (value is num && value.isFinite) return value.toInt();
    if (value is String) {
      final number = int.tryParse(value.trim(), radix: 10);
      if (number != null) return number;
    }
  }
  return null;
}

DateTime? _resetAt(Map<String, dynamic> object) {
  final values = [
    for (final key in ['resetsAt', 'resets_at', 'resetAt', 'reset_at'])
      object[key],
  ];
  for (final value in values) {
    if (value is num && value.isFinite) {
      final milliseconds = value > 10000000000 ? value : value * 1000;
      if (milliseconds.abs() > 8640000000000000) return null;
      return DateTime.fromMillisecondsSinceEpoch(
        milliseconds.toInt(),
        isUtc: true,
      );
    }
  }
  final text = _string(values);
  return text == null ? null : DateTime.tryParse(text);
}
