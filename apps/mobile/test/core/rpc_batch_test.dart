import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/rpc_payload.dart';

void main() {
  test('bridge batch preserves notification and response order', () {
    final batch = decodeRpcPayload(
      '[{"method":"turn/started","params":{}},{"method":"item/agentMessage/delta","params":{"delta":"Hello"}},{"id":"reply","result":{}}]',
    );
    expect(batch.messages.map((m) => m['method'] ?? m['id']), [
      'turn/started',
      'item/agentMessage/delta',
      'reply',
    ]);
    expect(batch.malformed, isFalse);
  });
  test('one malformed batch entry cannot discard valid neighbors', () {
    final batch = decodeRpcPayload(
      '[{"method":"turn/started"},42,{"method":"item/agentMessage/delta","params":{"delta":"ok"}}]',
    );
    expect(batch.messages, hasLength(2));
    expect(batch.malformed, isTrue);
    expect(decodeRpcPayload('not JSON').malformed, isTrue);
    expect(decodeRpcPayload('{"id":"one","result":{}}').messages, hasLength(1));
  });
}
