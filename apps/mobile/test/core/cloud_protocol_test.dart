import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/core/network/sse_parser.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';

void main() {
  test('SSE preserves split UTF8, CRLF, multiline data and heartbeats', () {
    final parser = SseParser();
    final bytes = utf8.encode(
      ': heartbeat\r\nid: 7\revent: text.delta\ndata: 你好\r\ndata: world\r\n\r\n',
    );
    final frames = bytes.expand((byte) => parser.feed([byte])).toList();
    expect(frames, hasLength(1));
    expect(frames.single.id, '7');
    expect(frames.single.event, 'text.delta');
    expect(frames.single.data, '你好\nworld');
    expect(parser.feed(utf8.encode('data: incomplete')), isEmpty);
  });
  test('Cloud conversation fixture preserves every message part', () {
    final json =
        jsonDecode(
              File(
                '../../packages/contracts/fixtures/cloud/conversation-detail.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final detail = ConversationDetail.fromJson(json);
    expect(detail.conversation.id, 'conv_1');
    expect(detail.messages[1].parts.map((p) => p['type']), [
      'tool_call',
      'tool_result',
      'text',
      'image_ref',
      'citation',
    ]);
    expect(detail.messages[1].text, 'Here is a plan.');
  });
  test('Run reducer deduplicates replay and rejects out-of-order gaps', () {
    final reducer = RunReducer(
      runId: 'run_1',
      messages: [ChatMessage(id: 'msg_2', role: 'assistant', parts: [])],
    );
    Map<String, dynamic> event(int seq, String text) => {
      'runId': 'run_1',
      'seq': seq,
      'type': 'text.delta',
      'payload': {'messageId': 'msg_2', 'text': text},
    };
    expect(reducer.apply(event(1, 'Hello')), isTrue);
    expect(reducer.apply(event(1, 'Hello')), isFalse);
    expect(() => reducer.apply(event(3, '!')), throwsA(isA<EventGap>()));
    expect(reducer.lastSeq, 1);
    expect(reducer.apply(event(2, ' world')), isTrue);
    expect(reducer.messages.single.text, 'Hello world');
    expect(reducer.apply({...event(3, 'bad'), 'runId': 'other'}), isFalse);
  });
  test('parentId is explicitly null in user message wire input', () {
    final input = SendInput(
      clientMessageId: 'stable-id',
      parentId: null,
      parts: [
        {'type': 'text', 'text': 'Hi'},
      ],
      model: 'model-id',
      mode: 'chat',
    );
    expect(input.toJson().containsKey('parentId'), isTrue);
    expect(input.toJson()['parentId'], isNull);
  });
}
