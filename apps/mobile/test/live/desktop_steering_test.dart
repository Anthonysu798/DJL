import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/data/desktop_local_store.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import '../features/desktop_activity_test.dart' show ActivityCacheStore;

class ClosingSteerTransport extends RemoteTransport {
  ClosingSteerTransport(super.pairings);
  Future<void>? closed;
  @override
  Future<void> dispose() => closed ??= super.dispose();
}

Future<void> steeringGit(String cwd, List<String> args) async {
  final result = await Process.run('git', ['-C', cwd, ...args]);
  expect(result.exitCode, 0, reason: result.stderr.toString());
}

void main() {
  for (final journey in [
    'direct',
    'stale',
    'queued-steer',
    'queued-fifo',
    'stop',
    'idless-stop',
    'legacy-stop',
    'plan-implementation',
    'plan-session-restart',
    'plan-session-steer',
    'plan-runtime-fallback',
    'legacy-plan-start',
    'legacy-plan-steer',
    'legacy-plan-rejection',
    'question-cancel',
  ]) {
    final stale = journey == 'stale';
    final planSessionSteer = journey == 'plan-session-steer';
    final queuedSteer = journey == 'queued-steer' || planSessionSteer;
    final fifo = journey == 'queued-fifo';
    final stopping = journey.endsWith('stop');
    final legacyStop = journey == 'legacy-stop';
    test(
      'real encrypted gateway $journey retains canonical history',
      () async {
        final root = await Directory.systemTemp.createTemp(
          'djl-live-steering-',
        );
        final cwd = Directory('${root.path}/workspace')..createSync();
        await steeringGit(cwd.path, ['init', '--initial-branch=main']);
        await steeringGit(cwd.path, [
          'config',
          'user.email',
          'mobile-qa@test.invalid',
        ]);
        await steeringGit(cwd.path, ['config', 'user.name', 'Mobile QA']);
        File(
          '${cwd.path}/hello.txt',
        ).writeAsStringSync('unchanged live steering\n');
        await steeringGit(cwd.path, ['add', '.']);
        await steeringGit(cwd.path, [
          'commit',
          '-m',
          'Read-only steering fixture',
        ]);
        final process = await Process.start(
          'bun',
          ['integration_test/support/desktop_gateway.ts', root.path],
          environment: {
            'DJL_QA_RUNTIME': '1',
            if (legacyStop) 'DJL_QA_LEGACY_TURN_RECOVERY': '1',
            if (journey == 'plan-runtime-fallback' ||
                journey == 'legacy-plan-rejection')
              'DJL_QA_REJECT_COLLABORATION': '1',
          },
        );
        final stderr = <String>[];
        process.stderr.transform(utf8.decoder).listen(stderr.add);
        final ready = Completer<Map<String, dynamic>>();
        final output = process.stdout
            .transform(utf8.decoder)
            .transform(const LineSplitter())
            .listen(
              (line) {
                if (line.startsWith('{"pairing":') && !ready.isCompleted) {
                  ready.complete(jsonDecode(line) as Map<String, dynamic>);
                }
              },
              onDone: () {
                if (!ready.isCompleted) {
                  ready.completeError(
                    StateError(
                      'Owned steering fixture exited: ${stderr.join()}',
                    ),
                  );
                }
              },
            );
        final pairs = PairingRepository(TestCredentials(), allowLocal: true);
        final transport = ClosingSteerTransport(pairs);
        final cache =
            (journey.startsWith('legacy-plan-') ||
                {
                  'plan-session-restart',
                  'plan-runtime-fallback',
                }.contains(journey))
            ? DesktopLocalStore(
                pairs.credentials,
                root: Directory('${root.path}/encrypted-cache'),
              )
            : ActivityCacheStore();
        final desktop = DesktopController(
          pairs,
          connection: transport,
          localStore: cache,
        );
        final events = <Map<String, dynamic>>[];
        final echoedUserCounts = <int>[];
        final subscription = transport.messages.listen((message) {
          events.add(message);
          if (message['method'] == 'item/started' &&
              ((message['params'] as Map?)?['item'] as Map?)?['type'] ==
                  'userMessage') {
            echoedUserCounts.add(
              desktop.timeline
                  .where((row) => row['type'] == 'userMessage')
                  .length,
            );
          }
        });
        final web = HttpClient();
        try {
          final config = await ready.future.timeout(
            const Duration(seconds: 15),
          );
          final pair = Pairing.parse(
            jsonEncode(config['pairing']),
            allowLocal: true,
          );
          final relay = Uri.parse(pair.data['relay'] as String);
          Future<Map<String, dynamic>> state() async {
            final request = await web.getUrl(
              Uri(
                scheme: 'http',
                host: '127.0.0.1',
                port: relay.port,
                path: '/qa/state',
              ),
            );
            final response = await request.close();
            expect(response.statusCode, 200);
            return jsonDecode(await response.transform(utf8.decoder).join())
                as Map<String, dynamic>;
          }

          Future<Map<String, dynamic>> until(
            bool Function(Map<String, dynamic>) test,
          ) async {
            final deadline = DateTime.now().add(const Duration(seconds: 10));
            while (true) {
              final value = await state();
              if (test(value)) return value;
              if (DateTime.now().isAfter(deadline)) {
                throw StateError('Owned steering stage did not arrive.');
              }
              await Future<void>.delayed(const Duration(milliseconds: 20));
            }
          }

          await desktop.connect(pair, bootstrap: true, resolve: false);
          expect(desktop.connected, isTrue, reason: desktop.error);
          await desktop.openThread(desktop.threads.single);
          if (journey == 'question-cancel') {
            desktop.setPlan(true);
            expect(
              await desktop.send('Question cancellation QA80'),
              isTrue,
              reason: desktop.error,
            );
            await until((s) => desktop.pendingApprovals.isNotEmpty);
            await desktop.approve(desktop.pendingApprovals.single, 'accept');
            await until((s) => desktop.pendingUserInputs.isNotEmpty);
            final request = desktop.pendingUserInputs.single;
            final thread = desktop.thread!['id'] as String;
            expect(
              desktop.threadList.data.planSessions[thread]?['source'],
              'native',
            );
            await desktop.cancelQuestion(request);
            final done = await until(
              (s) => s['pendingCount'] == 0 && desktop.turnId == null,
            );
            expect(desktop.error, isNull);
            expect(desktop.pendingUserInputs, isEmpty);
            expect(desktop.plan, isFalse);
            expect(desktop.threadList.data.planSessions[thread], isNull);
            expect(done['turnStartCount'], 1);
            expect(done['acceptedInterruptCount'], 1);
            expect(
              File('${cwd.path}/hello.txt').readAsStringSync(),
              'unchanged live steering\n',
            );
            await desktop.disconnect();
            await desktop.connect((await pairs.trusted()).single);
            await desktop.openThread({
              'id': thread,
              'cwd': cwd.path,
            }, readOnlyNavigation: true);
            expect(desktop.pendingUserInputs, isEmpty);
            expect(desktop.threadList.data.planSessions[thread], isNull);
            expect((await state())['turnStartCount'], 1);
            final clean = await Process.run('git', [
              '-C',
              cwd.path,
              'status',
              '--porcelain',
            ]);
            expect(clean.exitCode, 0);
            expect(clean.stdout, isEmpty);
            return;
          }
          if (journey.startsWith('legacy-plan-')) {
            final steer = journey == 'legacy-plan-steer';
            final rejected = journey == 'legacy-plan-rejection';
            final thread = desktop.thread!['id'] as String;
            expect(
              await desktop.send('[echo]\n1. Which path?\n- A\n- B'),
              isTrue,
              reason: desktop.error,
            );
            await until(
              (value) => value['turnStartCount'] == 1 && desktop.turnId == null,
            );
            final question = desktop.timeline.firstWhere(
              (r) =>
                  r['type'] == 'agentMessage' &&
                  (r['text'] as String? ?? '').contains('Which path?'),
            );
            if (steer) {
              expect(
                await desktop.send('[steer]'),
                isTrue,
                reason: desktop.error,
              );
              await until(
                (value) =>
                    (value['steering'] as Map?)?['stage'] == 'READY' &&
                    desktop.turnId != null,
              );
            }
            // Explicit legacy cache fixture in this disposable test only; no content-based activation.
            desktop.threadList.data.planSessions[thread] = {
              'identityPin': pair.data['macIdentityPublicKey'],
              'source': 'compatibilityFallback',
            };
            expect(
              desktop
                  .inferredPlanQuestionnaire(question)
                  ?.questions
                  .single['id'],
              'inferred_plan_q_1',
            );
            expect(
              await desktop.answerInferredPlanQuestionnaire(
                question['id'] as String,
                {
                  'inferred_plan_q_1': ['A'],
                },
              ),
              isTrue,
              reason: desktop.error,
            );
            if (!steer) {
              await until((_) => desktop.pendingApprovals.isNotEmpty);
              await desktop.approve(desktop.pendingApprovals.single, 'decline');
            }
            final done = await until(
              (value) =>
                  value['turnStartCount'] == 2 &&
                  value['turnCount'] == 2 &&
                  value['pendingCount'] == 0 &&
                  desktop.turnId == null,
            );
            if (steer) expect((done['steering'] as Map)['acceptedCount'], 1);
            final requests = (done['requests'] as List).cast<Map>();
            expect(
              requests.where((r) => r['method'] == 'turn/start'),
              hasLength(rejected ? 3 : 2),
            );
            expect(
              requests.where((r) => r['method'] == 'turn/steer'),
              hasLength(steer ? 1 : 0),
            );
            final mode = (done['collaborationModes'] as List).single as Map;
            expect(
              mode,
              containsPair('method', steer ? 'turn/steer' : 'turn/start'),
            );
            expect(mode, containsPair('mode', 'plan'));
            expect(mode, containsPair('model', 'qa-model'));
            expect(mode, containsPair('nullInstructions', true));
            if (!steer) {
              expect(
                done['lastTurn'],
                containsPair('approvalsReviewer', 'user'),
              );
            }
            final users = desktop.timeline.where(
              (r) => r['type'] == 'userMessage',
            );
            expect(users.last['content'], [
              {'type': 'text', 'text': 'Answers:\n\n1. Which path?\nA'},
            ]);
            for (final turn
                in desktop.timeline
                    .map((row) => row['turnId'])
                    .whereType<String>()
                    .toSet()) {
              await desktop.waitForCheckpoint(turn);
            }
            await desktop.threadList.saveNow();
            expect(
              ((await cache.load(pair.macDeviceId))['planSessions']
                  as Map)[thread],
              rejected
                  ? isNull
                  : containsPair('source', 'compatibilityFallback'),
            );
            final encrypted = Directory(
              '${root.path}/encrypted-cache/desktop-cache-v1',
            ).listSync().whereType<File>().single.readAsStringSync();
            expect(encrypted, isNot(contains('Which path?')));
            expect(encrypted, isNot(contains('compatibilityFallback')));
            await desktop.disconnect();
            await desktop.connect((await pairs.trusted()).single);
            await desktop.openThread({
              'id': thread,
              'cwd': cwd.path,
            }, readOnlyNavigation: true);
            expect(
              desktop.threadList.data.planSessions[thread]?['source'],
              rejected ? null : 'compatibilityFallback',
            );
            if (rejected) {
              expect(desktop.supportsPlan, isTrue);
              expect(
                desktop.timeline
                    .where((r) => r['type'] == 'systemMessage')
                    .single['text'],
                'Plan mode is not supported by this runtime. Sent as a normal turn instead.',
              );
            }
            expect((await state())['turnStartCount'], 2);
            expect(
              File('${cwd.path}/hello.txt').readAsStringSync(),
              'unchanged live steering\n',
            );
            final clean = await Process.run('git', [
              '-C',
              cwd.path,
              'status',
              '--porcelain',
            ]);
            expect(clean.exitCode, 0);
            expect(clean.stdout, isEmpty);
            return;
          }
          if (journey == 'plan-runtime-fallback') {
            const prompt = '[echo] PLAN-FALLBACK77';
            const notice =
                'Plan mode is not supported by this runtime. Sent as a normal turn instead.';
            final thread = desktop.thread!['id'] as String;
            desktop.setPlan(true);
            expect(await desktop.send(prompt), isTrue, reason: desktop.error);
            final done = await until(
              (value) => value['turnStartCount'] == 1 && desktop.turnId == null,
            );
            expect(desktop.supportsPlan, isFalse);
            expect(desktop.plan, isFalse);
            expect(desktop.threadList.data.planSessions, isEmpty);
            expect(
              desktop.timeline
                  .where((r) => r['type'] == 'systemMessage')
                  .single['text'],
              notice,
            );
            expect(
              (done['requests'] as List).where(
                (r) => r['method'] == 'turn/start',
              ),
              hasLength(2),
            );
            expect(
              (done['collaborationModes'] as List).single,
              containsPair('mode', 'plan'),
            );
            expect(done['lastInput'], [
              {'type': 'text', 'text': prompt},
            ]);
            expect(done['turnCount'], 1);
            expect(done['pendingCount'], 0);
            expect(done['lastTurn'], containsPair('model', 'qa-model'));
            expect(done['lastTurn'], containsPair('approvalsReviewer', 'user'));
            expect(
              done['lastTurn'],
              containsPair('approvalPolicy', 'on-request'),
            );
            await desktop.threadList.saveNow();
            final ciphertext = Directory(
              '${root.path}/encrypted-cache/desktop-cache-v1',
            ).listSync().whereType<File>().single.readAsStringSync();
            expect(ciphertext, isNot(contains(prompt)));
            expect(ciphertext, isNot(contains(notice)));
            await desktop.disconnect();
            await desktop.connect((await pairs.trusted()).single);
            await desktop.openThread({
              'id': thread,
              'cwd': cwd.path,
            }, readOnlyNavigation: true);
            expect(desktop.supportsPlan, isTrue);
            expect(
              desktop.timeline
                  .where((r) => r['type'] == 'systemMessage')
                  .single['text'],
              notice,
            );
            expect((await state())['turnStartCount'], 1);
            expect(
              File('${cwd.path}/hello.txt').readAsStringSync(),
              'unchanged live steering\n',
            );
            final clean = await Process.run('git', [
              '-C',
              cwd.path,
              'status',
              '--porcelain',
            ]);
            expect(clean.exitCode, 0);
            expect(clean.stdout, isEmpty);
            return;
          }
          if (journey == 'plan-session-restart') {
            const first = '[echo] PLAN-SESSION76-PLAN';
            const second = '[echo] PLAN-SESSION76-DEFAULT';
            final thread = desktop.thread!['id'] as String;
            desktop.setPlan(true);
            expect(await desktop.send(first), isTrue, reason: desktop.error);
            await until(
              (value) => value['turnStartCount'] == 1 && desktop.turnId == null,
            );
            await desktop.threadList.saveNow();
            final persisted = await cache.load(pair.macDeviceId);
            expect((persisted['planSessions'] as Map)[thread], {
              'identityPin': pair.data['macIdentityPublicKey'],
              'source': 'requested',
            });
            final encrypted = Directory(
              '${root.path}/encrypted-cache/desktop-cache-v1',
            ).listSync().whereType<File>().single.readAsStringSync();
            expect(encrypted, isNot(contains(first)));
            expect(encrypted, isNot(contains('planSessions')));
            await desktop.disconnect();
            final resumedTransport = ClosingSteerTransport(pairs);
            final resumed = DesktopController(
              pairs,
              connection: resumedTransport,
              localStore: DesktopLocalStore(
                pairs.credentials,
                root: Directory('${root.path}/encrypted-cache'),
              ),
            );
            try {
              await resumed.connect((await pairs.trusted()).single);
              expect(resumed.connected, isTrue, reason: resumed.error);
              await resumed.openThread({
                'id': thread,
                'cwd': cwd.path,
              }, readOnlyNavigation: true);
              expect(
                resumed.threadList.data.planSessions[thread]?['source'],
                'requested',
              );
              resumed.setPlan(false);
              expect(await resumed.send(second), isTrue, reason: resumed.error);
              final done = await until(
                (value) =>
                    value['turnStartCount'] == 2 && resumed.turnId == null,
              );
              final modes = (done['collaborationModes'] as List).cast<Map>();
              expect(modes.map((mode) => mode['mode']), ['plan', 'default']);
              expect(
                modes.every(
                  (mode) =>
                      mode['method'] == 'turn/start' &&
                      mode['threadId'] == thread &&
                      mode['model'] == 'qa-model' &&
                      mode['nullInstructions'] == true &&
                      mode['inputCount'] == 1,
                ),
                isTrue,
              );
              expect(done['lastInput'], [
                {'type': 'text', 'text': second},
              ]);
              expect(done['turnCount'], 2);
              expect(done['threadCount'], 1);
              expect(done['pendingCount'], 0);
              expect(
                (done['requests'] as List).where(
                  (r) => r['method'] == 'turn/steer',
                ),
                isEmpty,
              );
              await resumed.threadList.saveNow();
              expect(
                ((await cache.load(pair.macDeviceId))['planSessions'] as Map)
                    .containsKey(thread),
                isFalse,
              );
              expect(
                File('${cwd.path}/hello.txt').readAsStringSync(),
                'unchanged live steering\n',
              );
              final clean = await Process.run('git', [
                '-C',
                cwd.path,
                'status',
                '--porcelain',
              ]);
              expect(clean.exitCode, 0);
              expect(clean.stdout, isEmpty);
            } finally {
              await resumed.disconnect();
              resumed.dispose();
              await resumedTransport.closed;
            }
            return;
          }
          if (journey == 'plan-implementation') {
            expect(
              await desktop.send(
                '[echo] <proposed_plan># Live plan75\n- Keep the workspace unchanged\n</proposed_plan>',
              ),
              isTrue,
              reason: desktop.error,
            );
            await until(
              (value) =>
                  desktop.turnId == null &&
                  desktop.timeline.any(
                    (row) =>
                        desktop.responsePlanProposal(row)?.presentation ==
                        'resultReady',
                  ),
            );
            final row = desktop.timeline.lastWhere(
              (row) => row['type'] == 'agentMessage',
            );
            final proposal = desktop.responsePlanProposal(row)!;
            expect(
              proposal.body,
              '# Live plan75\n- Keep the workspace unchanged',
            );
            desktop.setPlan(true);
            expect(
              await desktop.implementPlan(
                row['id'] as String,
                body: proposal.body,
              ),
              isTrue,
              reason: desktop.error,
            );
            final asking = await until(
              (value) =>
                  value['pendingCount'] == 1 &&
                  desktop.pendingApprovals.length == 1,
            );
            final implementedTurn = desktop.turnId!;
            expect(asking['planImplementation'], {
              'threadId': desktop.thread!['id'],
              'mode': 'default',
              'model': 'qa-model',
              'inputCount': 1,
              'exactPrompt': true,
            });
            expect(asking['lastInput'], [
              {'type': 'text', 'text': 'Implement plan.'},
            ]);
            expect(asking['turnStartCount'], 2);
            await desktop.approve(desktop.pendingApprovals.single, 'reject');
            final done = await until(
              (value) =>
                  value['pendingCount'] == 0 &&
                  desktop.turnId == null &&
                  !desktop.shouldQueueComposer,
            );
            await desktop.waitForCheckpoint(implementedTurn);
            expect(done['turnStartCount'], 2);
            expect(done['turnCount'], 2);
            expect(done['threadCount'], 1);
            expect(desktop.plan, isFalse);
            expect(desktop.access, 'on-request');
            expect(desktop.error, isNull);
            expect(
              File('${cwd.path}/hello.txt').readAsStringSync(),
              'unchanged live steering\n',
            );
            final clean = await Process.run('git', [
              '-C',
              cwd.path,
              'status',
              '--porcelain',
            ]);
            expect(clean.exitCode, 0);
            expect(clean.stdout, isEmpty);
            return;
          }

          if (planSessionSteer) desktop.setPlan(true);
          expect(
            await desktop.send('[steer] START65'),
            isTrue,
            reason: desktop.error,
          );
          final held = await until(
            (value) =>
                (value['steering'] as Map?)?['stage'] == 'READY' &&
                desktop.timeline.any(
                  (row) =>
                      row['id'] ==
                      'assistant-${(value['steering'] as Map)['turnId']}',
                ),
          );
          final active = (held['steering'] as Map)['turnId'];
          expect(desktop.turnId, active);
          expect(held, containsPair('turnStartCount', 1));
          if (planSessionSteer) desktop.setPlan(false);
          if (stopping) {
            if (journey == 'idless-stop') desktop.turnId = null;
            if (legacyStop) desktop.turnId = 'stale';
            await desktop.stop();
            final done = await until(
              (value) =>
                  (value['steering'] as Map?)?['stage'] == 'INTERRUPTED' &&
                  desktop.turnId == null &&
                  !desktop.shouldQueueComposer,
            );
            expect(desktop.error, isNull);
            expect(done['turnStartCount'], 1);
            expect(done['turnCount'], 1);
            expect(done['threadCount'], 1);
            expect(done['pendingCount'], 0);
            expect(done['acceptedInterruptCount'], 1);
            final requests = (done['requests'] as List).cast<Map>();
            expect(
              requests.where((row) => row['method'] == 'turn/start'),
              hasLength(1),
            );
            expect(
              requests.where((row) => row['method'] == 'turn/steer'),
              isEmpty,
            );
            expect(
              requests.where((row) => row['method'] == 'turn/interrupt'),
              hasLength(legacyStop ? 4 : 1),
            );
            final expected = legacyStop
                ? [
                    'turn/interrupt',
                    'turn/interrupt',
                    'thread/read',
                    'thread/read',
                    'turn/interrupt',
                    'turn/interrupt',
                  ]
                : journey == 'idless-stop'
                ? ['thread/turns/list', 'thread/read', 'turn/interrupt']
                : ['turn/interrupt'];
            expect(
              requests
                  .where(
                    (row) =>
                        (row['sequence'] as int) >
                        (held['requestSequence'] as int),
                  )
                  .map((row) => row['method'])
                  .take(expected.length),
              expected,
            );
            expect(
              events.where((row) => row['method'] == 'turn/completed'),
              hasLength(1),
            );
            expect(echoedUserCounts, [1]);
            await desktop.openThread({'id': 'native-thread-1'});
            final users = desktop.timeline.where(
              (row) => row['type'] == 'userMessage',
            );
            expect(users, hasLength(1));
            expect(
              (users.single['content'] as List).single['text'],
              '[steer] START65',
            );
            expect(desktop.turnId, isNull);
            expect(
              File('${cwd.path}/hello.txt').readAsStringSync(),
              'unchanged live steering\n',
            );
            final clean = await Process.run('git', [
              '-C',
              cwd.path,
              'status',
              '--porcelain',
            ]);
            expect(clean.exitCode, 0);
            expect(clean.stdout, isEmpty);
            return;
          }
          if (queuedSteer || fifo) {
            expect(
              await desktop.submitComposerDraft(
                DesktopComposerDraft(
                  text: fifo ? '[echo] FIFO68-A' : 'STEER65',
                ),
              ),
              isTrue,
            );
            if (fifo) {
              expect(
                await desktop.submitComposerDraft(
                  DesktopComposerDraft(text: '[echo] FIFO68-B'),
                ),
                isTrue,
              );
            }
            final queued = await state();
            expect(queued['requestSequence'], held['requestSequence']);
            expect(queued['turnStartCount'], 1);
            expect(desktop.queuedDrafts, hasLength(fifo ? 2 : 1));
            expect(
              desktop.timeline.where((row) => row['type'] == 'userMessage'),
              hasLength(1),
            );
          }
          if (fifo) {
            await desktop.stop();
            await until(
              (value) => desktop.turnId == null && !desktop.shouldQueueComposer,
            );
            for (var remaining = 1; remaining >= 0; remaining--) {
              await desktop.flushQueuedDrafts();
              await until(
                (value) =>
                    desktop.turnId == null && !desktop.shouldQueueComposer,
              );
              expect(desktop.queuedDrafts, hasLength(remaining));
            }
            final done = await state();
            expect(done['turnStartCount'], 3);
            expect(done['turnCount'], 3);
            expect(done['threadCount'], 1);
            expect(done['pendingCount'], 0);
            final requests = (done['requests'] as List).cast<Map>();
            expect(
              requests.where((row) => row['method'] == 'turn/start'),
              hasLength(3),
            );
            expect(
              requests.where((row) => row['method'] == 'turn/steer'),
              isEmpty,
            );
            expect(
              requests.where((row) => row['method'] == 'turn/interrupt'),
              hasLength(1),
            );
            expect(
              events.where((row) => row['method'] == 'turn/completed'),
              hasLength(3),
            );
            expect(echoedUserCounts, [1, 2, 3]);
            await desktop.openThread({'id': 'native-thread-1'});
            expect(
              desktop.timeline
                  .where((row) => row['type'] == 'userMessage')
                  .map((row) => (row['content'] as List).single['text']),
              ['[steer] START65', '[echo] FIFO68-A', '[echo] FIFO68-B'],
            );
            expect(
              File('${cwd.path}/hello.txt').readAsStringSync(),
              'unchanged live steering\n',
            );
            final clean = await Process.run('git', [
              '-C',
              cwd.path,
              'status',
              '--porcelain',
            ]);
            expect(clean.exitCode, 0);
            expect(clean.stdout, isEmpty);
            return;
          }
          final recoveryChanges = <String>[];
          if (stale) {
            desktop.addListener(
              () => recoveryChanges.add(
                '${desktop.turnId}:${desktop.thread?['id']}:${desktop.thread?['cwd']}:${desktop.state}',
              ),
            );
          }
          if (stale) desktop.turnId = 'stale';
          final sent = queuedSteer
              ? await desktop.steerQueuedDraft(desktop.queuedDrafts.single.id)
              : await desktop.send('STEER65');
          expect(
            sent,
            isTrue,
            reason:
                '${desktop.error}; recovery state: $recoveryChanges; methods: ${(await state())['requests']}',
          );
          final done = await until(
            (value) => (value['steering'] as Map?)?['stage'] == 'COMPLETE',
          );
          for (var i = 0; i < 50 && desktop.turnId != null; i++) {
            await Future<void>.delayed(const Duration(milliseconds: 20));
          }
          expect(
            desktop.turnId,
            isNull,
            reason:
                'A fast steer completion must not resurrect an active turn.',
          );
          expect(done, containsPair('turnStartCount', 1));
          expect(done, containsPair('turnCount', 1));
          expect(done, containsPair('threadCount', 1));
          expect(done, containsPair('pendingCount', 0));
          if (planSessionSteer) {
            final modes = (done['collaborationModes'] as List).cast<Map>();
            expect(modes.map((mode) => mode['mode']), ['plan', 'default']);
            expect(modes.map((mode) => mode['method']), [
              'turn/start',
              'turn/steer',
            ]);
            expect(
              modes.every(
                (mode) =>
                    mode['threadId'] == desktop.thread!['id'] &&
                    mode['model'] == 'qa-model' &&
                    mode['nullInstructions'] == true &&
                    mode['inputCount'] == 1,
              ),
              isTrue,
            );
          }
          expect(desktop.queuedDrafts, isEmpty);
          expect((done['steering'] as Map)['acceptedCount'], 1);
          final requests = (done['requests'] as List).cast<Map>();
          expect(
            requests.where((row) => row['method'] == 'turn/start'),
            hasLength(1),
          );
          expect(
            requests.where((row) => row['method'] == 'turn/steer'),
            hasLength(stale ? 2 : 1),
          );
          final followUpRequests = requests
              .where(
                (row) =>
                    (row['sequence'] as int) > (held['requestSequence'] as int),
              )
              .map((row) => row['method']);
          expect(
            followUpRequests.take(stale ? 4 : 1),
            stale
                ? [
                    'turn/steer',
                    'thread/turns/list',
                    'thread/read',
                    'turn/steer',
                  ]
                : ['turn/steer'],
          );
          expect(
            events.where((row) => row['method'] == 'turn/completed'),
            hasLength(1),
          );
          expect(echoedUserCounts, [1, 2]);
          await desktop.openThread({'id': 'native-thread-1'});
          final users = desktop.timeline
              .where((row) => row['type'] == 'userMessage')
              .toList();
          expect(users, hasLength(2));
          expect(
            (users.first['content'] as List).single['text'],
            '[steer] START65',
          );
          expect((users.last['content'] as List).single['text'], 'STEER65');
          expect(
            desktop.timeline.any(
              (row) =>
                  row['text'] == 'Steering native fixture complete. STEER65',
            ),
            isTrue,
          );
          expect(
            File('${cwd.path}/hello.txt').readAsStringSync(),
            'unchanged live steering\n',
          );
          final clean = await Process.run('git', [
            '-C',
            cwd.path,
            'status',
            '--porcelain',
          ]);
          expect(clean.exitCode, 0);
          expect(clean.stdout, isEmpty);
        } finally {
          web.close(force: true);
          await subscription.cancel();
          for (final turn
              in desktop.timeline
                  .map((row) => row['turnId'])
                  .whereType<String>()
                  .toSet()) {
            await desktop.waitForCheckpoint(turn);
          }
          await desktop.disconnect();
          desktop.dispose();
          await transport.closed;
          process.kill();
          await process.exitCode;
          await output.cancel();
          // Drain after the producer stops, including writes queued during exit.
          await cache.flush();
          await root.delete(recursive: true);
        }
      },
      timeout: const Timeout(Duration(minutes: 2)),
    );
  }
}
