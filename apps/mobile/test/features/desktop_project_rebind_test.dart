import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_worktree_routing.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_new_chat_draft_test.dart' show draftDesktop;
import 'desktop_saved_toolbar_test.dart' show SavedToolbarTransport;

const localCwd = '/qa/Local';
const worktreeCwd = '/qa/.codex/worktrees/opaque/项目 100%';

class RebindTransport extends SavedToolbarTransport {
  RebindTransport(super.pairings);
  Completer<RemoteJson>? reply;
  Object? failure;
  RemoteJson response = {
    'thread': {'id': 'same-chat', 'cwd': localCwd},
  };
  int revision = 1;
  @override
  int get connectionRevision => revision;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/resume') {
      calls.add({'method': method, 'params': Map.of(params)});
      if (failure != null) throw failure!;
      return reply?.future ?? response;
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<DesktopController> rebindDesktop(RebindTransport remote) async {
  final desktop = await draftDesktop(remote);
  desktop.thread = {
    'id': 'same-chat',
    'cwd': localCwd,
    'name': 'Owned title',
    'model': 'qa',
    'modelProvider': 'codex',
  };
  desktop.timeline = [
    {'role': 'assistant', 'text': 'Retained history'},
  ];
  desktop.threadList.data.upsert(desktop.thread!);
  desktop.threadList.data.drafts['same-chat'] = 'Unsent owned draft';
  desktop.model = 'qa';
  desktop.effort = 'high';
  desktop.plan = true;
  return desktop;
}

void main() {
  test(
    'an old project reservation cannot unlock or authorize a new session operation',
    () async {
      final remote = RebindTransport(PairingRepository(TestCredentials()));
      final desktop = await rebindDesktop(remote);
      addTearDown(desktop.dispose);
      final old = desktop.reserveProjectMove();
      expect(desktop.projectMoveBusy, isTrue);
      remote.session = 'replacement-session';
      expect(desktop.projectMoveBusy, isFalse);
      final current = desktop.reserveProjectMove();
      desktop.releaseProjectMove(old);
      expect(desktop.projectMoveBusy, isTrue);
      await expectLater(
        desktop.moveThreadToProjectPath(worktreeCwd, operationOwner: old),
        throwsA(isA<StateError>()),
      );
      await expectLater(
        desktop.moveThreadToProjectPath(worktreeCwd, operationOwner: Object()),
        throwsA(isA<StateError>()),
      );
      expect(remote.calls, isEmpty);
      desktop.releaseProjectMove(current);
      expect(desktop.runtimeReady, isTrue);
    },
  );
  test(
    'managed worktree classification uses bounded canonical remote components',
    () {
      for (final path in [worktreeCwd, r'C:\qa\.codex\worktrees\token\repo']) {
        expect(isManagedWorktreePath(path), isTrue, reason: path);
      }
      for (final path in [
        '/qa/.codex/worktrees',
        '/qa/.codex/worktrees/../Main',
        '/qa/not.codex/worktrees/token',
        '/qa/.codex/worktrees-not/token',
        'relative/.codex/worktrees/token',
      ]) {
        expect(isManagedWorktreePath(path), isFalse, reason: path);
      }
    },
  );
  test(
    'same-thread project resume preserves history draft runtime and authoritative cwd',
    () async {
      final remote = RebindTransport(PairingRepository(TestCredentials()));
      final desktop = await rebindDesktop(remote);
      addTearDown(desktop.dispose);
      final history = List<RemoteJson>.from(desktop.timeline);
      final moved = await desktop.moveThreadToProjectPath(' $worktreeCwd ');
      expect(moved['id'], 'same-chat');
      expect(moved['cwd'], worktreeCwd);
      expect(desktop.thread?['name'], 'Owned title');
      expect(desktop.timeline, history);
      expect(desktop.threadList.data.drafts['same-chat'], 'Unsent owned draft');
      expect(
        (desktop.model, desktop.effort, desktop.plan),
        ('qa', 'high', true),
      );
      expect(desktop.busy, isFalse);
      expect(remote.calls.map((c) => c['method']), ['thread/resume']);
      expect(
        remote.calls.single['params'],
        containsPair('threadId', 'same-chat'),
      );
      expect(remote.calls.single['params'], containsPair('cwd', worktreeCwd));
      expect(
        remote.calls.single['params'],
        containsPair('approvalPolicy', 'on-request'),
      );
      expect(
        remote.calls.single['params'],
        containsPair('approvalsReviewer', 'user'),
      );
      expect(
        desktop.threadList.data.associatedWorktreePaths['same-chat'],
        worktreeCwd,
      );
      desktop.threadList.data.upsert({
        'id': 'same-chat',
        'cwd': localCwd,
      }, fromServer: true);
      expect(desktop.threadList.data.find('same-chat')?['cwd'], worktreeCwd);
      expect(desktop.threadList.data.projectBindings['same-chat'], worktreeCwd);
      desktop.threadList.data.upsert({
        'id': 'same-chat',
        'cwd': worktreeCwd,
      }, fromServer: true);
      expect(
        desktop.threadList.data.projectBindings.containsKey('same-chat'),
        isFalse,
      );
    },
  );

  test(
    'Local return preserves the associated worktree and old caches remain compatible',
    () async {
      final remote = RebindTransport(PairingRepository(TestCredentials()));
      final desktop = await rebindDesktop(remote);
      addTearDown(desktop.dispose);
      await desktop.moveThreadToProjectPath(worktreeCwd);
      await desktop.moveThreadToProjectPath(localCwd);
      expect(desktop.thread?['id'], 'same-chat');
      expect(desktop.thread?['cwd'], localCwd);
      final restored = ThreadLocalState.fromJson(
        desktop.threadList.data.toJson(),
      );
      expect(restored.associatedWorktreePaths['same-chat'], worktreeCwd);
      expect(ThreadLocalState.fromJson({}).associatedWorktreePaths, isEmpty);
      restored.remove('same-chat');
      expect(restored.associatedWorktreePaths, isEmpty);
    },
  );

  for (final message in ['No rollout found', 'No rollout file found']) {
    test(
      'explicit server $message preserves the source local rebind fallback',
      () async {
        final remote = RebindTransport(PairingRepository(TestCredentials()))
          ..failure = RemoteRpcException(-32000, message, null);
        final desktop = await rebindDesktop(remote);
        addTearDown(desktop.dispose);
        final moved = await desktop.moveThreadToProjectPath(worktreeCwd);
        expect(moved['id'], 'same-chat');
        expect(desktop.thread?['cwd'], worktreeCwd);
        expect(remote.calls, hasLength(1));
        expect(
          desktop.threadList.data.projectBindings['same-chat'],
          worktreeCwd,
        );
      },
    );
  }

  for (final kind in [
    'rejected',
    'transport',
    'local no rollout',
    'wrong thread',
    'missing thread',
  ]) {
    test('$kind does not adopt cwd or replay project resume', () async {
      final remote = RebindTransport(PairingRepository(TestCredentials()));
      if (kind == 'rejected') {
        remote.failure = const RemoteRpcException(-32000, 'Denied', null);
      }
      if (kind == 'transport') {
        remote.failure = TimeoutException('Unknown reply');
      }
      if (kind == 'local no rollout') {
        remote.failure = StateError('No rollout found');
      }
      if (kind == 'wrong thread') {
        remote.response = {
          'thread': {'id': 'foreign'},
        };
      }
      if (kind == 'missing thread') remote.response = {};
      final desktop = await rebindDesktop(remote);
      addTearDown(desktop.dispose);
      await expectLater(
        desktop.moveThreadToProjectPath(worktreeCwd),
        throwsA(anything),
      );
      expect(desktop.thread?['cwd'], localCwd);
      expect(desktop.threadList.data.find('same-chat')?['cwd'], localCwd);
      expect(desktop.threadList.data.projectBindings, isEmpty);
      expect(desktop.threadList.data.associatedWorktreePaths, isEmpty);
      expect(remote.calls, hasLength(1));
      expect(desktop.busy, isFalse);
    });
  }

  for (final gate in [
    'running',
    'busy',
    'offline',
    'untrusted',
    'foreign review',
    'invalid cwd',
  ]) {
    test('$gate cannot issue a project resume', () async {
      final remote = RebindTransport(PairingRepository(TestCredentials()));
      final desktop = await rebindDesktop(remote);
      addTearDown(desktop.dispose);
      if (gate == 'running') desktop.turnId = 'active-turn';
      if (gate == 'busy') desktop.busy = true;
      if (gate == 'offline') remote.online = false;
      if (gate == 'untrusted') desktop.trusted = [];
      await expectLater(
        desktop.moveThreadToProjectPath(
          gate == 'invalid cwd' ? 'relative/path' : worktreeCwd,
          isCurrent: () => gate != 'foreign review',
        ),
        throwsA(isA<StateError>()),
      );
      expect(remote.calls, isEmpty);
      expect(desktop.thread?['cwd'], localCwd);
    });
  }

  for (final change in [
    'session',
    'connection',
    'host',
    'pin',
    'in-place pin',
    'cache',
    'project binding',
    'selection',
    'navigation',
    'selection revision',
    'cwd',
    'run',
    'runtime',
    'trust',
  ]) {
    test('delayed resume cannot adopt another $change owner', () async {
      final remote = RebindTransport(PairingRepository(TestCredentials()));
      final desktop = await rebindDesktop(remote);
      addTearDown(desktop.dispose);
      final reply = remote.reply = Completer<RemoteJson>();
      final result = desktop.moveThreadToProjectPath(worktreeCwd);
      final checked = expectLater(result, throwsA(isA<StateError>()));
      await Future<void>.delayed(Duration.zero);
      if (change == 'session') remote.session = 'replacement-session';
      if (change == 'connection') remote.revision++;
      if (change == 'host') remote.host = 'another-mac';
      if (change == 'pin') {
        desktop.active = Pairing({
          ...desktop.active!.data,
          'macIdentityPublicKey': 'replacement-pin',
        });
      }
      if (change == 'cache') await desktop.threadList.attach('another-cache');
      if (change == 'project binding') {
        desktop.threadList.data.bindProject('same-chat', '/qa/Newer binding');
      }
      if (change == 'in-place pin') {
        desktop.active!.data['macIdentityPublicKey'] = 'replacement-pin';
      }
      if (change == 'selection') {
        desktop.thread = {'id': 'replacement-chat', 'cwd': '/qa/Other'};
      }
      if (change == 'navigation') desktop.navigationRevision++;
      if (change == 'selection revision') desktop.selectionRevision++;
      if (change == 'cwd') {
        desktop.thread = {...desktop.thread!, 'cwd': '/qa/Changed'};
      }
      if (change == 'run') desktop.turnId = 'new-run';
      if (change == 'runtime') desktop.access = 'full-access';
      if (change == 'trust') desktop.trusted = [];
      final expected = Map.of(desktop.thread!);
      reply.complete({
        'thread': {'id': 'same-chat', 'cwd': worktreeCwd},
      });
      await checked;
      expect(desktop.thread, expected);
      expect(remote.calls, hasLength(1));
      expect(desktop.threadList.data.associatedWorktreePaths, isEmpty);
    });
  }
}
