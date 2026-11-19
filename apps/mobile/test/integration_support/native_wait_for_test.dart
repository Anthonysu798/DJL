import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/cloud_test.dart' show waitFor;

void main() {
  testWidgets(
    'zero-timeout readiness failure preserves the original service assertion under ordinary binding',
    (tester) async {
      await tester.pumpWidget(const SizedBox());
      await expectLater(
        waitFor(tester, () => false, timeout: Duration.zero),
        throwsA(
          isA<TestFailure>().having(
            (error) => error.message,
            'service assertion',
            contains(
              'The native service journey did not reach its expected state.',
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'ready service helper succeeds without native screenshot binding',
    (tester) async {
      await tester.pumpWidget(const SizedBox());
      await waitFor(tester, () => true, timeout: Duration.zero);
      expect(tester.takeException(), isNull);
    },
  );
}
