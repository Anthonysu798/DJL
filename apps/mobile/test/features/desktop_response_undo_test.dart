import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/workspace/domain/response_change_set.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'guardian_review_test.dart' show GuardianTransport, guardianDesktop;
import 'response_change_set_test.dart' show patch;
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';

class ResponseTransport extends GuardianTransport {
  ResponseTransport() : super(PairingRepository(TestCredentials()));
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'git/status' || method.startsWith('workspace/revertPatch')) {
      calls.add({'method': method, 'params': params});
      return method == 'git/status'
          ? {'isRepo': true, 'repoRoot': '/repo'}
          : method.endsWith('Preview')
          ? {
              'canRevert': true,
              'affectedFiles': ['a.txt'],
            }
          : {
              'success': true,
              'revertedFiles': ['a.txt'],
            };
    }
    return super.request(method, params, timeout: timeout);
  }
}

void main() {
  test(
    'raw hooks precede activity normalization for known background threads',
    () async {
      final t = ResponseTransport();
      final desktop = guardianDesktop(t)
        ..active = Pairing({
          'macDeviceId': t.mac,
          'sessionId': t.session,
          'macIdentityPublicKey': 'qa-pin',
        })
        ..thread = {'id': 'thread-1', 'cwd': '/repo'};
      desktop.threadList.data.upsert({'id': 'background', 'cwd': '/repo/sub'});
      for (final rpc in [
        {
          'method': 'item/completed',
          'params': {
            'threadId': 'background',
            'turnId': 'turn',
            'item': {
              'id': 'file',
              'type': 'fileChange',
              'status': 'completed',
              'changes': [
                {'path': 'a.txt', 'diff': patch},
              ],
            },
          },
        },
        {
          'method': 'turn/completed',
          'params': {
            'threadId': 'background',
            'turn': {'id': 'turn', 'status': 'completed'},
          },
        },
        {
          'method': 'item/completed',
          'params': {
            'threadId': 'background',
            'turnId': 'turn',
            'item': {'id': 'answer', 'type': 'agentMessage'},
          },
        },
      ]) {
        t.events.add(rpc);
      }
      final entry = desktop.threadList.data.responseChanges.forAssistant(
        'background',
        'answer',
      )!;
      expect(entry.ready, true);
      expect(entry.patches.single.forwardPatch, patch);
      expect(desktop.timeline.where((e) => e['id'] == 'answer'), isEmpty);
      desktop.dispose();
    },
  );
  test(
    'same-operation path-only file blocks preview and apply until complete authority arrives',
    () async {
      final t = ResponseTransport(),
          d = guardianDesktop(t)
            ..active = Pairing({
              'macDeviceId': t.mac,
              'sessionId': t.session,
              'macIdentityPublicKey': 'qa-pin',
            })
            ..thread = {'id': 'thread-1', 'cwd': '/repo'};
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn',
          'item': {
            'id': 'files',
            'type': 'fileChange',
            'status': 'completed',
            'changes': [
              {'path': 'a.txt', 'diff': patch},
              {'path': 'b.txt'},
            ],
          },
        },
      });
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn',
          'item': {'id': 'answer', 'type': 'agentMessage'},
        },
      });
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 'thread-1',
          'turn': {'id': 'turn', 'status': 'completed'},
        },
      });
      expect(await d.responseUndo('answer'), null);
      expect(
        t.calls.where(
          (c) => (c['method'] as String).startsWith('workspace/revertPatch'),
        ),
        isEmpty,
      );
      t.events.add({
        'method': 'turn/diff/updated',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn',
          'diff': patch + patch.replaceAll('a.txt', 'b.txt'),
        },
      });
      final c = await d.responseUndo('answer');
      expect(c, isNotNull);
      await c!.refresh();
      expect(c.canApply, true);
      c.dispose();
      d.dispose();
    },
  );
  test(
    'raw desktop hook keeps legacy msg turn IDs separate from distinct operation IDs',
    () async {
      final t = ResponseTransport(),
          d = guardianDesktop(t)
            ..active = Pairing({
              'macDeviceId': t.mac,
              'sessionId': t.session,
              'macIdentityPublicKey': 'qa-pin',
            })
            ..thread = {'id': 'thread-1', 'cwd': '/repo'};
      for (final call in ['one', 'two']) {
        t.events.add({
          'method': 'codex/event',
          'params': {
            'msg': {
              'type': 'patch_apply_end',
              'conversationId': 'thread-1',
              'id': 'turn',
              'call_id': call,
              'success': true,
              'changes': {
                'a.txt': {
                  'diff': call == 'one'
                      ? patch
                      : patch.replaceAll('+new', '+third'),
                },
              },
            },
          },
        });
      }
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn',
          'item': {'id': 'answer', 'type': 'agentMessage'},
        },
      });
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 'thread-1',
          'turn': {'id': 'turn', 'status': 'stopped'},
        },
      });
      final entry = d.responseChangesFor('answer')!;
      expect(entry.ready, true);
      expect(entry.patches.map((p) => p.id), ['two:0', 'one:0']);
      d.dispose();
    },
  );
  test(
    'same repository sibling/subdirectory run blocks and a new run invalidates preview',
    () async {
      final t = ResponseTransport(),
          d = guardianDesktop(t)
            ..active = Pairing({
              'macDeviceId': t.mac,
              'sessionId': t.session,
              'macIdentityPublicKey': 'qa-pin',
            })
            ..thread = {'id': 'thread-1', 'cwd': '/repo/sub-a'};
      d.threadList.data.upsert({'id': 'sibling', 'cwd': '/repo/sub-b'});
      final e =
          d.threadList.data.responseChanges.entry(
              'thread-1',
              'turn',
              '/repo/sub-a',
            )
            ..assistant = 'answer'
            ..terminal = true
            ..aggregate = ResponsePatch('turn', patch)
            ..evidence.add('a.txt');
      final c = await d.responseUndo('answer');
      expect(c, isNotNull);
      await c!.refresh();
      expect(c.canApply, true);
      t.events.add({
        'method': 'turn/started',
        'params': {
          'threadId': 'sibling',
          'turn': {'id': 'sibling-turn'},
        },
      });
      expect(d.responseUndoBlocked(e, repoRoot: '/repo'), isNotNull);
      await c.apply();
      expect(
        t.calls.where((c) => (c['method'] as String).endsWith('Apply')),
        isEmpty,
      );
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 'sibling',
          'turn': {'id': 'sibling-turn'},
        },
      });
      expect(c.current, false);
      c.dispose();
      d.dispose();
    },
  );
  test(
    'successful undo refreshes git metadata and saves tombstone, history does not invent authority',
    () async {
      final t = ResponseTransport(),
          d = guardianDesktop(t)
            ..active = Pairing({
              'macDeviceId': t.mac,
              'sessionId': t.session,
              'macIdentityPublicKey': 'qa-pin',
            })
            ..thread = {'id': 'thread-1', 'cwd': '/repo'};
      final e =
          d.threadList.data.responseChanges.entry('thread-1', 'turn', '/repo')
            ..assistant = 'answer'
            ..terminal = true
            ..aggregate = ResponsePatch('turn', patch)
            ..evidence.add('a.txt');
      final c = await d.responseUndo('answer');
      await c!.refresh();
      await c.apply();
      expect(e.reverted, true);
      expect(t.calls.where((c) => c['method'] == 'git/status').length, 3);
      c.dispose();
      d.dispose();
    },
  );
}
