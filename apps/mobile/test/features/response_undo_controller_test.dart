import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/workspace/domain/response_change_set.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'package:djl_mobile/features/workspace/presentation/response_undo_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'workspace_repository_test.dart' show WorkspaceTransport;
import 'response_change_set_test.dart' show patch;

class UndoTransport extends WorkspaceTransport {
  RemoteJson preview = {
        'canRevert': true,
        'affectedFiles': ['a.txt'],
      },
      result = {
        'success': true,
        'revertedFiles': ['a.txt'],
      };
  Completer<RemoteJson>? pending;
  bool fail = false;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    if (method.endsWith('Preview')) {
      return pending == null ? preview : await pending!.future;
    }
    if (fail) throw TimeoutException('unknown');
    return pending == null ? result : await pending!.future;
  }
}

ResponseChangeSet ready() => ResponseChangeSet('t', 'v', '/repo')
  ..assistant = 'a'
  ..terminal = true
  ..evidence.add('a.txt')
  ..aggregate = ResponsePatch('turn:v', patch);
void main() {
  test(
    'read-only preview then cancellation has no apply; exact reviewed parameters only',
    () async {
      final t = UndoTransport(), e = ready();
      final c = ResponseUndoController(
        WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
        e,
        isCurrent: () => true,
        blocked: () => null,
        onChanged: () {},
        onSuccess: () async {},
      );
      await c.refresh();
      c.dispose();
      expect(t.calls.length, 1);
      expect(t.calls.single['method'], 'workspace/revertPatchPreview');
      expect(t.calls.single['params'], {'cwd': '/repo', 'forwardPatch': patch});
    },
  );
  test(
    'staged conflicts and unsupported reasons disable apply even with canRevert true',
    () async {
      for (final extra in [
        {
          'stagedFiles': ['a.txt'],
        },
        {
          'conflicts': [
            {'path': 'a.txt', 'message': 'overlap'},
          ],
        },
        {
          'unsupportedReasons': ['binary'],
        },
      ]) {
        final t = UndoTransport()..preview = {'canRevert': true, ...extra};
        final c = ResponseUndoController(
          WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
          ready(),
          isCurrent: () => true,
          blocked: () => null,
          onChanged: () {},
          onSuccess: () async {},
        );
        await c.refresh();
        await c.apply();
        expect(t.calls.length, 1);
        c.dispose();
      }
    },
  );
  test(
    'scope, hash and a newly running sibling invalidate reviewed preview',
    () async {
      for (final change in ['scope', 'hash', 'busy']) {
        final t = UndoTransport(), e = ready();
        var scope = true;
        String? busy;
        final c = ResponseUndoController(
          WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
          e,
          isCurrent: () => scope,
          blocked: () => busy,
          onChanged: () {},
          onSuccess: () async {},
        );
        await c.refresh();
        if (change == 'scope') scope = false;
        if (change == 'hash') {
          e.aggregate = ResponsePatch(
            'turn:v',
            patch.replaceAll('+new', '+other'),
          );
        }
        if (change == 'busy') busy = 'A sibling chat is running.';
        await c.apply();
        expect(t.calls.length, 1);
        expect(e.reverted, false);
        c.dispose();
      }
    },
  );
  test('stale preview result cannot authorize apply', () async {
    final t = UndoTransport()..pending = Completer<RemoteJson>();
    var scope = true;
    final c = ResponseUndoController(
      WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
      ready(),
      isCurrent: () => scope,
      blocked: () => null,
      onChanged: () {},
      onSuccess: () async {},
    );
    final loading = c.refresh();
    scope = false;
    t.pending!.complete({'canRevert': true});
    await loading;
    expect(c.canApply, false);
    c.dispose();
  });
  test(
    'double tap sends once, only overall success marks tombstone and refreshes metadata',
    () async {
      final t = UndoTransport(), e = ready();
      var refreshes = 0;
      final c = ResponseUndoController(
        WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
        e,
        isCurrent: () => true,
        blocked: () => null,
        onChanged: () {},
        onSuccess: () async {
          refreshes++;
        },
      );
      await c.refresh();
      t.pending = Completer<RemoteJson>();
      final applying = c.apply();
      await c.apply();
      expect(t.calls.length, 2);
      expect(e.uncertain, true);
      t.pending!.complete({
        'success': true,
        'revertedFiles': ['a.txt'],
      });
      await applying;
      expect(e.reverted, true);
      expect(e.uncertain, false);
      expect(refreshes, 1);
      c.dispose();
    },
  );
  test(
    'two review sheets cannot apply the same response concurrently',
    () async {
      final t = UndoTransport(), e = ready();
      ResponseUndoController controller() => ResponseUndoController(
        WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
        e,
        isCurrent: () => true,
        blocked: () => null,
        onChanged: () {},
        onSuccess: () async {},
      );
      final first = controller(), second = controller();
      await first.refresh();
      await second.refresh();
      t.pending = Completer<RemoteJson>();
      final applying = first.apply();
      await Future<void>.delayed(Duration.zero);
      await second.apply();
      expect(
        t.calls.where((c) => (c['method'] as String).endsWith('Apply')).length,
        1,
      );
      t.pending!.complete({'success': true});
      await applying;
      first.dispose();
      second.dispose();
    },
  );
  test('a failed attempt invalidates previews held by another sheet', () async {
    final t = UndoTransport(), e = ready();
    ResponseUndoController controller() => ResponseUndoController(
      WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
      e,
      isCurrent: () => true,
      blocked: () => null,
      onChanged: () {},
      onSuccess: () async {},
    );
    final first = controller(), second = controller();
    await first.refresh();
    await second.refresh();
    t.result = {'success': false};
    await first.apply();
    await second.apply();
    expect(
      t.calls.where((c) => (c['method'] as String).endsWith('Apply')).length,
      1,
    );
    expect(second.canApply, false);
    first.dispose();
    second.dispose();
  });
  test(
    'mutation is not sent until uncertainty persistence completes',
    () async {
      final t = UndoTransport(), e = ready(), saved = Completer<void>();
      var saves = 0;
      final c = ResponseUndoController(
        WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
        e,
        isCurrent: () => true,
        blocked: () => null,
        onChanged: () {
          saves++;
          return saves == 1 ? saved.future : Future<void>.value();
        },
        onSuccess: () async {},
      );
      await c.refresh();
      final applying = c.apply();
      await Future<void>.delayed(Duration.zero);
      expect(t.calls.length, 1);
      saved.complete();
      await applying;
      expect(t.calls.length, 2);
      c.dispose();
    },
  );
  test(
    'timeout or malformed reply stays uncertain, no automatic replay or second apply',
    () async {
      for (final failure in ['timeout', 'malformed', 'false']) {
        final t = UndoTransport(), e = ready();
        final c = ResponseUndoController(
          WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
          e,
          isCurrent: () => true,
          blocked: () => null,
          onChanged: () {},
          onSuccess: () async {},
        );
        await c.refresh();
        t.fail = failure == 'timeout';
        t.result = failure == 'false'
            ? {
                'success': false,
                'patchResults': [
                  {'applied': true},
                ],
              }
            : {};
        await c.apply();
        await c.apply();
        expect(t.calls.length, 2);
        expect(e.reverted, false);
        expect(e.uncertain, failure != 'false');
        expect(c.preview, null);
        c.dispose();
      }
    },
  );
  test(
    'connection changes during apply leave an uncertain durable result',
    () async {
      final t = UndoTransport(), e = ready();
      var scope = true;
      final c = ResponseUndoController(
        WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
        e,
        isCurrent: () => scope,
        blocked: () => null,
        onChanged: () {},
        onSuccess: () async {},
      );
      await c.refresh();
      t.pending = Completer<RemoteJson>();
      final applying = c.apply();
      await Future<void>.delayed(Duration.zero);
      scope = false;
      t.pending!.complete({'success': true});
      await applying;
      expect(e.reverted, false);
      expect(e.uncertain, true);
      expect(c.preview, null);
      c.dispose();
    },
  );
  test('persistence failure prevents any apply RPC', () async {
    final t = UndoTransport(), e = ready();
    final c = ResponseUndoController(
      WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
      e,
      isCurrent: () => true,
      blocked: () => null,
      onChanged: () => throw StateError('storage unavailable'),
      onSuccess: () async {},
    );
    await c.refresh();
    await c.apply();
    expect(t.calls.length, 1);
    expect(e.reverted, false);
    c.dispose();
  });
  test(
    'fallback uses exact newest first batch objects without joining dependent patches',
    () async {
      final e = ready()..aggregate = null;
      e.batches.addAll([
        ResponsePatch('one', patch),
        ResponsePatch('two', patch.replaceAll('old', 'new')),
      ]);
      final t = UndoTransport();
      final c = ResponseUndoController(
        WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
        e,
        isCurrent: () => true,
        blocked: () => null,
        onChanged: () {},
        onSuccess: () async {},
      );
      await c.refresh();
      await c.apply();
      expect(t.calls.map((c) => c['method']), [
        'workspace/revertPatchBatchPreview',
        'workspace/revertPatchBatchApply',
      ]);
      expect(t.calls[0]['params'], t.calls[1]['params']);
      expect(
        ((t.calls[0]['params'] as Map)['patches'] as List).map((p) => p['id']),
        ['two', 'one'],
      );
      c.dispose();
    },
  );
}
