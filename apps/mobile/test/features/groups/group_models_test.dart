import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/groups/domain/group_models.dart';

// The same cases as packages/shared/src/groupChat.test.ts: the phone must
// agree with the desktop about who a message addresses.
const handles = ['Claude', 'Claude2', 'Codex', '审稿人'];

void main() {
  group('parseGroupMentions', () {
    test('matches case-insensitively and prefers the longest handle', () {
      final found = parseGroupMentions('@claude2 and @CODEX please', handles);
      expect(found.all, isFalse);
      expect(found.handles, ['Claude2', 'Codex']);
    });
    test('accepts trailing punctuation and non-Latin handles', () {
      expect(parseGroupMentions('@Claude, what about @审稿人?', handles).handles, [
        'Claude',
        '审稿人',
      ]);
    });
    test('ignores e-mail addresses and unknown names', () {
      final found = parseGroupMentions('mail a@claude.com or @Nobody', handles);
      expect(found.all, isFalse);
      expect(found.handles, isEmpty);
    });
    test('ignores handles inside links and paths', () {
      expect(
        parseGroupMentions(
          r'see medium.com/@Claude/post and C:\@Codex',
          handles,
        ).handles,
        isEmpty,
      );
    });
    test('does not match the start of a longer word', () {
      expect(parseGroupMentions('@Claudette hi', handles).handles, isEmpty);
    });
    test('matches a handle followed directly by Chinese text', () {
      expect(parseGroupMentions('@审稿人请看一下，@Codex你也看', handles).handles, [
        '审稿人',
        'Codex',
      ]);
      expect(parseGroupMentions('@所有人 仅回复收到', handles).all, isTrue);
    });
    test('recognises @all in any case and deduplicates', () {
      final found = parseGroupMentions('@All @Codex @codex', handles);
      expect(found.all, isTrue);
      expect(found.handles, ['Codex']);
    });
  });

  test('reads the member out of a reply id', () {
    final parsed = parseGroupMessageId('assistant:turn-7:gm.m1.r9');
    expect(parsed?.memberId, 'm1');
    expect(parsed?.replyId, 'r9');
    expect(parseGroupMessageId('assistant:turn-7:assistant-abc'), isNull);
  });

  group('activeMentionQuery', () {
    test('finds the word being typed after @', () {
      final query = activeMentionQuery('hi @Cl', 6);
      expect(query?.start, 3);
      expect(query?.query, 'Cl');
    });
    test('opens on a bare @', () {
      expect(activeMentionQuery('@', 1)?.query, '');
    });
    test('ignores e-mail addresses and finished mentions', () {
      expect(activeMentionQuery('a@cl', 4), isNull);
      expect(activeMentionQuery('@Claude ', 8), isNull);
    });
  });
}
