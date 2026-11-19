import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/desktop_composer_repository.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'workspace_repository_test.dart' show WorkspaceTransport;

class ComposerTransport extends WorkspaceTransport {
  final results = <String, List<Object>>{};
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    final next = results[method]!.removeAt(0);
    if (next is Completer<RemoteJson>) return next.future;
    if (next is RemoteJson) return next;
    throw next;
  }
}

void main() {
  test(
    'skills merge bucketed project/global forms, prefer enabled and use exact cwd fallback',
    () async {
      final transport = ComposerTransport()
        ..results['skills/list'] = [
          const RemoteRpcException(-32602, 'Unknown field cwds', null),
          {
            'data': [
              {
                'skills': [
                  {
                    'name': 'Review',
                    'path': '/project/SKILL.md',
                    'enabled': false,
                  },
                ],
              },
            ],
          },
          {
            'skills': [
              {'name': 'review', 'path': '/personal/SKILL.md'},
              {'name': 'Build', 'enabled': true},
            ],
          },
        ];
      final result = await DesktopComposerRepository(
        transport,
        cwd: '/repo',
      ).skills(forceReload: true);
      expect(result.map((v) => v['name']), ['Build', 'review']);
      expect(result.last['path'], '/personal/SKILL.md');
      expect(transport.calls.map((v) => v['params']), [
        {
          'cwds': ['/repo'],
          'forceReload': true,
        },
        {'cwd': '/repo', 'forceReload': true},
        {'forceReload': true},
      ]);
    },
  );
  test(
    'uncertain skill errors do not retry and malformed responses remain errors',
    () async {
      final transport = ComposerTransport()
        ..results['skills/list'] = [TimeoutException('Disconnected')];
      final repository = DesktopComposerRepository(transport, cwd: '/repo');
      await expectLater(repository.skills(), throwsA(isA<TimeoutException>()));
      expect(transport.calls, hasLength(1));
      transport.results['skills/list'] = [
        {'unexpected': []},
      ];
      await expectLater(repository.skills(), throwsFormatException);
    },
  );
  test(
    'plugins expose only installed/enabled/default entries with canonical mention paths',
    () async {
      final transport = ComposerTransport()
        ..results['plugin/list'] = [
          {
            'marketplaces': [
              {
                'name': 'official',
                'plugins': [
                  {
                    'id': 'a',
                    'name': 'drive',
                    'installed': true,
                    'enabled': false,
                    'interface': {'displayName': 'Drive'},
                  },
                  {
                    'id': 'b',
                    'name': 'hidden',
                    'installed': false,
                    'enabled': false,
                  },
                  {
                    'id': 'c',
                    'name': 'defaults',
                    'installPolicy': 'INSTALLED_BY_DEFAULT',
                  },
                ],
              },
            ],
          },
        ];
      final plugins = await DesktopComposerRepository(
        transport,
        cwd: '/repo',
      ).plugins();
      expect(plugins.map((v) => v['path']), [
        'plugin://defaults@official',
        'plugin://drive@official',
      ]);
      expect(plugins.last['displayName'], 'Drive');
      expect(transport.calls.single['params'], {
        'cwds': ['/repo'],
      });
    },
  );
  test(
    'desktop file search uses roots/null cancellation and normalizes only the matching root prefix',
    () async {
      final transport = ComposerTransport()
        ..results['fuzzyFileSearch'] = [
          {
            'files': [
              {
                'root': '/repo',
                'path': '/repo/lib/a.dart',
                'file_name': 'a.dart',
                'score': 9,
              },
              {
                'root': '/repo',
                'path': '/repo-other/b.dart',
                'file_name': 'b.dart',
              },
            ],
          },
        ];
      final repository = DesktopComposerRepository(transport, cwd: '/repo');
      expect(await repository.files('   '), isEmpty);
      expect(transport.calls, isEmpty);
      final files = await repository.files(' a ');
      expect(files.first['path'], 'lib/a.dart');
      expect(files.last['path'], '/repo-other/b.dart');
      expect(transport.calls.single['params'], {
        'query': 'a',
        'roots': ['/repo'],
        'cancellationToken': null,
      });
    },
  );
  test('a late discovery response from a previous Mac is rejected', () async {
    final gate = Completer<RemoteJson>();
    final transport = ComposerTransport()..results['plugin/list'] = [gate];
    final pending = DesktopComposerRepository(
      transport,
      cwd: '/repo',
    ).plugins();
    transport.mac = 'replacement-mac';
    gate.complete({'marketplaces': []});
    await expectLater(pending, throwsStateError);
  });
}
