import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/reasoning/domain/desktop_reasoning.dart';

Map<String, dynamic> event({
  String thread = 't',
  String turn = 'u',
  String item = 'i',
  String? delta,
  int? index,
  Map<String, dynamic>? snapshot,
}) => {
  'threadId': thread,
  'turnId': turn,
  'itemId': item,
  'delta': ?delta,
  'summaryIndex': ?index,
  if (snapshot != null) 'item': {'id': item, 'type': 'reasoning', ...snapshot},
};
void main() {
  test(
    'empty terminal history fences retained text against an older item snapshot',
    () {
      final r = ReasoningReducer('m', 'p');
      r.observeTurn('turn/started', event());
      r.ingest('item/reasoning/summaryTextDelta', event(delta: 'Full text'));
      final watermark = r.revision;
      r.historyTurn('t', 'u', 'completed', watermark: watermark);
      final item = r.history(
        {'id': 'i', 'summary': 'Full'},
        thread: 't',
        turn: 'u',
        status: 'running',
        watermark: watermark,
      )!;
      expect(item.text, 'Full text');
      expect(item.terminal, isTrue);
    },
  );
  test(
    'canonical item in a terminal response still replaces earlier stream text',
    () {
      final r = ReasoningReducer('m', 'p');
      r.observeTurn('turn/started', event());
      r.ingest('item/reasoning/summaryTextDelta', event(delta: 'Stream text'));
      final item = r.history(
        {'id': 'i', 'summary': 'Canonical text'},
        thread: 't',
        turn: 'u',
        status: 'completed',
        watermark: r.revision,
      )!;
      expect(item.text, 'Canonical text');
      expect(item.terminal, isTrue);
    },
  );

  test('canonical source structures and exact separators', () {
    expect(
      decodeReasoningText({
        'summary': [
          ' a ',
          {'text': ' b ', 'type': 'any'},
          3,
          {},
        ],
        'content': [
          {'text': ' c '},
          ' d ',
        ],
      }),
      'a\nb\n\nc\n\nd',
    );
    expect(
      decodeReasoningText({
        'summary': {'text': ' Summary '},
        'content': ' Body ',
      }),
      'Summary\n\nBody',
    );
    expect(
      decodeReasoningText({
        'summary': [
          null,
          {'text': 3},
        ],
        'content': 9,
      }),
      '',
    );
    expect(decodeReasoningText({'summary': '   '}), '');
  });
  test(
    'history large UTF8 helper preserves >64000 bytes and meaningful scan',
    () {
      final big = ' ${List.filled(22000, '界').join()} ';
      expect(utf8.encode(big).length, greaterThan(64000));
      expect(decodeReasoningText({'summary': big}, history: true), big);
      expect(decodeReasoningText({'summary': big}), big.trim());
      final whitespace = List.filled(64001, ' ').join();
      expect(
        decodeReasoningText({'summary': whitespace}, history: true),
        whitespace,
      );
      expect(
        decodeReasoningText({
          'summary': List.filled(64000, ' ').join(),
        }, history: true),
        '',
      );
    },
  );
  test('source delta precedence and envelopes preserve leading spaces', () {
    expect(
      reasoningDelta({
        'delta': '',
        'textDelta': ' value',
        'text': 'wrong',
        'msg': {'delta': 'other'},
      }),
      ' value',
    );
    expect(
      reasoningDelta({
        'part': {'text': 'not a delta'},
        'event': {'text': ' event'},
      }),
      ' event',
    );
    expect(reasoningDelta({'delta': '  '}), '  ');
  });
  test('source merge duplicate cumulative prefixes and long overlap', () {
    expect(mergeReasoningDelta('Hel', 'lo'), 'Hello');
    expect(mergeReasoningDelta('Hello', 'Hello'), 'Hello');
    expect(mergeReasoningDelta('Hello', 'lo'), 'Hello');
    expect(mergeReasoningDelta('Hello', 'Hello world'), 'Hello world');
    expect(mergeReasoningDelta('Hello world', 'Hello'), 'Hello world');
    expect(
      mergeReasoningDelta('a0123456789abcdef', '0123456789abcdefZ'),
      'a0123456789abcdefZ',
    );
  });
  test(
    'stream parts, authoritative completion, cold terminal and late exact item',
    () {
      final r = ReasoningReducer('m', 'p');
      r.observeTurn('turn/started', event());
      r.ingest('item/reasoning/summaryTextDelta', event(delta: '**Read'));
      r.ingest('item/reasoning/summaryTextDelta', event(delta: 'ing**'));
      r.ingest('item/reasoning/summaryPartAdded', event(index: 1));
      r.ingest('item/reasoning/summaryPartAdded', event(index: 1));
      r.ingest('item/reasoning/summaryTextDelta', event(index: 1, delta: ' B'));
      r.ingest('item/reasoning/textDelta', event(delta: ' C'));
      expect(r.items.values.single.text, '**Reading**\n B\n\n C');
      r.ingest('item/completed', event(snapshot: {'summary': []}));
      expect(r.items.values.single.text, '**Reading**\n B\n\n C');
      r.ingest(
        'item/completed',
        event(
          snapshot: {
            'summary': ['Final'],
            'content': 'body',
          },
        ),
      );
      r.observeTurn('turn/completed', event());
      final row =
          jsonDecode(jsonEncode(r.items.values.single.toRow()))
              as Map<String, dynamic>;
      final cold = ReasoningReducer('m', 'p')..restore(row);
      cold.observeTurn('turn/started', event());
      cold.ingest(
        'item/started',
        event(
          snapshot: {
            'summary': ['wrong'],
          },
        ),
      );
      cold.ingest('item/reasoning/summaryTextDelta', event(delta: ' late'));
      cold.ingest(
        'item/reasoning/summaryTextDelta',
        event(item: 'unknown', delta: 'ignored'),
      );
      expect(cold.items, hasLength(1));
      expect(cold.items.values.single.terminal, isTrue);
      expect(cold.items.values.single.text, 'Final late\n\nbody');
    },
  );
  test('cold unfinished row cannot grant creation authority', () {
    final r = ReasoningReducer('m', 'p');
    r.observeTurn('turn/started', event());
    r.ingest('item/reasoning/textDelta', event(delta: 'saved'));
    final cold = ReasoningReducer('m', 'p')
      ..restore(r.items.values.single.toRow());
    cold.ingest(
      'item/reasoning/textDelta',
      event(item: 'unknown', delta: 'ignored'),
    );
    expect(cold.items, hasLength(1));
    expect(cold.items.values.single.streaming, isFalse);
  });
  test('stable scope identities and malformed conflicting IDs', () {
    final r = ReasoningReducer('m', 'p');
    for (final thread in ['t', 't2']) {
      for (final turn in ['u', 'u2']) {
        r.observeTurn('turn/started', event(thread: thread, turn: turn));
        r.ingest(
          'item/reasoning/textDelta',
          event(thread: thread, turn: turn, delta: 'same'),
        );
      }
    }
    expect(r.items, hasLength(4));
    for (final params in [
      {'turnId': 'u', 'itemId': 'i', 'delta': 'bad'},
      {
        ...event(delta: 'bad'),
        'msg': {'thread_id': 'other'},
      },
      {
        ...event(delta: 'bad'),
        'item': {'id': 'other'},
      },
      {
        ...event(delta: 'bad'),
        'turn': {'id': 'other'},
      },
      {
        ...event(delta: 'bad'),
        'turn': {'id': 'u', 'thread_id': 'other'},
      },
    ]) {
      expect(r.ingest('item/reasoning/textDelta', params), isNull);
    }
    final row = r.items.values.first.toRow();
    expect((ReasoningReducer('other', 'p')..restore(row)).items, isEmpty);
    expect((ReasoningReducer('m', 'other')..restore(row)).items, isEmpty);
    expect(
      reasoningIdentity({
        'msg': {'thread_id': 't', 'turn_id': 'u', 'item_id': 'i'},
      })?.item,
      'i',
    );
  });
  test(
    'newer history response cannot be replaced by an older concurrent response',
    () {
      final r = ReasoningReducer('m', 'p');
      final watermark = r.revision;
      r.history(
        {'id': 'i', 'summary': 'new'},
        thread: 't',
        turn: 'u',
        status: 'completed',
        watermark: watermark,
      );
      expect(
        r
            .history(
              {'id': 'i', 'summary': 'old'},
              thread: 't',
              turn: 'u',
              status: 'running',
              watermark: watermark,
            )!
            .text,
        'new',
      );
    },
  );
  test(
    'history watermark preserves later revisions and fresh history replaces',
    () {
      final r = ReasoningReducer('m', 'p');
      r.observeTurn('turn/started', event());
      r.ingest('item/reasoning/textDelta', event(delta: 'live'));
      final revision = r.revision;
      r.ingest('item/completed', event(snapshot: {'summary': 'final'}));
      final raw = {'id': 'i', 'type': 'reasoning', 'summary': 'old'};
      expect(
        r
            .history(
              raw,
              thread: 't',
              turn: 'u',
              status: 'running',
              watermark: revision,
            )!
            .text,
        'final',
      );
      expect(
        r
            .history(
              raw,
              thread: 't',
              turn: 'u',
              status: 'running',
              watermark: r.revision,
            )!
            .text,
        'old',
      );
      expect(r.items.values.single.terminal, isTrue);
    },
  );
}
