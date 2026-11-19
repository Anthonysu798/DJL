import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_history_reconciliation_test.dart' show historyDesktop;
import 'desktop_plan_widgets_test.dart' show PlanActionTransport;
import 'desktop_reasoning_controller_test.dart' show ReasoningPairings;
import 'desktop_composer_send_test.dart' show mixed;

const planRuntimeNotice =
    'Plan mode is not supported by this runtime. Sent as a normal turn instead.';
const _rejection = RemoteRpcException(
  -32602,
  'Unknown field collaborationMode: experimentalApi is unavailable',
  null,
);

class PlanFallbackTransport extends PlanActionTransport {
  final replies = <Object>[];
  void Function()? beforeReply;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (!{'turn/start', 'turn/steer'}.contains(method)) {
      return super.request(method, params, timeout: timeout);
    }
    calls.add({'method': method, 'params': jsonDecode(jsonEncode(params))});
    if (!actionRequested.isCompleted) actionRequested.complete();
    beforeReply?.call();
    final reply = replies.isEmpty
        ? <String, dynamic>{
            'turn': {'id': params['expectedTurnId'] ?? 'implemented'},
          }
        : replies.removeAt(0);
    if (reply is Completer<RemoteJson>) return reply.future;
    if (reply is RemoteJson) return reply;
    throw reply;
  }

  List<RemoteJson> get actions => calls
      .where((c) => {'turn/start', 'turn/steer'}.contains(c['method']))
      .map((c) => c['params'] as RemoteJson)
      .toList();
}

Future<DesktopController> planFallbackDesktop(
  PlanFallbackTransport t, {
  bool running = false,
}) async {
  final d = await historyDesktop(t, [
    if (running)
      {'id': 'a', 'type': 'agentMessage', 'turnId': 'live', 'text': 'Working'},
  ], running: running);
  d.models = [
    {'id': 'qa', 'model': 'provider-model'},
  ];
  d.model = 'qa';
  d.effort = 'high';
  return d;
}

void _native(PlanFallbackTransport t) => t.events.add({
  'id': 17,
  'method': 'item/tool/requestUserInput',
  'params': {
    'threadId': 'thread',
    'questions': [
      {'id': 'q', 'header': 'Scope', 'question': 'Choose scope', 'options': []},
    ],
  },
});

void main() {
  test(
    'restoring a saved Plan preference respects the rejected runtime capability',
    () async {
      final t = PlanFallbackTransport()..replies.add(_rejection);
      final d = await planFallbackDesktop(t);
      addTearDown(d.dispose);
      d.setPlan(true);
      expect(await d.send('Plan'), isTrue, reason: d.error);
      d.threadList.data.runtimes['other'] = {
        'model': 'qa',
        'wireModel': 'provider-model',
        'plan': true,
      };
      t.history = {'id': 'other', 'cwd': '/qa', 'turns': []};
      await d.openThread({
        'id': 'other',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      expect(d.supportsPlan, isFalse);
      expect(d.plan, isFalse);
    },
  );

  test('Plan downgrade composes with all rich-input shape fallbacks', () async {
    final t = PlanFallbackTransport()
      ..replies.addAll([
        const RemoteRpcException(-32602, 'Missing input image_url', null),
        const RemoteRpcException(-32602, 'Unsupported input type skill', null),
        const RemoteRpcException(
          -32602,
          'Unsupported input type mention',
          null,
        ),
        _rejection,
      ]);
    final d = await planFallbackDesktop(t);
    addTearDown(d.dispose);
    d.setPlan(true);
    expect(
      await d.sendDraft(mixed(text: '  Keep raw input  ')),
      isTrue,
      reason: d.error,
    );
    expect(t.actions, hasLength(5));
    expect(t.actions.last.containsKey('collaborationMode'), isFalse);
    expect(t.actions.last['input'], [
      {'type': 'image', 'image_url': 'data:image/jpeg;base64,YQ=='},
      {'type': 'text', 'text': 'Keep raw input\n\n\$review @drive @lib/a.dart'},
    ]);
    expect(
      t.actions.every(
        (a) =>
            a['model'] == 'provider-model' &&
            a['approvalsReviewer'] == 'user' &&
            a['approvalPolicy'] == 'on-request',
      ),
      isTrue,
    );
    expect(d.timeline.where((r) => r['type'] == 'userMessage'), hasLength(1));
  });

  test(
    'explicit Plan rejection retries the owned Start once and explains it',
    () async {
      final t = PlanFallbackTransport()..replies.add(_rejection);
      final d = await planFallbackDesktop(t);
      addTearDown(d.dispose);
      d.setPlan(true);
      expect(await d.send('  Plan this  '), isTrue, reason: d.error);
      expect(t.actions, hasLength(2));
      final initial = Map<String, dynamic>.of(t.actions.first);
      expect((initial.remove('collaborationMode') as Map)['mode'], 'plan');
      expect(t.actions.last, initial);
      expect(initial['model'], 'provider-model');
      expect(initial['effort'], 'high');
      expect(initial['approvalPolicy'], 'on-request');
      expect(initial['approvalsReviewer'], 'user');
      expect(d.supportsPlan, isFalse);
      expect(d.plan, isFalse);
      expect(d.threadList.data.planSessions, isEmpty);
      expect(
        d.timeline.where((r) => r['type'] == 'systemMessage').single['text'],
        planRuntimeNotice,
      );
      expect(d.timeline.where((r) => r['type'] == 'userMessage'), hasLength(1));
      t.events.add({
        'method': 'turn/completed',
        'params': {'threadId': 'thread', 'turnId': 'implemented'},
      });
      d.setPlan(true);
      expect(d.plan, isFalse);
      expect(await d.send('Continue normally'), isTrue, reason: d.error);
      expect(t.actions.last.containsKey('collaborationMode'), isFalse);
      expect(
        d.timeline.where((r) => r['type'] == 'systemMessage'),
        hasLength(1),
      );
    },
  );

  test('selected queued Plan Steer drops only the rejected field', () async {
    final t = PlanFallbackTransport()..replies.add(_rejection);
    final d = await planFallbackDesktop(t, running: true);
    addTearDown(d.dispose);
    d.setPlan(true);
    expect(
      await d.submitComposerDraft(DesktopComposerDraft(text: 'Queued plan')),
      isTrue,
    );
    expect(d.queuedDrafts, hasLength(1));
    expect(
      await d.steerQueuedDraft(d.queuedDrafts.single.id),
      isTrue,
      reason: d.error,
    );
    expect(t.actions, hasLength(2));
    expect(t.calls.where((c) => c['method'] == 'turn/start'), isEmpty);
    final initial = Map<String, dynamic>.of(t.actions.first);
    expect((initial.remove('collaborationMode') as Map)['mode'], 'plan');
    expect(t.actions.last, initial);
    expect(initial['expectedTurnId'], 'live');
    expect(d.queuedDrafts, isEmpty);
    expect(d.supportsPlan, isFalse);
    expect(d.threadList.data.planSessions, isEmpty);
    expect(d.timeline.where((r) => r['type'] == 'systemMessage'), isEmpty);
  });

  for (final failure in <Object>[
    TimeoutException('collaborationMode reply lost'),
    const RemoteRpcException(-32000, 'Unsupported collaborationMode', null),
    const RemoteRpcException(-32602, 'Permission denied', null),
    const RemoteRpcException(-32602, 'Invalid model', null),
  ]) {
    test('uncertain or unrelated failure never resends: $failure', () async {
      final t = PlanFallbackTransport()..replies.add(failure);
      final d = await planFallbackDesktop(t);
      addTearDown(d.dispose);
      d.setPlan(true);
      expect(await d.send('Do not replay'), isFalse);
      expect(t.actions, hasLength(1));
      expect(d.supportsPlan, isTrue);
      expect(d.threadList.data.planSessions['thread']?['source'], 'requested');
      expect(d.timeline.where((r) => r['type'] == 'systemMessage'), isEmpty);
    });
  }

  test(
    'a plain request cannot gain a fallback from a field it did not send',
    () async {
      final t = PlanFallbackTransport()..replies.add(_rejection);
      final d = await planFallbackDesktop(t);
      addTearDown(d.dispose);
      expect(await d.send('Normal'), isFalse);
      expect(t.actions, hasLength(1));
      expect(d.supportsPlan, isTrue);
    },
  );

  test(
    'a failed downgraded reply cannot claim a normal turn succeeded',
    () async {
      final t = PlanFallbackTransport()
        ..replies.addAll([_rejection, TimeoutException('Lost retry')]);
      final d = await planFallbackDesktop(t);
      addTearDown(d.dispose);
      d.setPlan(true);
      expect(await d.send('Plan'), isFalse);
      expect(t.actions, hasLength(2));
      expect(d.supportsPlan, isFalse);
      expect(d.threadList.data.planSessions, isEmpty);
      expect(d.timeline.where((r) => r['type'] == 'systemMessage'), isEmpty);
    },
  );

  test(
    'a newer native session survives an older rejected Plan request',
    () async {
      final t = PlanFallbackTransport()..replies.add(_rejection);
      final d = await planFallbackDesktop(t);
      addTearDown(d.dispose);
      d.setPlan(true);
      var count = 0;
      t.beforeReply = () {
        if (++count == 1) _native(t);
      };
      expect(await d.send('Plan'), isTrue, reason: d.error);
      expect(d.threadList.data.planSessions['thread']?['source'], 'native');
    },
  );

  test(
    'an old connection rejection cannot downgrade a replacement connection',
    () async {
      final t = PlanFallbackTransport();
      final d = await planFallbackDesktop(t);
      addTearDown(d.dispose);
      final gate = Completer<RemoteJson>();
      t.replies.add(gate);
      d.setPlan(true);
      final sending = d.send('Plan');
      await t.actionRequested.future;
      await d.disconnect();
      await d.connect((t.pairings as ReasoningPairings).pair);
      await d.openThread({
        'id': 'thread',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      gate.completeError(_rejection);
      expect(await sending, isFalse);
      expect(t.actions, hasLength(1));
      expect(d.supportsPlan, isTrue);
      expect(d.timeline.where((r) => r['type'] == 'systemMessage'), isEmpty);
    },
  );
}
