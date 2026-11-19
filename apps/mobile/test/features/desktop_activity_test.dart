import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/activity/domain/desktop_activity.dart';
import 'package:djl_mobile/features/activity/domain/activity_reducer.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'guardian_review_test.dart'
    show GuardianTransport, guardianDesktop, guardianParams, emitGuardian;

class ActivityCacheStore extends RecoveryMemoryStore {
  final records = <String, RemoteJson>{};
  @override
  Future<RemoteJson> load(String mac) async =>
      jsonDecode(jsonEncode(records[mac] ?? {})) as RemoteJson;
  @override
  Future<void> save(String mac, RemoteJson value) async =>
      records[mac] = jsonDecode(jsonEncode(value)) as RemoteJson;
}

void main() {
  test(
    'command output becomes typed detail without replacing command identity',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      transport.events.add({
        'method': 'item/started',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn-1',
          'item': {
            'id': 'command-1',
            'type': 'commandExecution',
            'status': 'inProgress',
            'command': 'echo one',
            'cwd': '/tmp',
          },
        },
      });
      transport.events.add({
        'method': 'item/commandExecution/outputDelta',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn-1',
          'itemId': 'command-1',
          'delta': 'ONE\n',
        },
      });
      expect(desktop.timeline, hasLength(1));
      final activity = desktop.timeline.single['activity'] as Map?;
      expect(activity?['command'], 'echo one');
      expect(activity?['outputTail'], 'ONE\n');
      desktop.dispose();
    },
  );
  test(
    'structured tool output renders readable text rather than throwing a String cast',
    () {
      expect(
        desktopItemText({
          'type': 'toolCall',
          'output': {
            'content': [
              {'type': 'text', 'text': 'Read lib/a.dart'},
            ],
          },
        }),
        'Read lib/a.dart',
      );
    },
  );
  test(
    'legacy begin modern start and legacy output/end coalesce with exact metadata aliases',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      for (final rpc in [
        {
          'method': 'codex/event/exec_command_begin',
          'params': {
            'conversationId': 'thread-1',
            'id': 'turn-1',
            'msg': {
              'type': 'exec_command_begin',
              'call_id': 'call-1',
              'turn_id': 'turn-1',
              'cwd': '/tmp',
              'command': ['/bin/zsh', '-lc', 'echo one'],
            },
          },
        },
        {
          'method': 'item/started',
          'params': {
            'threadId': 'thread-1',
            'turnId': 'turn-1',
            'item': {
              'id': 'call-1',
              'type': 'commandExecution',
              'command': '/bin/zsh -lc "echo one"',
              'status': 'inProgress',
            },
          },
        },
        {
          'method': 'codex/event/exec_command_output_delta',
          'params': {
            'conversationId': 'thread-1',
            'id': 'turn-1',
            'msg': {
              'type': 'exec_command_output_delta',
              'callId': 'call-1',
              'turn_id': 'turn-1',
              'delta': 'ONE\n',
            },
          },
        },
        {
          'method': 'codex/event',
          'params': {
            'conversationId': 'thread-1',
            'id': 'turn-1',
            'event': {
              'type': 'exec_command_end',
              'call_id': 'call-1',
              'turn_id': 'turn-1',
              'status': 'completed',
              'exit_code': 0,
              'duration_ms': 42,
            },
          },
        },
      ]) {
        transport.events.add(rpc);
      }
      expect(desktop.timeline, hasLength(1));
      final a = DesktopActivity.fromRow(desktop.timeline.single)!;
      expect(a.command, '/bin/zsh -lc "echo one"');
      expect(a.outputTail, 'ONE\n');
      expect(a.cwd, '/tmp');
      expect(a.exitCode, 0);
      expect(a.durationMs, 42);
      expect(a.status, 'completed');
      desktop.dispose();
    },
  );
  for (final method in [
    'item/commandExecution/outputDelta',
    'item/command_execution/outputDelta',
    'item/toolCall/outputDelta',
    'item/toolCall/output_delta',
    'item/tool_call/outputDelta',
    'item/tool_call/output_delta',
    'item/fileChange/outputDelta',
  ]) {
    test(
      '$method captures source-shaped output without losing terminal state',
      () async {
        final transport = GuardianTransport(
          PairingRepository(TestCredentials()),
        );
        final desktop = guardianDesktop(transport);
        final type = method.contains('command')
            ? 'commandExecution'
            : method.contains('file')
            ? 'fileChange'
            : 'toolCall';
        transport.events.add({
          'method': 'item/completed',
          'params': {
            'threadId': 'thread-1',
            'turnId': 'turn-1',
            'item': {
              'id': 'item-1',
              'type': type,
              'status': 'completed',
              'command': 'echo finished',
              'name': 'search',
            },
          },
        });
        transport.events.add({
          'method': method,
          'params': {
            'thread_id': 'thread-1',
            'turn_id': 'turn-1',
            'item_id': 'item-1',
            'delta': 'Read lib/a.dart\n',
          },
        });
        transport.events.add({
          'method': 'item/started',
          'params': {
            'threadId': 'thread-1',
            'turnId': 'turn-1',
            'item': {'id': 'item-1', 'type': type, 'status': 'inProgress'},
          },
        });
        expect(desktop.timeline, hasLength(1));
        final a = DesktopActivity.fromRow(desktop.timeline.single)!;
        expect(a.status, 'completed');
        expect(a.outputTail, 'Read lib/a.dart\n');
        desktop.dispose();
      },
    );
  }
  for (final method in [
    'item/commandExecution/terminalInteraction',
    'item/command_execution/terminalInteraction',
  ]) {
    test(
      '$method after completion cannot revive the command and late start fills missing details',
      () async {
        final transport = GuardianTransport(
          PairingRepository(TestCredentials()),
        );
        final desktop = guardianDesktop(transport);
        transport.events.add({
          'method': 'item/completed',
          'params': {
            'threadId': 'thread-1',
            'turnId': 'turn-1',
            'item': {
              'id': 'command',
              'type': 'commandExecution',
              'status': 'failed',
              'exitCode': 2,
            },
          },
        });
        transport.events.add({
          'method': method,
          'params': {
            'threadId': 'thread-1',
            'turnId': 'turn-1',
            'itemId': 'command',
            'command': 'npm test',
            'cwd': '/repo',
          },
        });
        expect(desktop.timeline, hasLength(1));
        final a = DesktopActivity.fromRow(desktop.timeline.single)!;
        expect(a.status, 'failed');
        expect(a.command, 'npm test');
        expect(a.cwd, '/repo');
        expect(a.exitCode, 2);
        desktop.dispose();
      },
    );
  }
  test(
    'structured tool output text/list/null and exec arguments decode without raw map casts',
    () {
      for (final (output, expected) in [
        (
          {
            'content': [
              {'type': 'text', 'text': 'Read file'},
            ],
          },
          'Read file',
        ),
        (
          [
            {'message': 'Read a'},
            {'text': 'Search b'},
          ],
          'Read a\nSearch b',
        ),
        (null, ''),
        ({'count': 3}, ''),
      ]) {
        final a = DesktopActivity.fromItem(
          {
            'type': 'toolCall',
            'id': 'tool',
            'name': 'search',
            'output': output,
          },
          mac: 'mac',
          thread: 'thread',
          turn: 'turn',
        )!;
        expect(a.outputTail, expected);
      }
      final a = DesktopActivity.fromItem(
        {
          'type': 'toolCall',
          'id': 'call',
          'name': 'exec_command',
          'arguments': '{"cmd":"git status --short","workdir":"/repo"}',
        },
        mac: 'mac',
        thread: 'thread',
        turn: 'turn',
      )!;
      expect(a.kind, 'command');
      expect(a.command, 'git status --short');
      expect(a.cwd, '/repo');
      expect(a.status, 'completed');
    },
  );
  test(
    'source output tail retains last30 lines across delta snapshot history and encrypted-state serialization',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      final output = List.generate(40, (i) => 'line$i').join('\n');
      transport.events.add({
        'method': 'item/started',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn-1',
          'item': {
            'id': 'run',
            'type': 'commandExecution',
            'command': 'long command',
            'cwd': '/repo',
          },
        },
      });
      transport.events.add({
        'method': 'item/commandExecution/outputDelta',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn-1',
          'itemId': 'run',
          'delta': output,
        },
      });
      transport.history = {
        'id': 'thread-1',
        'turns': [
          {
            'id': 'turn-1',
            'items': [
              {
                'id': 'run',
                'type': 'commandExecution',
                'command': 'cmd',
                'status': 'completed',
                'output': 'line39',
              },
            ],
          },
        ],
      };
      await desktop.openThread({'id': 'thread-1'});
      expect(desktop.timeline, hasLength(1));
      final a = DesktopActivity.fromRow(desktop.timeline.single)!;
      expect(a.command, 'long command');
      expect(a.cwd, '/repo');
      expect(a.outputTail.split('\n'), hasLength(30));
      expect(a.outputTail.split('\n').first, 'line10');
      expect(a.outputTail.split('\n').last, 'line39');
      final saved = desktop.threadList.data.toJson();
      final restored = ThreadLocalState.fromJson(
        jsonDecode(jsonEncode(saved)) as Map<String, dynamic>,
      );
      expect(
        DesktopActivity.fromRow(
          restored.timelines['thread-1']!.single,
        )!.outputTail,
        a.outputTail,
      );
      desktop.dispose();
    },
  );
  test(
    'two threads two turns and device replacement keep identical item IDs distinct',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      for (final (thread, turn, text) in [
        ('thread-1', 'turn-a', 'FIRST'),
        ('thread-1', 'turn-b', 'SECOND'),
        ('other-thread', 'turn-b', 'OTHER'),
      ]) {
        transport.events.add({
          'method': 'item/commandExecution/outputDelta',
          'params': {
            'threadId': thread,
            'turnId': turn,
            'itemId': 'same-id',
            'delta': text,
          },
        });
      }
      expect(desktop.timeline, hasLength(2));
      expect(
        desktop.timeline.map((row) => DesktopActivity.fromRow(row)!.outputTail),
        ['FIRST', 'SECOND'],
      );
      expect(
        DesktopActivity.fromRow(
          desktop.threadList.data.timelines['other-thread']!.single,
        )!.outputTail,
        'OTHER',
      );
      desktop.thread = {'id': 'new-thread'};
      desktop.timeline = [];
      transport.mac = 'mac-b';
      transport.session = 'session-b';
      desktop.active = const Pairing({
        'macDeviceId': 'mac-b',
        'sessionId': 'session-b',
      });
      await desktop.threadList.attach('mac-b');
      transport.events.add({
        'method': 'item/commandExecution/outputDelta',
        '_macDeviceId': 'mac-a',
        '_sessionId': 'secure-a',
        'params': {
          'threadId': 'new-thread',
          'turnId': 'turn-a',
          'itemId': 'same-id',
          'delta': 'OLD',
        },
      });
      transport.events.add({
        'method': 'item/commandExecution/outputDelta',
        'params': {
          'threadId': 'new-thread',
          'turnId': 'turn-a',
          'itemId': 'same-id',
          'delta': 'NEW',
        },
      });
      expect(desktop.timeline, hasLength(1));
      expect(
        DesktopActivity.fromRow(desktop.timeline.single)!.outputTail,
        'NEW',
      );
      expect(desktop.threadList.data.timelines.containsKey('thread-1'), false);
      desktop.dispose();
    },
  );
  test(
    'history overlap preserves chat guardian and richer activity ordering and missing live rows',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      await desktop.threadList.attach('mac-a');
      desktop.timeline.add({
        'id': 'before',
        'type': 'agentMessage',
        'text': 'Before',
      });
      emitGuardian(transport, guardianParams());
      transport.events.add({
        'method': 'item/started',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn-1',
          'item': {
            'id': 'run',
            'type': 'commandExecution',
            'command': 'npm test',
            'cwd': '/repo',
          },
        },
      });
      transport.events.add({
        'method': 'item/commandExecution/outputDelta',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn-1',
          'itemId': 'run',
          'delta': 'Full output\nMore details',
        },
      });
      desktop.timeline.add({
        'id': 'after',
        'type': 'agentMessage',
        'text': 'After',
      });
      transport.history = {
        'id': 'thread-1',
        'turns': [
          {
            'id': 'turn-1',
            'items': [
              {'id': 'before', 'type': 'agentMessage', 'text': 'Before'},
              {'id': 'after', 'type': 'agentMessage', 'text': 'After'},
            ],
          },
        ],
      };
      await desktop.openThread({'id': 'thread-1'});
      expect(desktop.timeline.map((row) => row['type']), [
        'agentMessage',
        'automaticApprovalReview',
        'commandExecution',
        'agentMessage',
      ]);
      expect(
        DesktopActivity.fromRow(desktop.timeline[2])!.outputTail,
        'Full output\nMore details',
      );
      desktop.dispose();
    },
  );
  test(
    'file-change arrays maps nested patch tools and source diff aliases retain path kind and diff',
    () {
      final entries = ActivityFileChange.decode({
        'changes': {
          'lib/a.dart': {
            'kind': {'type': 'update'},
            'unified_diff': '@@ -1 +1 @@\n-old\n+new',
            'lines_added': 1,
            'lines_deleted': 1,
          },
          'new.txt': {'action': 'create', 'content': 'hello'},
        },
      });
      expect(entries.map((f) => f.path), ['lib/a.dart', 'new.txt']);
      expect(entries.first.kind, 'update');
      expect(entries.first.diff, '@@ -1 +1 @@\n-old\n+new');
      expect(entries.first.additions, 1);
      expect(entries.first.deletions, 1);
      expect(
        entries.last.diff,
        'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n+hello',
      );
      final patch = DesktopActivity.fromItem(
        {
          'id': 'patch',
          'type': 'toolCall',
          'name': 'apply_patch',
          'result': {
            'fileChanges': [
              {'file_path': 'gone.txt', 'kind': 'delete', 'patch': '-removed'},
            ],
          },
        },
        mac: 'mac',
        thread: 'thread',
        turn: 'turn',
      )!;
      expect(patch.kind, 'fileChange');
      expect(patch.files.single.path, 'gone.txt');
      expect(patch.files.single.kind, 'delete');
      expect(patch.files.single.diff, '-removed');
    },
  );
  test(
    'essential legacy read search list background aliases deduplicate for4s and cannot revive a finished turn',
    () {
      var now = DateTime.utc(2026);
      final reducer = ActivityReducer(now: () => now)..bind('mac');
      reducer.observeTurn(
        'turn/started',
        {'threadId': 'thread', 'turnId': 'turn'},
        knownThreads: {'thread'},
      );
      for (final (method, payload) in [
        ('read', {'path': 'lib/a.dart'}),
        ('search', {'query': 'symbol'}),
        ('list_files', {'path': '/repo'}),
        ('background_event', {'message': 'Exploring project'}),
      ]) {
        reducer.ingest(
          'codex/event/$method',
          {'threadId': 'thread', 'turnId': 'turn', ...payload},
          knownThreads: {'thread'},
        );
      }
      expect(reducer.items, hasLength(1));
      final a = reducer.items.values.single;
      expect(
        a.outputTail,
        'Read lib/a.dart\nSearch symbol\nList files /repo\nExploring project\n',
      );
      reducer.ingest(
        'codex/event/background_event',
        {
          'threadId': 'thread',
          'turnId': 'turn',
          'message': 'Exploring project',
        },
        knownThreads: {'thread'},
      );
      expect(a.outputTail.split('Exploring project'), hasLength(2));
      now = now.add(const Duration(seconds: 5));
      reducer.ingest(
        'codex/event/background_event',
        {
          'threadId': 'thread',
          'turnId': 'turn',
          'message': 'Exploring project',
        },
        knownThreads: {'thread'},
      );
      expect(a.outputTail.split('Exploring project'), hasLength(3));
      reducer.observeTurn(
        'turn/completed',
        {'threadId': 'thread', 'turnId': 'turn'},
        knownThreads: {'thread'},
      );
      reducer.ingest(
        'codex/event/read',
        {'threadId': 'thread', 'path': 'late'},
        knownThreads: {'thread'},
      );
      expect(a.status, 'completed');
      expect(a.outputTail, isNot(contains('late')));
    },
  );
  test(
    'ambiguous thread or turn-less repeated item cannot be silently routed to the selected chat',
    () {
      final reducer = ActivityReducer()..bind('mac');
      for (final (thread, turn) in [
        ('a', 'shared-turn'),
        ('b', 'shared-turn'),
      ]) {
        reducer.ingest(
          'item/commandExecution/outputDelta',
          {
            'threadId': thread,
            'turnId': turn,
            'itemId': 'same',
            'delta': thread,
          },
          knownThreads: {'a', 'b'},
        );
      }
      expect(
        reducer.ingest(
          'item/commandExecution/outputDelta',
          {'turnId': 'shared-turn', 'itemId': 'same', 'delta': 'ambiguous'},
          knownThreads: {'a', 'b'},
          selectedThread: 'a',
        ),
        isNull,
      );
      expect(
        reducer.ingest(
          'item/toolCall/outputDelta',
          {'delta': 'Read arbitrary'},
          knownThreads: {'a', 'b'},
          selectedThread: 'a',
        ),
        isNull,
      );
      expect(reducer.items.values.map((a) => a.outputTail), ['a', 'b']);
    },
  );

  test(
    'short generic history cannot replace a known failed command outcome',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      await desktop.threadList.attach('mac-a');
      transport.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn-1',
          'item': {
            'id': 'run',
            'type': 'commandExecution',
            'command': 'npm test',
            'status': 'failed',
            'exitCode': 2,
            'output': 'Known failure detail',
          },
        },
      });
      transport.history = {
        'id': 'thread-1',
        'turns': [
          {
            'id': 'turn-1',
            'items': [
              {'id': 'run', 'type': 'commandExecution', 'command': 'npm test'},
            ],
          },
        ],
      };
      await desktop.openThread({'id': 'thread-1'});
      expect(
        DesktopActivity.fromRow(desktop.timeline.single)!.status,
        'failed',
      );
      desktop.dispose();
    },
  );

  test(
    'structured stdout and stderr both remain visible without dumping arbitrary result metadata',
    () {
      final a = DesktopActivity.fromItem(
        {
          'type': 'toolCall',
          'id': 'tool',
          'name': 'build',
          'output': {
            'stdout': 'build output',
            'stderr': 'build error',
            'internalMetadata': {'opaque': true},
          },
        },
        mac: 'mac',
        thread: 'thread',
        turn: 'turn',
      )!;
      expect(a.outputTail, 'build output\nbuild error');
      expect(a.outputTail, isNot(contains('internalMetadata')));
    },
  );
  test(
    'buffered replay fills missing output without duplicating retained chunks or reviving a terminal row',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      transport.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn-1',
          'item': {
            'id': 'run',
            'type': 'commandExecution',
            'command': 'echo replay',
            'status': 'completed',
          },
        },
      });
      for (var i = 0; i < 2; i++) {
        transport.events.add({
          'method': 'item/commandExecution/outputDelta',
          'params': {
            'threadId': 'thread-1',
            'turnId': 'turn-1',
            'itemId': 'run',
            'delta': 'Buffered output\n',
            'djlReplayedEvent': true,
          },
        });
      }
      final a = DesktopActivity.fromRow(desktop.timeline.single)!;
      expect(a.outputTail, 'Buffered output\n');
      expect(a.status, 'completed');
      expect(desktop.turnId, isNull);
      desktop.dispose();
    },
  );

  test(
    'source legacy patch apply lifecycle retains its file details and explicit failure',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      for (final end in [false, true]) {
        transport.events.add({
          'method': 'codex/event/patch_apply_${end ? 'end' : 'begin'}',
          'params': {
            'conversationId': 'thread-1',
            'msg': {
              'call_id': 'patch',
              'turn_id': 'turn-1',
              'changes': {
                'lib/a.dart': {
                  'type': 'update',
                  'unified_diff': '@@ -1 +1 @@\n-old\n+new',
                },
              },
              if (end) 'success': false,
            },
          },
        });
      }
      expect(desktop.timeline, hasLength(1));
      final a = DesktopActivity.fromRow(desktop.timeline.single)!;
      expect(a.kind, 'fileChange');
      expect(a.status, 'failed');
      expect(a.files.single.path, 'lib/a.dart');
      expect(a.files.single.diff, '@@ -1 +1 @@\n-old\n+new');
      desktop.dispose();
    },
  );
  for (final envelope in ['msg', 'event']) {
    test(
      'generic legacy $envelope exec begin two output chunks and end append one scoped terminal row',
      () async {
        final transport = GuardianTransport(
          PairingRepository(TestCredentials()),
        );
        final desktop = guardianDesktop(transport);
        void send(String type, RemoteJson payload, {bool replay = false}) =>
            transport.events.add({
              'method': 'codex/event',
              'params': {
                if (!payload.containsKey('thread_id'))
                  'conversationId': 'thread-1',
                'id': 'turn-1',
                envelope: {
                  'type': type,
                  if (!payload.containsKey('callId')) 'call_id': 'call-1',
                  if (!payload.containsKey('turnId')) 'turn_id': 'turn-1',
                  ...payload,
                },
                if (replay) 'djlReplayedEvent': true,
              },
            });
        send('exec_command_begin', {
          'command': ['/bin/zsh', '-lc', 'echo one'],
          'cwd': '/repo',
        });
        send('exec_command_output_delta', {'delta': 'ONE\n'});
        send('exec_command_output_delta', {
          'thread_id': 'thread-1',
          'callId': 'call-1',
          'turnId': 'turn-1',
          'text': 'TWO\n',
        });
        expect(
          DesktopActivity.fromRow(desktop.timeline.single)!.outputTail,
          'ONE\nTWO\n',
        );
        send('exec_command_end', {
          'status': 'completed',
          'exit_code': 0,
          'duration_ms': 42,
        });
        send('exec_command_output_delta', {'delta': 'LATE\n'});
        send('exec_command_output_delta', {
          'delta': 'BUFFERED\n',
        }, replay: true);
        send('exec_command_output_delta', {
          'delta': 'BUFFERED\n',
        }, replay: true);
        expect(desktop.timeline, hasLength(1));
        final a = DesktopActivity.fromRow(desktop.timeline.single)!;
        expect(a.mac, 'mac-a');
        expect(a.thread, 'thread-1');
        expect(a.turn, 'turn-1');
        expect(a.item, 'call-1');
        expect(a.command, '/bin/zsh -lc echo one');
        expect(a.cwd, '/repo');
        expect(a.status, 'completed');
        expect(a.exitCode, 0);
        expect(a.durationMs, 42);
        expect(a.outputTail, 'ONE\nTWO\nLATE\nBUFFERED\n');
        expect(desktop.turnId, isNull);
        expect(transport.calls, isEmpty);
        desktop.dispose();
      },
    );
  }
  for (final recreate in [true, false]) {
    test(
      '${recreate ? 'recreated controller' : 'returned device'} hydrates unselected cached terminal details before start delta and replay',
      () async {
        final store = ActivityCacheStore();
        var transport = GuardianTransport(PairingRepository(TestCredentials()));
        DesktopController make(GuardianTransport link) =>
            DesktopController(
                link.pairings,
                connection: link,
                localStore: store,
              )
              ..active = Pairing({
                'macDeviceId': link.mac,
                'sessionId': link.session,
              })
              ..thread = {'id': 'selected'};
        var desktop = make(transport);
        await desktop.threadList.attach('mac-a');
        desktop.threadList.data.upsert({'id': 'selected'});
        desktop.threadList.data.upsert({'id': 'cached'});
        desktop.threadList.data.upsert({'id': 'other-thread'});
        for (final (thread, turn, command, output) in [
          ('cached', 'turn-1', 'npm test --with-rich-details', 'CACHED\n'),
          ('cached', 'turn-2', 'other turn command', 'OTHER TURN\n'),
          ('other-thread', 'turn-1', 'other thread command', 'OTHER THREAD\n'),
        ]) {
          transport.events.add({
            'method': 'item/completed',
            'params': {
              'threadId': thread,
              'turnId': turn,
              'item': {
                'id': 'same-item',
                'type': 'commandExecution',
                'command': command,
                'cwd': '/repo',
                'status': 'failed',
                'exitCode': 2,
                'durationMs': 88,
                'aggregatedOutput': output,
              },
            },
          });
        }
        transport.events.add({
          'method': 'item/completed',
          'params': {
            'threadId': 'cached',
            'turnId': 'turn-1',
            'item': {
              'id': 'file-item',
              'type': 'fileChange',
              'cwd': '/repo',
              'status': 'completed',
              'changes': [
                {
                  'path': 'lib/a.dart',
                  'kind': 'update',
                  'diff': '@@ -1 +1 @@\n-old\n+new',
                  'additions': 1,
                  'deletions': 1,
                },
              ],
            },
          },
        });
        await desktop.threadList.saveNow();
        if (recreate) {
          desktop.dispose();
          transport = GuardianTransport(PairingRepository(TestCredentials()));
          desktop = make(transport);
        } else {
          transport.mac = 'mac-b';
          transport.session = 'secure-b';
          desktop.active = const Pairing({
            'macDeviceId': 'mac-b',
            'sessionId': 'secure-b',
          });
          desktop.thread = {'id': 'selected-b'};
          desktop.timeline = [];
          await desktop.threadList.attach('mac-b');
          transport.events.add({
            'method': 'item/commandExecution/outputDelta',
            'params': {
              'threadId': 'cached',
              'turnId': 'turn-1',
              'itemId': 'same-item',
              'delta': 'DEVICE B ONLY',
            },
          });
          transport.mac = 'mac-a';
          transport.session = 'secure-return';
          desktop.active = const Pairing({
            'macDeviceId': 'mac-a',
            'sessionId': 'secure-return',
          });
          desktop.thread = {'id': 'selected'};
          desktop.timeline = [];
        }
        await desktop.threadList.attach('mac-a');
        transport.events.add({
          'method': 'item/started',
          'params': {
            'threadId': 'cached',
            'turnId': 'turn-1',
            'item': {
              'id': 'same-item',
              'type': 'commandExecution',
              'status': 'inProgress',
            },
          },
        });
        transport.events.add({
          'method': 'item/started',
          'params': {
            'threadId': 'cached',
            'turnId': 'turn-1',
            'item': {
              'id': 'file-item',
              'type': 'fileChange',
              'status': 'inProgress',
            },
          },
        });
        transport.events.add({
          'method': 'item/commandExecution/outputDelta',
          'params': {
            'threadId': 'cached',
            'turnId': 'turn-1',
            'itemId': 'same-item',
            'delta': 'NEW\n',
          },
        });
        for (var i = 0; i < 2; i++) {
          transport.events.add({
            'method': 'item/commandExecution/outputDelta',
            'params': {
              'threadId': 'cached',
              'turnId': 'turn-1',
              'itemId': 'same-item',
              'delta': 'BUFFERED\n',
              'djlReplayedEvent': true,
            },
          });
        }
        transport.events.add({
          'method': 'item/commandExecution/outputDelta',
          'params': {
            'turnId': 'turn-1',
            'itemId': 'same-item',
            'delta': 'AMBIGUOUS',
          },
        });
        List<DesktopActivity> cached() => desktop
            .threadList
            .data
            .timelines['cached']!
            .map(DesktopActivity.fromRow)
            .whereType<DesktopActivity>()
            .toList();
        final command = cached().singleWhere(
          (a) => a.item == 'same-item' && a.turn == 'turn-1',
        );
        expect(command.status, 'failed');
        expect(command.command, 'npm test --with-rich-details');
        expect(command.cwd, '/repo');
        expect(command.exitCode, 2);
        expect(command.durationMs, 88);
        expect(command.outputTail, 'CACHED\nNEW\nBUFFERED\n');
        expect(
          cached().singleWhere((a) => a.turn == 'turn-2').outputTail,
          'OTHER TURN\n',
        );
        final files = cached().singleWhere((a) => a.item == 'file-item');
        expect(files.status, 'completed');
        expect(files.files.single.path, 'lib/a.dart');
        expect(files.files.single.diff, '@@ -1 +1 @@\n-old\n+new');
        expect(files.files.single.additions, 1);
        expect(files.files.single.deletions, 1);
        expect(desktop.timeline, isEmpty);
        expect(transport.calls, isEmpty);
        expect(
          DesktopActivity.fromRow(
            desktop.threadList.data.timelines['other-thread']!.single,
          )!.outputTail,
          'OTHER THREAD\n',
        );
        await desktop.openThread({'id': 'cached'});
        final opened = desktop.timeline
            .map(DesktopActivity.fromRow)
            .whereType<DesktopActivity>()
            .toList();
        expect(opened, hasLength(3));
        expect(
          opened
              .singleWhere((a) => a.item == 'same-item' && a.turn == 'turn-1')
              .outputTail,
          'CACHED\nNEW\nBUFFERED\n',
        );
        expect(
          opened
              .singleWhere((a) => a.item == 'same-item' && a.turn == 'turn-1')
              .status,
          'failed',
        );
        expect(
          opened.singleWhere((a) => a.item == 'file-item').files.single.diff,
          '@@ -1 +1 @@\n-old\n+new',
        );
        desktop.dispose();
      },
    );
  }
}
