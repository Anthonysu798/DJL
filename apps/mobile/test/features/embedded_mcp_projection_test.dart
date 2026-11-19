import 'dart:convert';
import 'dart:io';

import 'package:djl_mobile/features/activity/domain/activity_reducer.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final status in ['completed', 'failed']) {
    test(
      'embedded MCP $status keeps one readable live and history card',
      () async {
        final result = await Process.run('bun', [
          '--eval',
          '''
const {createThreadEventProjection}=require('../remote-gateway/src/electron-event-projection.js');
const {appServerTurns}=require('../remote-gateway/src/electron-app-server-adapter.js');
const status=${jsonEncode(status)};
const data={id:'native-mcp',type:'mcpToolCall',server:'qa',tool:'inspect',arguments:{fixture:'public'}};
const activities=[
 {id:'start',tone:'tool',kind:'tool.started',turnId:'turn',createdAt:'2026-11-17T00:00:01Z',payload:{itemType:'mcp_tool_call',status:'inProgress',data}},
 {id:'done',tone:'tool',kind:'tool.completed',turnId:'turn',createdAt:'2026-11-17T00:00:02Z',payload:{itemType:'mcp_tool_call',status,data:{...data,...(status==='failed'?{error:{message:'MCP check failed'}}:{result:{content:[{type:'text',text:'MCP check passed'}]}})}}},
];
const projection=createThreadEventProjection();projection.hydrate({id:'thread'},0);
const events=activities.flatMap((activity,i)=>projection.applyThreadEvent({aggregateId:'thread',type:'thread.activity-appended',sequence:i+1,payload:{activity}}));
const history=appServerTurns({messages:[],activities});
console.log(JSON.stringify({events,history}));
''',
        ]);
        expect(result.exitCode, 0, reason: result.stderr.toString());
        final wire =
            jsonDecode(result.stdout as String) as Map<String, dynamic>;
        final reducer = ActivityReducer()..bind('mac');
        for (final event in wire['events'] as List) {
          reducer.ingest(
            event['method'] as String,
            Map<String, dynamic>.from(event['params'] as Map),
            knownThreads: {'thread'},
          );
        }
        expect(reducer.items, hasLength(1));
        final live = reducer.items.values.single;
        expect(live.item, 'native-mcp');
        expect(live.title, 'inspect');
        expect(live.status, status);
        expect(
          live.outputTail,
          status == 'failed' ? 'MCP check failed' : 'MCP check passed',
        );
        final turns = wire['history'] as List;
        expect(turns, hasLength(1));
        expect(turns.single['items'], hasLength(1));
        final restored = reducer.restore(
          Map<String, dynamic>.from(turns.single['items'].single as Map),
          thread: 'thread',
          turn: 'turn',
        );
        expect(restored?.id, live.id);
        expect(restored?.outputTail, live.outputTail);
        expect(reducer.items, hasLength(1));
      },
    );
  }
}
