import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'desktop_history_reconciliation_test.dart' show historyDesktop;
import 'desktop_plan_widgets_test.dart' show PlanActionTransport;
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';

void main() {
  for (final source in <String?>[
    null,
    'native',
    'requested',
    'compatibilityFallback',
  ]) {
    test(
      'plain proposal heuristic requires saved compatibility provenance: $source',
      () async {
        const body =
            '# Implementation plan\n1. Inspect the source\n2. Verify the result';
        final d = await historyDesktop(PlanActionTransport(), [
          {'id': 'a', 'type': 'agentMessage', 'turnId': 'ended', 'text': body},
        ]);
        addTearDown(d.dispose);
        if (source != null) {
          d.threadList.data.planSessions['thread'] = {
            'identityPin': d.active!.data['macIdentityPublicKey'],
            'source': source,
          };
        }
        expect(
          d.responsePlanProposal(d.timeline.single)?.body,
          source == 'compatibilityFallback' ? body : null,
        );
      },
    );
  }
  test(
    'saved compatibility provenance survives existing encrypted-state encoding',
    () {
      final value = {
        'planSessions': {
          'thread': {
            'identityPin': 'trusted-pin',
            'source': 'compatibilityFallback',
          },
        },
      };
      final restored = ThreadLocalState.fromJson(value);
      expect(
        restored.planSessions['thread']?['source'],
        'compatibilityFallback',
      );
      expect(
        ThreadLocalState.fromJson(restored.toJson()).planSessions,
        restored.planSessions,
      );
    },
  );

  test(
    'saved legacy compatibility state does not suppress its explicit proposal',
    () async {
      final d = await historyDesktop(PlanActionTransport(), [
        {
          'id': 'a',
          'type': 'agentMessage',
          'turnId': 'ended',
          'text': '<proposed_plan>Legacy proposal</proposed_plan>',
        },
      ]);
      addTearDown(d.dispose);
      d.threadList.data.planSessions['thread'] = {
        'identityPin': d.active!.data['macIdentityPublicKey'],
        'source': 'compatibilityFallback',
      };
      expect(d.usesNativePlanPresentation, isFalse);
      expect(
        d.responsePlanProposal(d.timeline.single)?.body,
        'Legacy proposal',
      );
    },
  );
}
