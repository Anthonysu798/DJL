import 'dart:convert';
import 'package:http/http.dart' as http;
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import '../fixtures/cloud_usage_fixture.dart';

void main() {
  test(
    'A send during confirmed reset cannot replace or post over its pending message',
    () async {
      final f = CloudUsageFixture();
      addTearDown(f.dispose);
      await f.chat.initialize();
      await f.chat.send('original');
      await f.chat.refreshUsage();
      final gate = Completer<http.Response>();
      f.redemptionGate = gate;
      final pending = f.chat.redeemUsageReset();
      addTearDown(() async {
        if (!gate.isCompleted) {
          gate.complete(http.Response('{"error":{"message":"cleanup"}}', 503));
        }
        await pending;
      });
      await Future<void>.delayed(Duration.zero);
      f.chat.updateComposerDraft('newer unsent');
      expect(await f.chat.send('newer unsent'), false);
      expect(
        f.messages.length,
        1,
        reason:
            'The confirmed reset owns the pending attempt until its result.',
      );
      gate.complete(
        http.Response(
          '{"error":{"code":"unavailable","message":"Try again"}}',
          503,
        ),
      );
      await pending;
      expect(f.chat.composerDraft, 'newer unsent');
    },
  );

  test(
    'Recovery clears only attachments belonging to the accepted pending send',
    () async {
      final f = CloudUsageFixture();
      addTearDown(f.dispose);
      await f.chat.initialize();
      f.chat.attachments.add({
        'type': 'file_ref',
        'fileId': 'old',
        'name': 'old.txt',
        'mimeType': 'text/plain',
        'size': 1,
        '_displayName': 'old.txt',
      });
      expect(await f.chat.send('pending file'), false);
      await f.chat.refreshUsage();
      f.chat.attachments.add({
        'type': 'file_ref',
        'fileId': 'new',
        'name': 'new.txt',
        'mimeType': 'text/plain',
        'size': 1,
        '_displayName': 'new.txt',
      });
      await f.chat.redeemUsageReset();
      expect(f.messages.last['parts'], contains(containsPair('fileId', 'old')));
      expect(
        f.messages.last['parts'],
        isNot(contains(containsPair('fileId', 'new'))),
      );
      expect(f.chat.attachments.map((p) => p['fileId']).toList(), ['new']);
    },
  );
  test(
    'Duplicate confirmation while redemption is pending cannot consume two banks',
    () async {
      final f = CloudUsageFixture();
      addTearDown(f.dispose);
      await f.chat.initialize();
      expect(await f.chat.send('pending'), false);
      await f.chat.refreshUsage();
      final gate = Completer<http.Response>();
      f.redemptionGate = gate;
      final first = f.chat.redeemUsageReset();
      await Future<void>.delayed(Duration.zero);
      expect(f.chat.redeemingUsage, true);
      expect(f.redemptions.length, 1);
      await f.chat.redeemUsageReset();
      expect(f.redemptions.length, 1);
      gate.complete(
        http.Response(
          '{"error":{"code":"unavailable","message":"Try again"}}',
          503,
        ),
      );
      await first;
      expect(f.chat.redeemingUsage, false);
      expect(f.messages.length, 1);
    },
  );
  for (final replacement in ['session', 'disposed']) {
    test(
      'Late confirmed reset cannot resend after $replacement replacement',
      () async {
        final f = CloudUsageFixture();
        await f.chat.initialize();
        expect(await f.chat.send('owned pending'), false);
        await f.chat.refreshUsage();
        final gate = Completer<http.Response>();
        f.redemptionGate = gate;
        final pending = f.chat.redeemUsageReset();
        await Future<void>.delayed(Duration.zero);
        expect(f.redemptions.length, 1);
        if (replacement == 'session') {
          await f.client.setSession('replacement');
        } else {
          f.chat.dispose();
        }
        gate.complete(
          http.Response(
            jsonEncode({'redeemedBankId': 'memory', 'usage': f.usage}),
            200,
          ),
        );
        await pending;
        expect(f.messages.length, 1);
        expect(f.chat.usage!.bankedResets, 2);
        if (replacement == 'session') f.chat.dispose();
        f.client.close();
      },
    );
  }

  test(
    'Confirmed reset retries the same pending message once and preserves newer draft text',
    () async {
      final f = CloudUsageFixture();
      addTearDown(f.dispose);
      await f.chat.initialize();
      f.chat.updateComposerDraft('owned original');
      expect(await f.chat.send('owned original'), false);
      await f.chat.refreshUsage();
      final id = f.messages.single['clientMessageId'];
      f.chat.updateComposerDraft('newer unsent text');
      await f.chat.redeemUsageReset();
      await Future<void>.delayed(Duration.zero);
      expect(f.redemptions.length, 1);
      expect(f.redemptions.single['idempotencyKey'], isNotEmpty);
      expect(f.messages.length, 2);
      expect(f.messages.last['clientMessageId'], id);
      expect(f.chat.usageBlockedUntil, isNull);
      expect(f.chat.usage!.bankedResets, 1);
      expect(f.chat.composerDraft, 'newer unsent text');
      expect(f.chat.messages.where((m) => m.role == 'user').length, 1);
    },
  );
  test(
    'An uncertain redemption retries its key without resending before success',
    () async {
      final f = CloudUsageFixture()..redemptionFailures = 1;
      addTearDown(f.dispose);
      await f.chat.initialize();
      expect(await f.chat.send('pending'), false);
      await f.chat.refreshUsage();
      await f.chat.redeemUsageReset();
      expect(f.messages.length, 1);
      expect(f.chat.usageBlockedUntil, isNotNull);
      expect(f.chat.usageError, 'Reset result unknown');
      await f.chat.redeemUsageReset();
      expect(f.redemptions.length, 2);
      expect(
        f.redemptions[0]['idempotencyKey'],
        f.redemptions[1]['idempotencyKey'],
      );
      expect(f.messages.length, 2);
    },
  );
}
