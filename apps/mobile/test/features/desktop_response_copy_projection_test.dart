import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_response_footer.dart';

Map<String, dynamic> row(String id, String type, String text, [String? turn]) =>
    {'id': id, 'type': type, 'text': text, 'turnId': turn ?? 'turn'};

void main() {
  final settled = DesktopResponseFooterFacts(
    outcomes: {'turn': DesktopResponseOutcome.completed},
  );
  test('assistant tail copies only its complete raw action text', () {
    const raw = '  # Heading\n```dart\n\tprint("🌙");\n```\n ';
    expect(
      desktopResponseCopies([
        row('first', 'agentMessage', 'Do not aggregate me'),
        row('last', 'agentMessage', raw),
      ], facts: settled),
      {1: raw},
    );
    final large = 'x' * 64001;
    expect(
      desktopResponseCopies([
        row('last', 'agentMessage', large),
      ], facts: settled),
      {0: large},
    );
  });
  test(
    'trailing tool aggregates assistant text without copying tool output',
    () {
      expect(
        desktopResponseCopies([
          row('a', 'agentMessage', '  First  '),
          row('b', 'agentMessage', '\tSecond\n'),
          row('c', 'commandExecution', 'Secret command output'),
        ], facts: settled),
        {2: 'First\n\nSecond'},
      );
    },
  );
  test('user prompts and distinct stable turns delimit Copy ownership', () {
    final facts = DesktopResponseFooterFacts(
      outcomes: {
        'a': DesktopResponseOutcome.completed,
        'b': DesktopResponseOutcome.failed,
      },
    );
    expect(
      desktopResponseCopies([
        row('a', 'agentMessage', 'A', 'a'),
        row('b', 'agentMessage', 'B', 'b'),
        row('u', 'userMessage', 'Next prompt', 'b'),
        row('c', 'agentMessage', 'C', 'b'),
      ], facts: facts),
      {0: 'A', 1: 'B', 3: 'C'},
    );
  });
  test(
    'missing and whitespace IDs do not cross a distinct stable boundary',
    () {
      final a = row('a', 'agentMessage', ' A ', 'a');
      final b = row('b', 'agentMessage', ' B ', 'b');
      final tail = row('tail', 'tool', 'Output', ' ');
      expect(
        desktopResponseCopies(
          [a, b, tail],
          facts: DesktopResponseFooterFacts(
            outcomes: {
              'a': DesktopResponseOutcome.completed,
              'b': DesktopResponseOutcome.completed,
            },
          ),
        ),
        {0: ' A ', 2: 'B'},
      );
    },
  );
  test(
    'active or pending work needs a later real user prompt for older Copy',
    () {
      final facts = DesktopResponseFooterFacts(
        outcomes: {'turn': DesktopResponseOutcome.completed},
        pending: true,
      );
      expect(
        desktopResponseCopies([
          row('a', 'agentMessage', 'Answer'),
          row('tail', 'tool', 'Later tool'),
        ], facts: facts),
        isEmpty,
      );
      expect(
        desktopResponseCopies([
          row('a', 'agentMessage', 'Answer'),
          row('u', 'userMessage', 'Next prompt'),
        ], facts: facts),
        {0: 'Answer'},
      );
      expect(
        desktopResponseCopies(
          [row('a', 'agentMessage', 'Answer')],
          facts: settled,
          sending: true,
        ),
        isEmpty,
      );
    },
  );
  test('settled unknown and turnless legacy text remains copyable', () {
    final facts = DesktopResponseFooterFacts();
    expect(
      desktopResponseCopies([
        row('legacy', 'agentMessage', 'Legacy reply', 'legacy-turn'),
      ], facts: facts),
      {0: 'Legacy reply'},
    );
    expect(
      desktopResponseCopies([
        {'id': 'turnless', 'type': 'agentMessage', 'text': 'Turnless reply'},
      ], facts: facts),
      {0: 'Turnless reply'},
    );
    expect(facts.outcome('legacy-turn'), DesktopResponseOutcome.unknown);
  });
  test('a later user prompt permits an older unknown block during a run', () {
    final facts = DesktopResponseFooterFacts(pending: true);
    expect(
      desktopResponseCopies([
        row('legacy', 'agentMessage', 'Older reply', 'legacy'),
        row('user', 'userMessage', 'Next prompt', 'new'),
        row('active', 'agentMessage', 'Still running', 'new'),
      ], facts: facts),
      {0: 'Older reply'},
    );
  });
  test('stopped running and unavailable blocks never gain Copy', () {
    for (final outcome in [
      DesktopResponseOutcome.stopped,
      DesktopResponseOutcome.running,
    ]) {
      expect(
        desktopResponseCopies([
          row('a', 'agentMessage', 'Answer'),
        ], facts: DesktopResponseFooterFacts(outcomes: {'turn': outcome})),
        isEmpty,
      );
    }
    expect(
      desktopResponseCopies(
        [row('a', 'agentMessage', 'Answer')],
        facts: settled,
        available: false,
      ),
      isEmpty,
    );
  });
  test(
    'latest stopped turn with no rows still suppresses the latest block',
    () {
      final lifecycle = DesktopResponseLifecycle();
      lifecycle.history('thread', [
        {'id': 'turn', 'status': 'completed'},
        {'id': 'stopped-empty', 'status': 'stopped'},
      ], lifecycle.revision);
      expect(
        desktopResponseCopies([
          row('a', 'agentMessage', 'Earlier answer'),
        ], facts: lifecycle.facts('thread')),
        isEmpty,
      );
      lifecycle.starting('thread', 'next');
      lifecycle.terminal('thread', 'next', DesktopResponseOutcome.completed);
      expect(
        desktopResponseCopies([
          row('a', 'agentMessage', 'New answer', 'next'),
        ], facts: lifecycle.facts('thread')),
        {0: 'New answer'},
      );
    },
  );
  test('pre-start history cannot replace newer latest stopped authority', () {
    final lifecycle = DesktopResponseLifecycle();
    lifecycle.history('thread', [
      {'id': 'turn', 'status': 'completed'},
    ], 0);
    final before = lifecycle.revision;
    lifecycle.starting('thread', 'new');
    lifecycle.terminal('thread', 'new', DesktopResponseOutcome.stopped);
    lifecycle.history('thread', [
      {'id': 'turn', 'status': 'completed'},
    ], before);
    expect(
      desktopResponseCopies([
        row('a', 'agentMessage', 'Old'),
      ], facts: lifecycle.facts('thread')),
      isEmpty,
    );
  });
  test(
    'hidden thinking rehomes Copy inside its block and cannot cross a user',
    () {
      expect(
        desktopResponseCopies(
          [row('a', 'agentMessage', 'Answer'), row('h', 'reasoning', '')],
          facts: settled,
          hiddenRows: {1},
        ),
        {0: 'Answer'},
      );
      expect(
        desktopResponseCopies(
          [
            row('a', 'agentMessage', 'Answer'),
            row('u', 'userMessage', 'Next'),
            row('h', 'reasoning', ''),
          ],
          facts: settled,
          hiddenRows: {2},
        ),
        {0: 'Answer'},
      );
    },
  );
  test(
    'tool-only images context and type fallbacks cannot manufacture prose',
    () {
      expect(
        desktopResponseCopies([
          {
            'id': 'a',
            'type': 'agentMessage',
            'turnId': 'turn',
            'content': [
              {
                'type': 'image',
                'text': 'not prose',
                'url': 'https://example.test/image',
              },
              {'type': 'mention', 'name': 'Do not copy this'},
            ],
          },
          row('t', 'tool', 'Output'),
        ], facts: settled),
        isEmpty,
      );
      expect(
        desktopResponseCopies([row('t', 'tool', 'Output')], facts: settled),
        isEmpty,
      );
      expect(
        desktopResponseCopies([
          {
            'id': 'a',
            'type': 'agentMessage',
            'turnId': 'turn',
            'content': [
              {'type': 'text', 'text': 'First'},
              {'type': 'output_text', 'text': 'Second'},
            ],
          },
        ], facts: settled),
        {0: 'First\nSecond'},
      );
    },
  );
  test('aggregate cap uses raw UTF8 bytes and excludes separator bytes', () {
    final first = 'a' * 32000, second = 'é' * 16000;
    expect(
      desktopResponseCopies([
        row('a', 'agentMessage', first),
        row('b', 'agentMessage', second),
        row('t', 'tool', ''),
      ], facts: settled),
      {2: '$first\n\n$second'},
    );
    expect(
      desktopResponseCopies([
        row('a', 'agentMessage', first),
        row('b', 'agentMessage', '${second}x'),
        row('t', 'tool', ''),
      ], facts: settled),
      isEmpty,
    );
  });
  test('only small whitespace chunks are trimmed or rejected', () {
    final large = '${' ' * 511}x ';
    expect(
      desktopResponseCopies([
        row('a', 'agentMessage', large),
        row('t', 'tool', ''),
      ], facts: settled),
      {1: large},
    );
    expect(
      desktopResponseCopies([
        row('a', 'agentMessage', ' ' * 512),
        row('t', 'tool', ''),
      ], facts: settled),
      isEmpty,
    );
    expect(
      desktopResponseCopies([
        row('a', 'agentMessage', ' ' * 513),
        row('t', 'tool', ''),
      ], facts: settled),
      {1: ' ' * 513},
    );
  });
}
