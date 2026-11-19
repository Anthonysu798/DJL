import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/activity/domain/activity_reducer.dart';
import 'package:djl_mobile/features/activity/domain/desktop_activity.dart';
import 'package:djl_mobile/features/activity/presentation/activity_card.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_subagents_test.dart' show SubagentTransport, subagentDesktop;

void main() {
  late RemoteJson completion, history, childHistory, item;
  late String threadId, turnId, childId;

  setUpAll(() async {
    // Consume the real native fixture's wire events and history without changing
    // its MCP item shape or running the local gateway/native services.
    final result = await Process.run('bun', [
      '--eval',
      '''
import {createRuntimeFixture} from './integration_test/support/desktop_runtime_fixture.ts';
const messages=[];
let completed;
const done=new Promise(resolve=>completed=resolve);
const fixture=createRuntimeFixture('/tmp/disposable-mobile-task27',rpc=>{
  messages.push(JSON.parse(JSON.stringify(rpc)));
  if(rpc.method==='turn/completed')completed();
});
fixture.handle({id:1,method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[advanced] MCP compatibility'}]}});
let timeout;
await Promise.race([done,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Fixture completion timed out')),3000);})]);
clearTimeout(timeout);
const completion=messages.find(rpc=>rpc.method==='item/completed'&&rpc.params.item.type==='mcpToolCall');
const child=messages.find(rpc=>rpc.method==='item/completed'&&rpc.params.item.type==='collabAgentToolCall').params.item.receiverThreadIds[0];
fixture.handle({id:2,method:'thread/read',params:{threadId:'native-thread-1',includeTurns:true}});
const history=messages.at(-1).result.thread;
fixture.handle({id:3,method:'thread/read',params:{threadId:child,includeTurns:true}});
console.log(JSON.stringify({completion,history,childHistory:messages.at(-1).result.thread}));
''',
    ]);
    expect(result.exitCode, 0, reason: result.stderr.toString());
    final fixture = jsonDecode(result.stdout as String) as RemoteJson;
    completion = fixture['completion'] as RemoteJson;
    history = fixture['history'] as RemoteJson;
    childHistory = fixture['childHistory'] as RemoteJson;
    final params = completion['params'] as RemoteJson;
    item = params['item'] as RemoteJson;
    threadId = params['threadId'] as String;
    turnId = params['turnId'] as String;
    childId = childHistory['id'] as String;
    expect(item['type'], 'mcpToolCall');
    expect(item['server'], 'qa');
    expect(item['tool'], 'inspect_fixture');
  });

  DesktopActivity? decode(RemoteJson raw) => DesktopActivity.fromItem(
    raw,
    mac: 'mac-a',
    thread: threadId,
    turn: turnId,
  );

  SubagentTransport transport() => SubagentTransport()
    ..histories[threadId] = history
    ..histories[childId] = childHistory;

  test(
    'actual MCP completion is recognized with structured result and tool name',
    () {
      expect(
        isActivityNotification(
          'item/completed',
          completion['params'] as RemoteJson,
        ),
        isTrue,
      );
      final activity = decode(item);
      expect(activity, isNotNull);
      expect(activity!.kind, 'tool');
      expect(activity.item, item['id']);
      expect(activity.status, 'completed');
      expect(activity.title, 'inspect_fixture');
      expect(activity.outputTail, 'Structured QA tool output');
    },
  );

  test('MCP tool identity is a typed fallback and never command authority', () {
    expect(
      decode({...item, 'name': 'Explicit tool title'})?.title,
      'Explicit tool title',
    );
    expect(
      decode({
        ...item,
        'tool': {'name': 'Nested tool'},
      })?.title,
      'Nested tool',
    );
    expect(decode({...item, 'tool': 42})?.title, 'Tool activity');
    expect(
      decode({...item, 'tool': 'exec_command', 'name': 'exec_command'})?.kind,
      'tool',
    );
    expect(decode({...item, 'type': 'unrecognizedToolCall'}), isNull);
    expect(
      decode({...item, 'type': 'toolCall', 'name': 'exec_command'})?.kind,
      'command',
    );
    expect(
      decode({...item, 'type': 'toolCall', 'name': 'inspect_fixture'})?.kind,
      'tool',
    );
    expect(decode({...item, 'type': 'fileChange'})?.kind, 'fileChange');
  });

  test('MCP lifecycle normalization preserves tool kind like raw history', () {
    final reducer = ActivityReducer()..bind('mac-a');
    final raw = {...item, 'name': 'exec_command', 'command': 'echo fixture'};
    final live = reducer.ingest(
      'item/completed',
      {...completion['params'] as RemoteJson, 'item': raw},
      knownThreads: {threadId},
    );
    expect(live?.kind, 'tool');
    expect(live?.command, isEmpty);
    expect(live?.outputTail, 'Structured QA tool output');
    final restored = reducer.restore(raw, thread: threadId, turn: turnId);
    expect(restored?.kind, 'tool');
    expect(restored?.id, live?.id);
    expect(reducer.items, hasLength(1));
  });

  test(
    'actual live MCP completion survives actual history without duplication',
    () async {
      final wire = transport();
      final desktop = subagentDesktop(wire)..thread = {'id': threadId};
      addTearDown(desktop.dispose);
      await desktop.threadList.attach(wire.mac);
      wire.events.add(completion);
      final live = desktop.activity.items.values
          .where((activity) => activity.item == item['id'])
          .toList();
      expect(live, hasLength(1));
      expect(live.single.kind, 'tool');
      expect(live.single.outputTail, 'Structured QA tool output');
      final identity = live.single.id;
      await desktop.openThread({'id': threadId});
      final restored = desktop.timeline
          .map(DesktopActivity.fromRow)
          .whereType<DesktopActivity>()
          .where((activity) => activity.item == item['id'])
          .toList();
      expect(restored, hasLength(1));
      expect(restored.single.id, identity);
      expect(restored.single.title, 'inspect_fixture');
      expect(restored.single.outputTail, 'Structured QA tool output');
      expect(restored.single.status, 'completed');
    },
  );

  testWidgets(
    'actual MCP history opens real Tool details in a short viewport',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 460));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final wire = transport();
      final desktop = subagentDesktop(wire)..thread = {'id': threadId};
      addTearDown(desktop.dispose);
      await desktop.threadList.attach(wire.mac);
      await desktop.openThread({'id': threadId});
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopChatPage(
            controller: desktop,
            focusTarget: DesktopLinkTarget(
              threadId,
              item: item['id'] as String,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final card = find.byWidgetPredicate(
        (widget) =>
            widget is ActivityCard &&
            widget.activity.kind == 'tool' &&
            widget.activity.item == item['id'],
      );
      expect(card.hitTestable(), findsOneWidget);
      await tester.tap(card);
      await tester.pumpAndSettle();
      expect(find.text('Tool details'), findsOneWidget);
      expect(find.text('inspect_fixture'), findsWidgets);
      expect(find.text('Status: Completed'), findsOneWidget);
      expect(find.text('Structured QA tool output'), findsOneWidget);
      expect(find.textContaining('server:'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    },
  );
}
