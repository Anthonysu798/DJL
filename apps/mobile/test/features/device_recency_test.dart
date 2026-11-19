import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/domain/device_recency.dart';

void main() {
  final now = DateTime.utc(2026, 11, 6, 12);
  test(
    'device recency uses compact observed age and truthful future clock skew',
    () {
      for (final sample in [
        (const Duration(seconds: 30), 'now'),
        (const Duration(minutes: 2), '2m ago'),
        (const Duration(hours: 2), '2h ago'),
        (const Duration(days: 3), '3d ago'),
        (const Duration(minutes: -2), 'in 2m'),
        (const Duration(days: -3), 'in 3d'),
      ]) {
        expect(deviceRecencyLabel(now.subtract(sample.$1), now), sample.$2);
      }
    },
  );
}
