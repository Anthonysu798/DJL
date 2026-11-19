import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import '../fixtures/cloud_usage_fixture.dart';

Future<void> waitFor(ChatController chat, bool Function() condition) async {
  if (condition()) return;
  final ready = Completer<void>();
  void changed() {
    if (condition() && !ready.isCompleted) ready.complete();
  }

  chat.addListener(changed);
  try {
    await ready.future.timeout(const Duration(seconds: 2));
  } finally {
    chat.removeListener(changed);
  }
}

void main() {
  for (final restored in [true, false]) {
    test(
      '${restored ? 'Restored' : 'Live'} blocked usage resumes the same run after its last seq with no new message',
      () async {
        final f = CloudUsageFixture(
          restoredBlocked: restored,
          blockOnEvent: !restored,
        );
        addTearDown(f.dispose);
        await f.chat.initialize();
        if (!restored) expect(await f.chat.send('Original blocked run'), true);
        await waitFor(
          f.chat,
          () => f.chat.usageBlockedUntil != null && !f.chat.usageLoading,
        );
        expect(f.chat.reducer!.status, 'blocked_on_usage');
        expect(f.chat.streaming, true);
        expect(f.chat.usage!.bankedResets, 2);
        expect(f.redemptions, isEmpty);
        final before = f.messages.length;
        await f.chat.redeemUsageReset();
        await waitFor(f.chat, () => f.chat.reducer!.status == 'succeeded');
        expect(f.messages.length, before);
        expect(f.chat.messages.last.text, 'Resumed original run');
        expect(f.chat.messages.where((m) => m.role == 'user').length, 1);
        expect(f.eventAfter, restored ? ['1'] : ['0', '1']);
        expect(f.chat.reducer!.lastSeq, 4);
        expect(f.chat.usageBlockedUntil, isNull);
        expect(f.redemptions.length, 1);
      },
    );
  }
  test('Credit-blocked runs do not offer or consume a window reset', () async {
    final f = CloudUsageFixture(
      restoredBlocked: true,
      blockCode: 'insufficient_credits',
    );
    addTearDown(f.dispose);
    await f.chat.initialize();
    expect(f.chat.usageBlockedUntil, isNull);
    expect(f.chat.error, 'Window full');
    await f.chat.redeemUsageReset();
    expect(f.redemptions, isEmpty);
    expect(f.usageReads, 0);
    expect(f.messages, isEmpty);
  });
}
