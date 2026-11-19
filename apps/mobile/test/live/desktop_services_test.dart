import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/git/data/git_repository.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

Future<void> git(String cwd, List<String> args) async {
  final result = await Process.run('git', ['-C', cwd, ...args]);
  expect(result.exitCode, 0, reason: result.stderr.toString());
}

void main() {
  test(
    'encrypted gateway interoperates with original Git/filesystem handlers',
    () async {
      final root = await Directory.systemTemp.createTemp('djl-mobile-desktop-');
      final cwd = Directory('${root.path}/workspace')..createSync();
      await git(cwd.path, ['init', '--initial-branch=main']);
      await git(cwd.path, ['config', 'user.email', 'mobile-qa@test.invalid']);
      await git(cwd.path, ['config', 'user.name', 'Mobile QA']);
      File('${cwd.path}/hello.txt').writeAsStringSync('one\n');
      await git(cwd.path, ['add', '.']);
      await git(cwd.path, ['commit', '-m', 'Initial fixture']);
      final process = await Process.start('bun', [
        'integration_test/support/desktop_gateway.ts',
        root.path,
      ]);
      final stderr = <String>[];
      process.stderr.transform(utf8.decoder).listen(stderr.add);
      final readyResult = Completer<Map<String, dynamic>>();
      final output = process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(
            (line) {
              if (line.startsWith('{"pairing":') && !readyResult.isCompleted) {
                readyResult.complete(jsonDecode(line) as Map<String, dynamic>);
              }
            },
            onDone: () {
              if (!readyResult.isCompleted) {
                readyResult.completeError(
                  StateError(
                    'Desktop QA exited before ready: ${stderr.join()}',
                  ),
                );
              }
            },
          );
      final pairs = PairingRepository(TestCredentials(), allowLocal: true);
      final transport = RemoteTransport(pairs);
      try {
        final ready = await readyResult.future.timeout(
          const Duration(seconds: 15),
        );
        final wireCwd = ready['cwd'] as String;
        await transport.connect(
          Pairing.parse(jsonEncode(ready['pairing']), allowLocal: true),
          bootstrap: true,
        );
        final repo = GitRepository(transport, cwd: wireCwd);
        expect((await repo.status()).dirty, isFalse);
        File('${cwd.path}/hello.txt').writeAsStringSync('one\ntwo\n');
        expect((await repo.status()).dirty, isTrue);
        expect(await repo.diff(), contains('+two'));
        final commit = await repo.commit('Mobile fixture commit');
        expect(commit['hash'], isNotEmpty);
        await repo.createBranch('qa-branch');
        expect((await repo.status()).branch, 'djl/qa-branch');
        await repo.checkout('main');
        final read = await transport.request('workspace/readFile', {
          'cwd': wireCwd,
          'path': 'hello.txt',
        });
        expect(read['content'], contains('two'));
        final directory = await transport.request('project/listDirectory', {
          'path': wireCwd,
        });
        expect(directory['path'], wireCwd);
        final projects = ProjectRepository(transport);
        final created = await projects.createDirectory(wireCwd, 'nested-qa');
        expect(
          (await projects.listDirectory(
            wireCwd,
          )).entries.any((e) => e.path == created),
          isTrue,
        );
        expect(
          (await projects.search(wireCwd, 'nested-qa')).single.path,
          created,
        );
        final files = WorkspaceRepository(
          transport,
          cwd: wireCwd,
          threadId: 'qa-thread',
        );
        final text = await files.readTextFile('hello.txt');
        expect(
          (await files.readTextFile('hello.txt', cached: text)).content,
          text.content,
        );
        File('${cwd.path}/preview.svg').writeAsStringSync(
          '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
        );
        final image = await files.readImage('preview.svg');
        expect(image.mimeType, 'image/svg+xml');
        expect(utf8.decode(image.bytes), contains('<svg'));
        expect(
          (await files.readImage('preview.svg', cached: image)).bytes,
          image.bytes,
        );
        File('${cwd.path}/preview.svg').deleteSync();
        await files.capture(kind: 'messageStart', messageId: 'qa-message');
        expect(
          (await files.copyStart('qa-message', 'qa-turn'))['copied'],
          isTrue,
        );
        File('${cwd.path}/hello.txt').writeAsStringSync('checkpoint changed\n');
        File(
          '${cwd.path}/untracked-checkpoint.txt',
        ).writeAsStringSync('disposable untracked\n');
        await files.capture(kind: 'turnEnd', turnId: 'qa-turn');
        expect(
          await files.checkpointDiff('qa-turn'),
          contains('+checkpoint changed'),
        );
        final preview = await files.previewRestore('qa-turn');
        expect(
          preview.affectedFiles,
          containsAll(['hello.txt', 'untracked-checkpoint.txt']),
        );
        final restored = await files.restore(
          preview.confirm(userConfirmed: true)!,
        );
        expect(restored['success'], isTrue);
        expect(restored['backupCheckpointRef'], isNotEmpty);
        expect(File('${cwd.path}/hello.txt').readAsStringSync(), text.content);
        expect(
          File('${cwd.path}/untracked-checkpoint.txt').existsSync(),
          isFalse,
        );
        // A changed target ref after preview must refuse before touching current files.
        final stale = await files.previewRestore('qa-turn');
        File('${cwd.path}/hello.txt').writeAsStringSync('newer target\n');
        await files.capture(kind: 'turnStart', turnId: 'qa-turn');
        await expectLater(
          files.restore(stale.confirm(userConfirmed: true)!),
          throwsA(
            isA<RemoteRpcException>().having(
              (e) => e.message,
              'message',
              contains('changed after preview'),
            ),
          ),
        );
        expect(
          File('${cwd.path}/hello.txt').readAsStringSync(),
          'newer target\n',
        );
        expect(transport.connected, isTrue);
      } finally {
        await transport.dispose();
        process.kill();
        await process.exitCode;
        await output.cancel();
        await root.delete(recursive: true);
      }
    },
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
