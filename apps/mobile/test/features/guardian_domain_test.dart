import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/guardian/domain/guardian_review.dart';
import 'guardian_review_test.dart' show guardianParams;

void main() {
  final actions = <Map<String, dynamic>, Map<String, dynamic>>{
    {
      'type': 'command',
      'source': 'unifiedExec',
      'command': 'echo test',
      'cwd': '/tmp',
      'extra': 'drop',
    }: {
      'type': 'command',
      'source': 'unified_exec',
      'command': 'echo test',
      'cwd': '/tmp',
    },
    {
      'type': 'execve',
      'source': 'unifiedExec',
      'program': '/bin/ls',
      'argv': ['/bin/ls', 'a b'],
      'cwd': '/tmp',
    }: {
      'type': 'execve',
      'source': 'unified_exec',
      'program': '/bin/ls',
      'argv': ['/bin/ls', 'a b'],
      'cwd': '/tmp',
    },
    {
      'type': 'applyPatch',
      'cwd': '/tmp',
      'files': ['a', 'b'],
    }: {
      'type': 'apply_patch',
      'cwd': '/tmp',
      'files': ['a', 'b'],
    },
    {
      'type': 'networkAccess',
      'target': 'https://example.com',
      'host': 'example.com',
      'protocol': 'socks5Tcp',
      'port': 443,
    }: {
      'type': 'network_access',
      'target': 'https://example.com',
      'host': 'example.com',
      'protocol': 'socks5_tcp',
      'port': 443,
    },
    {
      'type': 'mcpToolCall',
      'server': 'calendar',
      'toolName': 'create_event',
      'connectorId': null,
      'connectorName': 'Calendar',
      'toolTitle': 'Create event',
      'arbitrary': {'never': 'send'},
    }: {
      'type': 'mcp_tool_call',
      'server': 'calendar',
      'tool_name': 'create_event',
      'connector_id': null,
      'connector_name': 'Calendar',
      'tool_title': 'Create event',
    },
    {
      'type': 'requestPermissions',
      'reason': 'Need files',
      'permissions': {
        'network': {'enabled': true},
        'fileSystem': {
          'read': ['/a'],
          'write': ['/b'],
          'globScanMaxDepth': 4,
        },
      },
    }: {
      'type': 'request_permissions',
      'reason': 'Need files',
      'permissions': {
        'network': {'enabled': true},
        'file_system': {
          'entries': [
            {
              'path': {'type': 'path', 'path': '/a'},
              'access': 'read',
            },
            {
              'path': {'type': 'path', 'path': '/b'},
              'access': 'write',
            },
          ],
          'glob_scan_max_depth': 4,
        },
      },
    },
  };
  for (final entry in actions.entries) {
    test(
      'denied ${entry.key['type']} maps only source-compatible core fields',
      () {
        final review = GuardianReview.decode(
          guardianParams(action: entry.key),
        )!;
        expect(review.coreDeniedEvent, {
          'id': 'review-1',
          'turn_id': 'turn-1',
          'started_at_ms': 10,
          'completed_at_ms': 20,
          'target_item_id': 'item-1',
          'status': 'denied',
          'risk_level': 'high',
          'user_authorization': 'low',
          'rationale': 'Writes outside workspace',
          'decision_source': 'agent',
          'action': entry.value,
        });
        expect(
          review.toRow('thread-1').toString(),
          isNot(contains('coreDeniedEvent')),
        );
      },
    );
  }
  test(
    'permission profiles support canonical special paths, legacy paths and nulls',
    () {
      final canonical = GuardianReview.decode(
        guardianParams(
          action: {
            'type': 'requestPermissions',
            'permissions': {
              'network': null,
              'fileSystem': {
                'entries': [
                  {
                    'path': {
                      'type': 'special',
                      'value': {'kind': 'project_roots', 'subpath': null},
                    },
                    'access': 'write',
                  },
                ],
                'globScanMaxDepth': 4,
              },
            },
          },
        ),
      )!;
      expect((canonical.coreDeniedEvent!['action'] as Map)['permissions'], {
        'network': null,
        'file_system': {
          'entries': [
            {
              'path': {
                'type': 'special',
                'value': {'kind': 'project_roots', 'subpath': null},
              },
              'access': 'write',
            },
          ],
          'glob_scan_max_depth': 4,
        },
      });
      final legacy = GuardianReview.decode(
        guardianParams(
          action: {
            'type': 'requestPermissions',
            'permissions': {
              'fileSystem': {
                'read': ['/a'],
                'write': ['/b'],
              },
            },
          },
        ),
      )!;
      expect((legacy.coreDeniedEvent!['action'] as Map)['permissions'], {
        'file_system': {
          'read': ['/a'],
          'write': ['/b'],
        },
      });
      expect(
        GuardianReview.decode(
          guardianParams(
            action: {
              'type': 'requestPermissions',
              'permissions': {'fileSystem': null},
            },
          ),
        )!.coreDeniedEvent,
        isNotNull,
      );
    },
  );
  for (final action in [
    null,
    1,
    {'type': 'futureAction', 'payload': 'opaque'},
    {'type': 'command', 'command': 'missing source and cwd'},
    {
      'type': 'execve',
      'source': 'shell',
      'program': 'ls',
      'argv': [2],
      'cwd': '/',
    },
    {
      'type': 'networkAccess',
      'target': 'x',
      'host': 'x',
      'protocol': 'tcp',
      'port': '443',
    },
    {
      'type': 'applyPatch',
      'cwd': '/',
      'files': [false],
    },
    {
      'type': 'requestPermissions',
      'permissions': {
        'fileSystem': {
          'entries': [
            {
              'path': {'type': 'unknown'},
              'access': 'write',
            },
          ],
        },
      },
    },
    {
      'type': 'requestPermissions',
      'permissions': {
        'network': {'unrecognized': true},
      },
    },
  ]) {
    test(
      'unknown or malformed action never becomes retry authority: $action',
      () {
        final params = guardianParams()..['action'] = action;
        final review = GuardianReview.decode(params)!;
        expect(review.coreDeniedEvent, isNull);
        expect(
          review.retryUnavailableReason,
          contains('cannot be retried safely'),
        );
      },
    );
  }
  test(
    'malformed lifecycle payloads are rejected and unknown status stays terminal',
    () {
      for (final bad in [
        guardianParams()..remove('reviewId'),
        guardianParams()..['reviewId'] = ' ',
        guardianParams()..['turnId'] = null,
        guardianParams()..['review'] = [],
        guardianParams()..['review'] = {'status': 1},
      ]) {
        expect(GuardianReview.decode(bad), isNull);
      }
      final unknown = GuardianReview.decode(
        guardianParams(status: 'needsConfirmation'),
      )!;
      expect(unknown.status, 'needsConfirmation');
      expect(unknown.isTerminal, true);
      expect(unknown.coreDeniedEvent, isNull);
    },
  );
}
