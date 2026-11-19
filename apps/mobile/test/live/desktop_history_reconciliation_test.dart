import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import '../features/desktop_activity_test.dart' show ActivityCacheStore;
import 'desktop_steering_test.dart' show ClosingSteerTransport, steeringGit;

void main() {
  test(
    'real encrypted history upgrades and repairs an idle saved projection without another send',
    () async {
      final root = await Directory.systemTemp.createTemp('djl-live-history72-');
      final cwd = Directory('${root.path}/workspace')..createSync();
      await steeringGit(cwd.path, ['init', '--initial-branch=main']);
      await steeringGit(cwd.path, [
        'config',
        'user.email',
        'mobile-qa@test.invalid',
      ]);
      await steeringGit(cwd.path, ['config', 'user.name', 'Mobile QA']);
      File('${cwd.path}/hello.txt').writeAsStringSync('history72 unchanged\n');
      await steeringGit(cwd.path, ['add', '.']);
      await steeringGit(cwd.path, [
        'commit',
        '-m',
        'Read-only history fixture',
      ]);
      final process = await Process.start(
        'bun',
        [
          '${Directory.current.path}/integration_test/support/desktop_gateway.ts',
          root.path,
        ],
        environment: {'DJL_QA_RUNTIME': '1'},
      );
      final ready = Completer<RemoteJson>();
      final errors = <String>[];
      final stderr = process.stderr.transform(utf8.decoder).listen(errors.add);
      final stdout = process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(
            (line) {
              if (line.startsWith('{"pairing":') && !ready.isCompleted) {
                ready.complete(jsonDecode(line) as RemoteJson);
              }
            },
            onDone: () {
              if (!ready.isCompleted) {
                ready.completeError(
                  StateError('Owned history fixture exited: ${errors.join()}'),
                );
              }
            },
          );
      final pairs = PairingRepository(TestCredentials(), allowLocal: true);
      final transport = ClosingSteerTransport(pairs);
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: ActivityCacheStore(),
      );
      final web = HttpClient();
      try {
        final config = await ready.future.timeout(const Duration(seconds: 15));
        final pair = Pairing.parse(
          jsonEncode(config['pairing']),
          allowLocal: true,
        );
        final relay = Uri.parse(pair.data['relay'] as String);
        Future<RemoteJson> state() async {
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
              as RemoteJson;
        }

        await desktop.connect(pair, bootstrap: true, resolve: false);
        expect(desktop.connected, isTrue, reason: desktop.error);
        await desktop.openThread(desktop.threads.single);
        expect(
          await desktop.send('[echo] HISTORY72'),
          isTrue,
          reason: desktop.error,
        );
        final deadline = DateTime.now().add(const Duration(seconds: 15));
        while (desktop.turnId != null ||
            desktop.timeline
                .where((r) => r['type'] == 'agentMessage')
                .isEmpty) {
          if (DateTime.now().isAfter(deadline)) {
            fail('Encrypted echo did not settle');
          }
          await Future<void>.delayed(const Duration(milliseconds: 20));
        }
        // This is a host fault variant: emulate the bridge's saved projected IDs.
        // All canonical data is subsequently read over the production encrypted wire.
        final canonical = desktop.timeline
            .where((r) => {'userMessage', 'agentMessage'}.contains(r['type']))
            .map((r) => Map<String, dynamic>.from(r))
            .toList();
        expect(canonical, hasLength(2));
        final realTurn = canonical.first['turnId'];
        await desktop.waitForCheckpoint(realTurn as String);
        final answer = canonical.last['text'];
        desktop.timeline = [
          for (final row in canonical)
            {
              ...row,
              'turnId': 'ipc-turn-0',
              'id': row['type'] == 'userMessage'
                  ? 'ipc-turn-0:input'
                  : 'rollout-answer',
            }..remove('sourceItemId'),
          {
            'id': 'rollout-idle74-orphan',
            'turnId': 'ipc-turn-0',
            'type': 'agentMessage',
            'text': 'Stale mirrored finding absent from canonical history',
          },
        ];
        final before = await state();
        await desktop.openThread(desktop.thread!, readOnlyNavigation: true);
        final after = await state();
        expect(desktop.timeline, hasLength(2));
        expect(desktop.timeline.map((r) => r['turnId']).toSet(), {realTurn});
        expect(desktop.timeline.last['text'], answer);
        expect(
          desktop.timeline.map((r) => r['sourceItemId'] ?? r['id']),
          canonical.map((r) => r['sourceItemId'] ?? r['id']),
        );
        expect(after['turnStartCount'], before['turnStartCount']);
        expect(after['turnCount'], before['turnCount']);
        expect(after['threadResumeCount'], before['threadResumeCount']);
        expect(after['guardianRetryAttemptCount'], 0);
        expect(after['pendingCount'], 0);
        final newRequests = (after['requests'] as List).cast<Map>().where(
          (r) => (r['sequence'] as int) > (before['requestSequence'] as int),
        );
        expect(newRequests.map((r) => r['method']).toSet(), {'thread/read'});
        expect(
          File('${cwd.path}/hello.txt').readAsStringSync(),
          'history72 unchanged\n',
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
        desktop.dispose();
        await transport.closed;
        process.kill();
        await process.exitCode.timeout(const Duration(seconds: 10));
        await stdout.cancel();
        await stderr.cancel();
        await root.delete(recursive: true);
      }
    },
    timeout: const Timeout(Duration(minutes: 1)),
  );
}
