import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop, reasoningEvent;

const failure = 'This chat uses openai, but your current provider is custom.';
Map<String, dynamic> failedHistory({String turn = 'turn'}) => {
  'id': 'thread',
  'turns': [
    {
      'id': turn,
      'status': 'failed',
      'error': {'message': failure},
      'items': [],
    },
  ],
};

Future<void> settle() async {
  for (var i = 0; i < 6; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  test(
    'fresh terminal history replaces a disconnected partial assistant',
    () async {
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      reasoningEvent(transport, 'turn/started');
      reasoningEvent(
        transport,
        'item/agentMessage/delta',
        delta: 'First partial',
      );
      transport.history = {
        'id': 'thread',
        'turns': [
          {
            'id': 'turn',
            'status': 'completed',
            'items': [
              {
                'id': 'item',
                'type': 'agentMessage',
                'content': [
                  {
                    'type': 'outputText',
                    'text': 'First partial and the recovered complete response',
                  },
                ],
              },
            ],
          },
        ],
      };
      await desktop.openThread({'id': 'thread'}, readOnlyNavigation: true);
      expect(desktop.turnId, isNull);
      expect(
        desktop.timeline
            .where((r) => r['type'] == 'agentMessage')
            .single['text'],
        'First partial and the recovered complete response',
      );
      expect(desktop.turnId, isNull);
      desktop.dispose();
    },
  );
  test(
    'a new live turn clears the old failure and rejects its delayed history',
    () async {
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      reasoningEvent(transport, 'turn/started', turn: 'old');
      final held = Completer<RemoteJson>();
      transport.readGate = held;
      reasoningEvent(
        transport,
        'turn/completed',
        turn: 'old',
        extra: {
          'turn': {
            'id': 'old',
            'status': 'failed',
            'error': {'message': failure},
          },
        },
      );
      expect(desktop.error, failure);
      reasoningEvent(transport, 'turn/started', turn: 'new');
      expect(desktop.error, isNull);
      held.complete({'thread': failedHistory(turn: 'old')});
      await settle();
      expect(desktop.error, isNull);
      expect(desktop.selectedResponseFooter.latestTurn, 'new');
      desktop.dispose();
    },
  );

  test(
    'failed history exposes the provider explanation without a reply item',
    () async {
      final transport = ReasoningTransport()..history = failedHistory();
      final desktop = await reasoningDesktop(transport);
      expect(desktop.error, failure);
      desktop.dispose();
    },
  );

  test(
    'live completion failure remains visible during automatic history refresh',
    () async {
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      reasoningEvent(transport, 'turn/started');
      transport.readGate = Completer<RemoteJson>();
      reasoningEvent(
        transport,
        'turn/completed',
        extra: {
          'turn': {
            'id': 'turn',
            'status': 'failed',
            'error': {'message': failure},
          },
        },
      );
      expect(desktop.error, failure);
      transport.readGate!.complete({'thread': failedHistory()});
      await settle();
      expect(desktop.error, failure);
      desktop.dispose();
    },
  );

  test(
    'a late failed history cannot replace another selected chat error state',
    () async {
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      final held = Completer<RemoteJson>();
      transport.readGate = held;
      final reading = desktop.openThread({
        'id': 'thread',
      }, readOnlyNavigation: true);
      transport.readGate = null;
      transport.history = {'id': 'other', 'turns': []};
      await desktop.openThread({'id': 'other'}, readOnlyNavigation: true);
      held.complete({'thread': failedHistory()});
      await reading;
      expect(desktop.thread?['id'], 'other');
      expect(desktop.error, isNull);
      desktop.dispose();
    },
  );

  test(
    'another thread failure does not display on the selected chat',
    () async {
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      reasoningEvent(
        transport,
        'turn/completed',
        thread: 'other',
        extra: {
          'turn': {
            'id': 'turn',
            'status': 'failed',
            'error': {'message': failure},
          },
        },
      );
      expect(desktop.error, isNull);
      desktop.dispose();
    },
  );
}
