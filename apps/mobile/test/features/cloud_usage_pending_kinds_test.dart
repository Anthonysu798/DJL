import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import '../fixtures/cloud_usage_fixture.dart';

void main() {
  test(
    'A retry blocked again refreshes usage without consuming another bank automatically',
    () async {
      final f = CloudUsageFixture()..rejectAfterReset = true;
      addTearDown(f.dispose);
      await f.chat.initialize();
      expect(await f.chat.send('pending'), false);
      await f.chat.refreshUsage();
      final reads = f.usageReads;
      await f.chat.redeemUsageReset();
      await Future<void>.delayed(Duration.zero);
      expect(f.redemptions.length, 1);
      expect(f.messages.length, 2);
      expect(f.chat.usageBlockedUntil, isNotNull);
      expect(f.usageReads, greaterThan(reads));
      expect(f.chat.usage!.fiveHour.fraction, 1);
      expect(f.chat.usage!.bankedResets, 1);
    },
  );

  test(
    'Image usage recovery preserves the image id, ratio, and separate composer',
    () async {
      final f = CloudUsageFixture();
      addTearDown(f.dispose);
      await f.chat.initialize();
      f.chat.updateComposerDraft('separate unsent draft');
      expect(await f.chat.generateImage('Public QA image', '4:3'), false);
      await f.chat.refreshUsage();
      expect(f.chat.usageBlockedUntil, isNotNull);
      final input = Map<String, dynamic>.from(f.images.single);
      await f.chat.redeemUsageReset();
      expect(f.images, [input, input]);
      expect(f.messages, isEmpty);
      expect(f.chat.composerDraft, 'separate unsent draft');
      expect(f.chat.canRetry, false);
    },
  );
  test(
    'Edited pending sends keep their sibling parent and leave unrelated composer/files intact',
    () async {
      final f = CloudUsageFixture();
      addTearDown(f.dispose);
      await f.chat.initialize();
      final original = ChatMessage(
        id: 'original',
        role: 'user',
        parts: [
          {'type': 'text', 'text': 'old'},
          {
            'type': 'file_ref',
            'fileId': 'old',
            'name': 'old.txt',
            'mimeType': 'text/plain',
            'size': 1,
          },
        ],
      );
      f.chat.messages.add(original);
      f.chat.updateComposerDraft('unrelated draft');
      f.chat.attachments.add({
        'type': 'file_ref',
        'fileId': 'new',
        'name': 'new.txt',
        'mimeType': 'text/plain',
        'size': 1,
      });
      expect(await f.chat.edit(original, 'edited text'), false);
      await f.chat.refreshUsage();
      final before = Map<String, dynamic>.from(f.messages.single);
      await f.chat.redeemUsageReset();
      expect(f.messages, [before, before]);
      expect(before['parentId'], isNull);
      expect(before['parts'], contains(containsPair('fileId', 'old')));
      expect(f.chat.composerDraft, 'unrelated draft');
      expect(f.chat.attachments.single['fileId'], 'new');
      expect(f.chat.messages.any((m) => m.id == 'original'), true);
    },
  );
  test('Bankless usage remains blocked without a redemption request', () async {
    final f = CloudUsageFixture()..banks = 0;
    addTearDown(f.dispose);
    await f.chat.initialize();
    expect(await f.chat.send('pending'), false);
    await f.chat.refreshUsage();
    await f.chat.redeemUsageReset();
    expect(f.redemptions, isEmpty);
    expect(f.messages.length, 1);
    expect(f.chat.usageBlockedUntil, isNotNull);
    expect(f.chat.usage!.bankedResets, 0);
  });
  test(
    'Failed usage reads remain retryable and invalid reset dates do not discard the pending message',
    () async {
      final f = CloudUsageFixture()
        ..usageUnavailable = true
        ..resetsAt = 'invalid-date';
      addTearDown(f.dispose);
      await f.chat.initialize();
      expect(await f.chat.send('pending'), false);
      await f.chat.refreshUsage();
      expect(f.chat.usage, isNull);
      expect(f.chat.usageError, 'Usage could not be loaded');
      expect(f.chat.usageLoading, false);
      await f.chat.redeemUsageReset();
      expect(f.redemptions, isEmpty);
      f.usageUnavailable = false;
      await f.chat.refreshUsage();
      expect(f.chat.usage!.fiveHour.resetsAt, isNull);
      expect(f.chat.usage!.bankedResets, 2);
      expect(f.chat.usageError, isNull);
      expect(f.chat.canRetry, true);
      expect(f.messages.length, 1);
    },
  );
  test(
    'Successful recovery clears the exact consumed normal composer draft',
    () async {
      final f = CloudUsageFixture();
      addTearDown(f.dispose);
      await f.chat.initialize();
      f.chat.updateComposerDraft('owned pending');
      expect(await f.chat.send('owned pending'), false);
      await f.chat.refreshUsage();
      await f.chat.redeemUsageReset();
      expect(f.chat.composerDraft, isEmpty);
      expect(f.messages.length, 2);
      expect(
        f.messages[0]['clientMessageId'],
        f.messages[1]['clientMessageId'],
      );
    },
  );
}
