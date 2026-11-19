import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

void main() {
  test(
    'persisted fixture resumes signed discovery and encrypted RPC without re-pairing',
    () async {
      final temporary = await Directory.systemTemp.createTemp(
        'djl-resume141-wire-',
      );
      final root = Directory(await temporary.resolveSymbolicLinks());
      final workspace = Directory('${root.path}/workspace')..createSync();
      Future<String> git(List<String> args) async {
        final result = await Process.run('git', [
          '-C',
          workspace.path,
          ...args,
        ]);
        expect(result.exitCode, 0);
        return result.stdout.toString().trim();
      }

      await git(['init', '--initial-branch=main']);
      await git(['config', 'user.name', 'Mobile QA']);
      await git(['config', 'user.email', 'mobile-qa@test.invalid']);
      File(
        '${workspace.path}/hello.txt',
      ).writeAsStringSync('retained fixture data\n');
      await git(['add', '.']);
      await git(['commit', '-m', 'Disposable restart fixture']);
      final head = await git(['rev-parse', 'HEAD']);
      final stops = <Future<int> Function()>[];
      Future<({Pairing pair, Future<int> Function() stop})> start(
        int port,
      ) async {
        final state = '${root.path}/qa-device-state';
        final process = await Process.start(
          'bun',
          ['integration_test/support/desktop_gateway.ts', root.path],
          environment: {
            'DJL_QA_RUNTIME': '1',
            'DJL_QA_PERSIST_IDENTITY': '1',
            'DJL_QA_BRIDGE_PORT': '$port',
            'DJL_DEVICE_STATE_DIR': state,
            'DJL_DEVICE_STATE_FILE': '$state/device-state.json',
            'DJL_DEVICE_STATE_KEYCHAIN_MOCK_FILE':
                '$state/keychain-mirror.json',
          },
        );
        final ready = Completer<Pairing>();
        final error = process.stderr.listen((_) {});
        final output = process.stdout
            .transform(utf8.decoder)
            .transform(const LineSplitter())
            .listen(
              (line) {
                if (line.startsWith('{"pairing":') && !ready.isCompleted) {
                  ready.complete(
                    Pairing.parse(
                      jsonEncode((jsonDecode(line) as Map)['pairing']),
                      allowLocal: true,
                    ),
                  );
                }
              },
              onDone: () {
                if (!ready.isCompleted) {
                  ready.completeError(
                    StateError('Owned restart fixture exited before ready.'),
                  );
                }
              },
            );
        Future<int>? closing;
        Future<int> stop() => closing ??= () async {
          process.kill();
          final code = await process.exitCode.timeout(
            const Duration(seconds: 15),
            onTimeout: () {
              process.kill(ProcessSignal.sigkill);
              return process.exitCode;
            },
          );
          await output.cancel();
          await error.cancel();
          return code;
        }();
        stops.add(stop);
        return (
          pair: await ready.future.timeout(const Duration(seconds: 15)),
          stop: stop,
        );
      }

      final pairs = PairingRepository(TestCredentials(), allowLocal: true);
      final transport = RemoteTransport(pairs);
      try {
        final first = await start(0);
        await transport.connect(first.pair, bootstrap: true);
        Future<void> read() async {
          final result = await transport.request('workspace/readFile', {
            'cwd': workspace.path,
            'path': 'hello.txt',
          });
          expect(result['content'], 'retained fixture data\n');
        }

        await read();
        final saved = (await pairs.trustedEntries()).single;
        await transport.disconnect();
        expect(await first.stop(), 0);
        final second = await start(first.pair.relay.port);
        expect(second.pair.macDeviceId, first.pair.macDeviceId);
        expect(second.pair.publicKey, first.pair.publicKey);
        // Resolve with the original signed client identity,not the new QR payload.
        final resolved = await pairs.resolveTrusted(saved.pairing);
        await transport.connectSaved(resolved, saved);
        await read();
        final retained = (await pairs.trustedEntries()).single;
        expect(retained.trustId, saved.trustId);
        expect(retained.pairing.macDeviceId, saved.pairing.macDeviceId);
        expect(await git(['rev-parse', 'HEAD']), head);
        expect(await git(['status', '--porcelain']), isEmpty);
      } finally {
        await transport.dispose();
        for (final stop in stops) {
          await stop();
        }
        await root.delete(recursive: true);
      }
    },
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
