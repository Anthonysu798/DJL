import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

class TestTransport extends RemoteTransport {
  TestTransport(super.pairings);
  final events = StreamController<RemoteJson>.broadcast(sync: true);
  final sent = <RemoteJson>[];
  final calls = <RemoteJson>[];
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    if (method == 'thread/resume' || method == 'thread/read') {
      return {
        'thread': {
          'id': 't1',
          'model': 'shared',
          'modelProvider': 'claudeAgent',
          'turns': [],
        },
      };
    }
    return {
      'turn': {'id': 'turn-1'},
    };
  }

  @override
  Stream<RemoteJson> get messages => events.stream;
  @override
  bool get connected => true;
  @override
  Future<void> send(RemoteJson message) async {
    sent.add(message);
  }

  @override
  Future<void> dispose() async {
    await events.close();
  }
}

class DelayedHistoryTransport extends TestTransport {
  DelayedHistoryTransport(super.pairings);
  final history = Completer<RemoteJson>();
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) {
    if (method == 'thread/read') return history.future;
    return super.request(method, params, timeout: timeout);
  }
}

class FastCompletionTransport extends TestTransport {
  FastCompletionTransport(super.pairings);
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'turn/start') {
      events.add({
        'method': 'turn/started',
        'params': {
          'threadId': 't1',
          'turn': {'id': 'fast-turn'},
        },
      });
      events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 't1',
          'turn': {'id': 'fast-turn', 'status': 'completed'},
        },
      });
      return {
        'turn': {'id': 'fast-turn'},
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

class StreamingTransport extends TestTransport {
  StreamingTransport(super.pairings);
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'turn/start') {
      events.add({
        'method': 'item/started',
        'params': {
          'threadId': 't1',
          'turnId': 'turn-1',
          'item': {
            'id': 'wire-user',
            'type': 'userMessage',
            'content': [
              {'type': 'text', 'text': 'hello'},
            ],
          },
        },
      });
    }
    if (method == 'turn/start') {
      events.add({
        'method': 'item/agentMessage/delta',
        'params': {
          'threadId': 't1',
          'itemId': 'assistant',
          'turnId': 'turn-1',
          'delta': 'reply',
        },
      });
    }
    return super.request(method, params, timeout: timeout);
  }
}

void main() {
  test(
    'question cancellation interrupts the request turn rather than a newer active turn',
    () async {
      final pairs = PairingRepository(TestCredentials()),
          transport = TestTransport(PairingRepository(TestCredentials()));
      final desktop = DesktopController(pairs, connection: transport)
        ..thread = {'id': 't1'}
        ..state = 'connected'
        ..turnId = 'newer-turn';
      final request = <String, dynamic>{
        'id': 'q1',
        'params': {'threadId': 't1', 'turnId': 'question-turn'},
      };
      desktop.userInputs.add(request);
      await desktop.cancelQuestion(request);
      expect(transport.calls.last, {
        'method': 'turn/interrupt',
        'params': {'threadId': 't1', 'turnId': 'question-turn'},
      });
      desktop.dispose();
    },
  );
  test(
    'a user echo arriving after the turn start response replaces the optimistic row',
    () async {
      final pairs = PairingRepository(TestCredentials());
      final transport = TestTransport(pairs);
      final controller = DesktopController(pairs, connection: transport)
        ..thread = {'id': 't1'}
        ..model = 'qa';
      await controller.send('hello');
      transport.events.add({
        'method': 'item/started',
        'params': {
          'threadId': 't1',
          'turnId': 'turn-1',
          'item': {
            'id': 'wire-user',
            'type': 'userMessage',
            'content': [
              {'type': 'text', 'text': 'hello'},
            ],
          },
        },
      });
      expect(
        controller.timeline.where((i) => i['type'] == 'userMessage'),
        hasLength(1),
      );
      expect(controller.timeline.first['id'], 'wire-user');
      controller.dispose();
    },
  );
  test(
    'optimistic user message precedes an immediate assistant delta',
    () async {
      final pairs = PairingRepository(TestCredentials());
      final transport = StreamingTransport(pairs);
      final controller = DesktopController(pairs, connection: transport)
        ..thread = {'id': 't1'}
        ..model = 'qa';
      await controller.send('hello');
      expect(controller.timeline.first['type'], 'userMessage');
      expect(
        controller.timeline.where((i) => i['type'] == 'userMessage'),
        hasLength(1),
      );
      expect(controller.timeline.last['text'], 'reply');
      controller.dispose();
    },
  );
  test(
    'a completed fast turn is not revived by its later start response or replayed start event',
    () async {
      final pairs = PairingRepository(TestCredentials());
      final transport = FastCompletionTransport(pairs);
      final controller = DesktopController(pairs, connection: transport)
        ..thread = {'id': 't1'}
        ..model = 'qa';
      expect(await controller.send('hello'), isTrue);
      expect(controller.turnId, isNull);
      transport.events.add({
        'method': 'turn/started',
        'params': {
          'threadId': 't1',
          'turn': {'id': 'old-turn'},
          'djlReplayedEvent': true,
        },
      });
      expect(controller.turnId, isNull);
      controller.dispose();
    },
  );
  test('late history cannot replace a conversation after disconnect', () async {
    final pairs = PairingRepository(TestCredentials());
    final transport = DelayedHistoryTransport(pairs);
    final controller = DesktopController(pairs, connection: transport);
    final opening = controller.openThread({'id': 'old'});
    await Future<void>.delayed(Duration.zero);
    await controller.disconnect();
    controller.thread = {'id': 'replacement'};
    transport.history.complete({
      'thread': {
        'id': 'old',
        'turns': [
          {
            'id': 'old-turn',
            'items': [
              {'id': 'private-old-item', 'text': 'old history'},
            ],
          },
        ],
      },
    });
    await opening;
    expect(controller.thread?['id'], 'replacement');
    expect(controller.timeline, isEmpty);
    controller.dispose();
  });
  test(
    'desktop sends raw model and provider together and restores the thread provider',
    () async {
      final pairs = PairingRepository(TestCredentials());
      final transport = TestTransport(pairs);
      final controller = DesktopController(pairs, connection: transport)
        ..models = [
          {'id': 'codex::shared', 'model': 'shared', 'djlProvider': 'codex'},
          {
            'id': 'claudeAgent::shared',
            'model': 'shared',
            'djlProvider': 'claudeAgent',
          },
        ]
        ..model = 'codex::shared';
      await controller.openThread({'id': 't1'});
      expect(controller.model, 'claudeAgent::shared');
      expect(await controller.send('hello'), isTrue);
      final params = transport.calls.last['params'] as Map;
      expect(params['model'], 'shared');
      expect(params['djlProvider'], 'claudeAgent');
      expect(params['sandboxPolicy'], {
        'type': 'workspaceWrite',
        'networkAccess': true,
      });
      controller.dispose();
    },
  );

  test(
    'unknown server requests are rejected without an approval card',
    () async {
      final pairs = PairingRepository(TestCredentials());
      final transport = TestTransport(pairs);
      final controller = DesktopController(pairs, connection: transport);
      transport.events.add({'id': 1, 'method': 'future/unknown', 'params': {}});
      await Future<void>.delayed(Duration.zero);
      expect(controller.pendingApprovals, isEmpty);
      expect((transport.sent.single['error'] as Map)['code'], -32601);
      controller.dispose();
    },
  );
  test(
    'structured answers use the answers envelope and approvals stay scoped',
    () async {
      final pairs = PairingRepository(TestCredentials());
      final transport = TestTransport(pairs);
      final controller = DesktopController(pairs, connection: transport)
        ..thread = {'id': 't1'};
      transport.events.add({
        'id': 'other',
        'method': 'item/commandExecution/requestApproval',
        'params': {'threadId': 't2', 'command': 'outside'},
      });
      expect(controller.pendingApprovals, isEmpty);
      transport.events.add({
        'id': 'question',
        'method': 'item/tool/requestUserInput',
        'params': {
          'threadId': 't1',
          'questions': [
            {'id': 'q', 'question': 'Choose', 'options': []},
          ],
        },
      });
      expect(controller.pendingUserInputs, hasLength(1));
      expect(controller.pendingApprovals, isEmpty);
      await controller.answer(controller.pendingUserInputs.single, {
        'q': [' one ', ''],
      });
      expect(transport.sent.last, {
        'id': 'question',
        'result': {
          'answers': {
            'q': {
              'answers': ['one'],
            },
          },
        },
      });
      expect(controller.pendingUserInputs, hasLength(1));
      expect(controller.pendingUserInputs.single['_submitted'], isTrue);
      transport.events.add({
        'method': 'serverRequest/resolved',
        'params': {'requestId': 'question'},
      });
      expect(controller.pendingUserInputs, isEmpty);
      controller.dispose();
    },
  );
}
