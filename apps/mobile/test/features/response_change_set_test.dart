import 'dart:io';
import 'package:djl_mobile/features/desktop/data/desktop_local_store.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/workspace/domain/response_change_set.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';

const patch =
    'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old  \n+new  \n';
Map<String, dynamic> event(
  String type, [
  Map<String, dynamic> extra = const {},
]) => {
  'threadId': 't',
  'turnId': 'v',
  ...extra,
  'item': {
    'id': 'file',
    'type': type,
    'status': 'completed',
    'changes': [
      {'path': 'a.txt'},
    ],
  },
};
void feed(ResponseChangeLedger l, String method, Map<String, dynamic> p) =>
    l.ingest(method, p, knownThreads: {'t'}, cwdFor: (_) => '/repo');
void finish(ResponseChangeLedger l) {
  feed(l, 'item/completed', {
    'threadId': 't',
    'turnId': 'v',
    'item': {'id': 'answer', 'type': 'agentMessage'},
  });
  feed(l, 'turn/completed', {
    'threadId': 't',
    'turn': {'id': 'v', 'status': 'completed'},
  });
}

void main() {
  test(
    'aggregate needs exact same-turn applied evidence and canonical response',
    () {
      final l = ResponseChangeLedger();
      feed(l, 'turn/diff/updated', {
        'threadId': 't',
        'turnId': 'v',
        'diff': patch,
      });
      finish(l);
      expect(l.forAssistant('t', 'answer')!.ready, false);
      feed(l, 'item/completed', event('fileChange', {'turnId': 'wrong'}));
      expect(l.forAssistant('t', 'answer')!.ready, false);
      final turnless = event('fileChange')..remove('turnId');
      feed(l, 'item/completed', turnless);
      expect(l.forAssistant('t', 'answer')!.ready, false);
      feed(l, 'item/completed', event('fileChange'));
      expect(l.forAssistant('t', 'answer')!.ready, true);
    },
  );
  test(
    'widened diff cannot own unrelated dirty user edits, checkpoint ignored',
    () {
      final l = ResponseChangeLedger();
      feed(l, 'item/completed', event('fileChange'));
      feed(l, 'turn/diff/updated', {
        'threadId': 't',
        'turnId': 'v',
        'diff': patch + patch.replaceAll('a.txt', 'user.txt'),
      });
      finish(l);
      expect(l.forAssistant('t', 'answer')!.ready, false);
      feed(l, 'workspace/checkpointDiff', {
        'threadId': 't',
        'turnId': 'v',
        'diff': patch,
      });
      expect(l.forAssistant('t', 'answer')!.ready, false);
      feed(l, 'turn/diff/updated', {
        'threadId': 't',
        'turnId': 'v',
        'diff': patch,
      });
      expect(l.forAssistant('t', 'answer')!.ready, true);
    },
  );
  test(
    'late diff finalizes and preserves CRLF whitespace and newline marker',
    () {
      final raw =
          '${patch.replaceAll('\n', '\r\n')}\\ No newline at end of file';
      final l = ResponseChangeLedger();
      finish(l);
      feed(l, 'item/completed', event('fileChange'));
      feed(l, 'turn/diff/updated', {
        'threadId': 't',
        'turnId': 'v',
        'diff': raw,
      });
      final e = l.forAssistant('t', 'answer')!;
      expect(e.ready, true);
      expect(e.patches.single.forwardPatch, '$raw\n');
    },
  );
  test('only canonical final assistant owns a turn', () {
    final l = ResponseChangeLedger();
    feed(l, 'item/completed', {
      'threadId': 't',
      'turnId': 'v',
      'item': {'id': 'intermediate', 'type': 'agentMessage'},
    });
    feed(l, 'item/completed', event('fileChange'));
    feed(l, 'turn/diff/updated', {
      'threadId': 't',
      'turnId': 'v',
      'diff': patch,
    });
    finish(l);
    expect(l.forAssistant('t', 'intermediate'), null);
    expect(l.forAssistant('t', 'answer')!.ready, true);
    l.noteAssistant('t', 'v', 'history-answer');
    expect(l.forAssistant('t', 'answer'), null);
    expect(l.forAssistant('t', 'history-answer')!.ready, true);
  });
  test(
    'applied fallback batches reverse newest first, echoes dedup, distinct operations survive',
    () {
      final l = ResponseChangeLedger();
      void add(String id, String diff) => feed(l, 'codex/event', {
        'thread_id': 't',
        'turn_id': 'v',
        'msg': {
          'type': 'patch_apply_end',
          'call_id': id,
          'success': true,
          'changes': {
            'a.txt': {'diff': diff},
          },
        },
      });
      add('one', patch);
      add('one', patch);
      add('two', patch.replaceAll('old', 'new').replaceAll('+new', '+third'));
      finish(l);
      final e = l.forAssistant('t', 'answer')!;
      expect(e.ready, true);
      expect(e.patches.map((p) => p.id), ['two:0', 'one:0']);
      add('three', patch);
      expect(e.patches.length, 3);
    },
  );
  test(
    'failed, begin, text and synthesized partial diffs cannot authorize undo',
    () {
      for (final p in [
        {'type': 'patch_apply_begin', 'success': true},
        {'type': 'patch_apply_end', 'success': false},
        {'type': 'patch_apply_end'},
      ]) {
        final l = ResponseChangeLedger();
        feed(l, 'codex/event', {
          'threadId': 't',
          'turnId': 'v',
          'msg': {
            ...p,
            'call_id': 'x',
            'changes': {
              'a.txt': {'diff': patch},
            },
          },
        });
        finish(l);
        expect(l.forAssistant('t', 'answer')!.ready, false);
      }
      final l = ResponseChangeLedger();
      feed(l, 'item/completed', {
        'threadId': 't',
        'turnId': 'v',
        'item': {
          'id': 'x',
          'type': 'fileChange',
          'status': 'completed',
          'changes': [
            {'path': 'a.txt', 'diff': '@@ -1 +1 @@\n-old\n+new'},
          ],
        },
      });
      finish(l);
      expect(l.forAssistant('t', 'answer')!.ready, false);
    },
  );
  test('unsupported headers and unsafe paths fail closed', () {
    for (final raw in [
      patch.replaceFirst('---', 'old mode 100644\nnew mode 100755\n---'),
      patch.replaceAll('a.txt', '../secret'),
      patch.replaceFirst('@@ -1 +1 @@', 'GIT binary patch'),
    ]) {
      expect(ResponsePatch('x', raw).supported, false);
    }
  });
  test(
    'readonly tool patch-looking output and failed tool result grant no mutation evidence',
    () {
      for (final item in [
        {
          'id': 'read',
          'type': 'toolCall',
          'name': 'read_file',
          'status': 'completed',
          'path': 'a.txt',
          'output': {'diff': patch},
        },
        {
          'id': 'apply',
          'type': 'toolCall',
          'name': 'apply_patch',
          'status': 'completed',
          'result': {
            'success': false,
            'changes': [
              {'path': 'a.txt', 'diff': patch},
            ],
          },
        },
      ]) {
        final l = ResponseChangeLedger();
        feed(l, 'item/completed', {
          'threadId': 't',
          'turnId': 'v',
          'item': item,
        });
        feed(l, 'turn/diff/updated', {
          'threadId': 't',
          'turnId': 'v',
          'diff': patch,
        });
        finish(l);
        expect(l.forAssistant('t', 'answer')!.ready, false);
      }
    },
  );
  test(
    'legacy explicit turn identities support applied nested mutation results',
    () {
      final l = ResponseChangeLedger();
      feed(l, 'item/completed', {
        'threadId': 't',
        'turnId': 'v',
        'item': {
          'id': 'tool',
          'type': 'toolCall',
          'name': 'apply_patch',
          'status': 'completed',
          'result': {
            'success': true,
            'changes': [
              {'path': 'a.txt', 'diff': patch},
            ],
          },
        },
      });
      finish(l);
      expect(l.forAssistant('t', 'answer')!.ready, true);
    },
  );
  test(
    'one supported batch never hides another missing or unsupported applied patch',
    () {
      for (final diff in [
        null,
        patch.replaceFirst('---', 'old mode 100644\nnew mode 100755\n---'),
      ]) {
        final l = ResponseChangeLedger();
        feed(l, 'item/completed', {
          'threadId': 't',
          'turnId': 'v',
          'item': {
            'id': 'first',
            'type': 'fileChange',
            'status': 'completed',
            'changes': [
              {'path': 'a.txt', 'diff': patch},
            ],
          },
        });
        feed(l, 'item/completed', {
          'threadId': 't',
          'turnId': 'v',
          'item': {
            'id': 'second',
            'type': 'fileChange',
            'status': 'completed',
            'changes': [
              {'path': 'b.txt', 'diff': ?diff},
            ],
          },
        });
        finish(l);
        expect(l.forAssistant('t', 'answer')!.ready, false);
      }
    },
  );
  test('failed per-file results cannot grant same-turn path evidence', () {
    final l = ResponseChangeLedger();
    feed(l, 'item/completed', {
      'threadId': 't',
      'turnId': 'v',
      'item': {
        'id': 'x',
        'type': 'fileChange',
        'status': 'completed',
        'changes': [
          {'path': 'a.txt', 'status': 'failed', 'diff': patch},
        ],
      },
    });
    feed(l, 'turn/diff/updated', {
      'threadId': 't',
      'turnId': 'v',
      'diff': patch,
    });
    finish(l);
    expect(l.forAssistant('t', 'answer')!.ready, false);
  });
  test('modern and legacy aliases keep background turn ownership exact', () {
    for (final method in [
      'codex/event/turn_diff_updated',
      'codex/event/turn_diff',
      'codex/event',
    ]) {
      final l = ResponseChangeLedger();
      feed(l, 'item/fileChange/completed', {
        'thread_id': 't',
        'turn_id': 'v',
        'itemId': 'patch',
        'changes': {
          'a.txt': {'patch': patch},
        },
        'status': 'applied',
      });
      feed(l, method, {
        'conversation_id': 't',
        'turn_id': 'v',
        'event': {'type': 'turn_diff', 'unified_diff': patch},
      });
      finish(l);
      expect(l.forAssistant('t', 'answer')!.ready, true);
    }
  });
  test(
    'real create/delete patches are supported but mode-only and binary remain blocked',
    () {
      const create =
          'diff --git a/new.txt b/new.txt\nnew file mode 100755\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+created\n';
      const remove =
          'diff --git a/old.txt b/old.txt\ndeleted file mode 100644\n--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-removed\n';
      expect(ResponsePatch('create', create).supported, true);
      expect(ResponsePatch('delete', remove).supported, true);
    },
  );
  test(
    'one applied operation needs exact fallback coverage of every applied file',
    () {
      for (final shape in ['list', 'map', 'nested']) {
        final l = ResponseChangeLedger();
        Map<String, dynamic> operation(bool complete) {
          final b = patch.replaceAll('a.txt', 'b.txt');
          final changes = shape == 'list'
              ? [
                  {'path': 'a.txt', 'diff': patch},
                  {'path': 'b.txt', if (complete) 'diff': b},
                ]
              : {
                  'a.txt': {'diff': patch},
                  'b.txt': {if (complete) 'diff': b},
                };
          return {
            'threadId': 't',
            'turnId': 'v',
            'item': {
              'id': 'files',
              'type': shape == 'nested' ? 'toolCall' : 'fileChange',
              if (shape == 'nested') 'name': 'apply_patch',
              'status': 'completed',
              if (shape == 'nested')
                'result': {'success': true, 'changes': changes}
              else
                'changes': changes,
            },
          };
        }

        feed(l, 'item/completed', operation(false));
        finish(l);
        expect(l.forAssistant('t', 'answer')!.ready, false, reason: shape);
        feed(l, 'item/completed', operation(true));
        expect(
          l.forAssistant('t', 'answer')!.ready,
          true,
          reason: 'complete fallback $shape',
        );
        expect(l.forAssistant('t', 'answer')!.files, {'a.txt', 'b.txt'});
        final aggregate = ResponseChangeLedger();
        feed(aggregate, 'item/completed', operation(false));
        finish(aggregate);
        feed(aggregate, 'turn/diff/updated', {
          'threadId': 't',
          'turnId': 'v',
          'diff': patch + patch.replaceAll('a.txt', 'b.txt'),
        });
        expect(
          aggregate.forAssistant('t', 'answer')!.ready,
          true,
          reason: 'exact aggregate covers path-only $shape',
        );
      }
    },
  );
  test(
    'explicit ambiguous operation and nested result states never grant evidence',
    () {
      for (final status in [
        'stopped',
        'interrupted',
        'aborted',
        'in_progress',
        'in-progress',
        'In Progress',
        'queued',
        'unknown',
        '',
        null,
        17,
      ]) {
        for (final nested in [false, true]) {
          final l = ResponseChangeLedger();
          feed(l, 'item/completed', {
            'threadId': 't',
            'turnId': 'v',
            'item': {
              'id': 'x',
              'type': nested ? 'toolCall' : 'fileChange',
              if (nested) 'name': 'apply_patch',
              'status': nested ? 'completed' : status,
              'success': true,
              if (nested)
                'result': {
                  'status': status,
                  'changes': [
                    {'path': 'a.txt', 'diff': patch},
                  ],
                }
              else
                'changes': [
                  {'path': 'a.txt', 'diff': patch},
                ],
            },
          });
          feed(l, 'turn/diff/updated', {
            'threadId': 't',
            'turnId': 'v',
            'diff': patch,
          });
          finish(l);
          expect(
            l.forAssistant('t', 'answer')!.ready,
            false,
            reason: 'operation $status nested=$nested',
          );
        }
      }
    },
  );
  test(
    'explicit ambiguous per-file states never grant fallback or aggregate evidence',
    () {
      for (final status in [
        'stopped',
        'interrupted',
        'aborted',
        'in_progress',
        'in-progress',
        'In Progress',
        'queued',
        'UNKNOWN',
        '',
        null,
        17,
      ]) {
        for (final mapShape in [false, true]) {
          final l = ResponseChangeLedger();
          final file = {'status': status, 'diff': patch};
          feed(l, 'item/completed', {
            'threadId': 't',
            'turnId': 'v',
            'item': {
              'id': 'x',
              'type': 'fileChange',
              'status': 'completed',
              'changes': mapShape
                  ? {'a.txt': file}
                  : [
                      {'path': 'a.txt', ...file},
                    ],
            },
          });
          feed(l, 'turn/diff/updated', {
            'threadId': 't',
            'turnId': 'v',
            'diff': patch,
          });
          finish(l);
          expect(
            l.forAssistant('t', 'answer')!.ready,
            false,
            reason: 'file $status map=$mapShape',
          );
        }
      }
    },
  );
  test(
    'an explicit ambiguous child cannot be overridden by its parent path and patch',
    () {
      final l = ResponseChangeLedger();
      feed(l, 'item/completed', {
        'threadId': 't',
        'turnId': 'v',
        'item': {
          'id': 'x',
          'type': 'fileChange',
          'status': 'completed',
          'path': 'a.txt',
          'diff': patch,
          'changes': [
            {'path': 'a.txt', 'status': 'queued', 'diff': patch},
          ],
        },
      });
      feed(l, 'turn/diff/updated', {
        'threadId': 't',
        'turnId': 'v',
        'diff': patch,
      });
      finish(l);
      expect(l.forAssistant('t', 'answer')!.ready, false);
    },
  );
  test(
    'positive applied states and absent modern child states remain supported',
    () {
      for (final status in [
        'completed',
        'APPLIED',
        'succeeded',
        'success',
        'finished',
        'done',
      ]) {
        final l = ResponseChangeLedger();
        feed(l, 'item/completed', {
          'threadId': 't',
          'turnId': 'v',
          'item': {
            'id': 'x',
            'type': 'fileChange',
            'status': status,
            'changes': [
              {'path': 'a.txt', 'status': status, 'diff': patch},
            ],
          },
        });
        finish(l);
        expect(l.forAssistant('t', 'answer')!.ready, true, reason: status);
      }
      final l = ResponseChangeLedger();
      feed(l, 'item/completed', {
        'threadId': 't',
        'turnId': 'v',
        'item': {
          'id': 'x',
          'type': 'fileChange',
          'changes': [
            {'path': 'a.txt', 'diff': patch},
          ],
        },
      });
      finish(l);
      expect(l.forAssistant('t', 'answer')!.ready, true);
    },
  );
  test(
    'stopped turn retains earlier proven patches without adopting its aborted operation',
    () {
      final l = ResponseChangeLedger();
      feed(l, 'item/completed', {
        'threadId': 't',
        'turnId': 'v',
        'item': {
          'id': 'applied',
          'type': 'fileChange',
          'status': 'completed',
          'changes': [
            {'path': 'a.txt', 'diff': patch},
          ],
        },
      });
      feed(l, 'item/completed', {
        'threadId': 't',
        'turnId': 'v',
        'item': {
          'id': 'aborted',
          'type': 'fileChange',
          'status': 'aborted',
          'changes': [
            {'path': 'b.txt', 'diff': patch.replaceAll('a.txt', 'b.txt')},
          ],
        },
      });
      feed(l, 'item/completed', {
        'threadId': 't',
        'turnId': 'v',
        'item': {'id': 'answer', 'type': 'agentMessage'},
      });
      feed(l, 'turn/completed', {
        'threadId': 't',
        'turn': {'id': 'v', 'status': 'stopped'},
      });
      expect(l.forAssistant('t', 'answer')!.ready, true);
      expect(l.forAssistant('t', 'answer')!.files, {'a.txt'});
    },
  );
  test(
    'recognized legacy payload turn IDs and operation call IDs stay distinct',
    () {
      for (final envelope in ['msg', 'event']) {
        final l = ResponseChangeLedger();
        for (final call in ['one', 'two']) {
          feed(l, 'codex/event', {
            envelope: {
              'type': 'patch_apply_end',
              'conversationId': 't',
              'id': 'v',
              if (call == 'one') 'call_id': call else 'callId': call,
              'success': true,
              'changes': {
                'a.txt': {
                  'diff': call == 'one'
                      ? patch
                      : patch.replaceAll('+new', '+third'),
                },
              },
            },
          });
        }
        finish(l);
        expect(l.entries.length, 1);
        expect(l.forAssistant('t', 'answer')!.ready, true);
        expect(l.forAssistant('t', 'answer')!.patches.map((p) => p.id), [
          'two:0',
          'one:0',
        ]);
        feed(l, 'codex/event', {
          envelope: {
            'type': 'turn_diff',
            'conversationId': 't',
            'id': 'v',
            'unified_diff': patch,
          },
        });
        expect(l.entries.length, 1);
        expect(l.forAssistant('t', 'answer')!.aggregate!.forwardPatch, patch);
        final wrong = ResponseChangeLedger();
        feed(wrong, 'codex/event', {
          envelope: {
            'type': 'patch_apply_end',
            'conversationId': 'unknown',
            'id': 'v',
            'call_id': 'one',
            'success': true,
            'changes': {
              'a.txt': {'diff': patch},
            },
          },
        });
        expect(wrong.entries, isEmpty);
        feed(wrong, 'codex/event', {
          envelope: {
            'type': 'unrecognized',
            'conversationId': 't',
            'id': 'v',
            'call_id': 'one',
            'success': true,
            'changes': {
              'a.txt': {'diff': patch},
            },
          },
        });
        expect(wrong.entries, isEmpty);
      }
    },
  );
  test(
    'status and success filenames retain exact fallback and aggregate authority in every source shape',
    () {
      for (final name in ['status', 'success']) {
        final exact = patch.replaceAll('a.txt', name);
        for (final shape in ['map', 'list', 'nested-map', 'nested-list']) {
          final nested = shape.startsWith('nested'),
              list = shape.endsWith('list');
          Map<String, dynamic> operation(bool withPatch) {
            final file = {
              'status': 'completed',
              'success': true,
              if (withPatch) 'diff': exact,
            };
            final changes = list
                ? [
                    {'path': name, ...file},
                  ]
                : {name: file};
            return {
              'threadId': 't',
              'turnId': 'v',
              'item': {
                'id': 'files',
                'type': nested ? 'toolCall' : 'fileChange',
                if (nested) 'name': 'apply_patch',
                'status': 'completed',
                if (nested)
                  'result': {
                    'status': 'completed',
                    'success': true,
                    'changes': changes,
                  }
                else
                  'changes': changes,
              },
            };
          }

          final fallback = ResponseChangeLedger();
          feed(fallback, 'item/completed', operation(true));
          finish(fallback);
          final entry = fallback.forAssistant('t', 'answer')!;
          expect(entry.ready, true, reason: '$name $shape fallback');
          expect(entry.patches.single.forwardPatch, exact);
          expect(entry.files, {name});
          final aggregate = ResponseChangeLedger();
          feed(aggregate, 'item/completed', operation(false));
          finish(aggregate);
          expect(aggregate.forAssistant('t', 'answer')!.ready, false);
          feed(aggregate, 'turn/diff/updated', {
            'threadId': 't',
            'turnId': 'v',
            'diff': exact,
          });
          expect(
            aggregate.forAssistant('t', 'answer')!.ready,
            true,
            reason: '$name $shape aggregate',
          );
          expect(aggregate.forAssistant('t', 'answer')!.files, {name});
        }
      }
    },
  );
  test(
    'dictionary filename handling cannot bypass actual file or nested state metadata',
    () {
      for (final name in ['status', 'success']) {
        final exact = patch.replaceAll('a.txt', name);
        for (final invalid in [
          {'status': 'queued'},
          {
            'status': {'malformed': true},
          },
          {'success': false},
          {
            'success': {'malformed': true},
          },
        ]) {
          for (final nested in [false, true]) {
            final l = ResponseChangeLedger();
            feed(l, 'item/completed', {
              'threadId': 't',
              'turnId': 'v',
              'item': {
                'id': 'files',
                'type': nested ? 'toolCall' : 'fileChange',
                if (nested) 'name': 'apply_patch',
                'status': 'completed',
                if (nested)
                  'result': {
                    'status': 'completed',
                    'changes': {
                      name: {...invalid, 'diff': exact},
                    },
                  }
                else
                  'changes': {
                    name: {...invalid, 'diff': exact},
                  },
              },
            });
            feed(l, 'turn/diff/updated', {
              'threadId': 't',
              'turnId': 'v',
              'diff': exact,
            });
            finish(l);
            expect(
              l.forAssistant('t', 'answer')!.ready,
              false,
              reason: '$name $invalid nested=$nested',
            );
          }
        }
      }
      for (final invalid in [
        {'status': 'queued'},
        {'success': false},
      ]) {
        final l = ResponseChangeLedger();
        feed(l, 'item/completed', {
          'threadId': 't',
          'turnId': 'v',
          'item': {
            'id': 'files',
            'type': 'fileChange',
            'status': 'completed',
            'changes': [
              {'path': 'a.txt', 'diff': patch, ...invalid},
            ],
          },
        });
        feed(l, 'turn/diff/updated', {
          'threadId': 't',
          'turnId': 'v',
          'diff': patch,
        });
        finish(l);
        expect(l.forAssistant('t', 'answer')!.ready, false);
      }
    },
  );
  test(
    'raw patches and reverted results use existing authenticated per-Mac encryption',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'djl-response-ledger-',
      );
      try {
        final credentials = TestCredentials(),
            store = DesktopLocalStore(credentials, root: root),
            state = ThreadLocalState();
        final l = state.responseChanges;
        feed(l, 'item/completed', event('fileChange'));
        feed(l, 'turn/diff/updated', {
          'threadId': 't',
          'turnId': 'v',
          'diff': patch,
        });
        finish(l);
        l.forAssistant('t', 'answer')!.reverted = true;
        await store.save('mac-one', state.toJson());
        final files = await root
            .list(recursive: true)
            .where((f) => f is File)
            .cast<File>()
            .toList();
        expect(files.length, 1);
        expect(
          await files.single.readAsString(),
          isNot(contains('diff --git')),
        );
        final restored = ThreadLocalState.fromJson(
          await DesktopLocalStore(credentials, root: root).load('mac-one'),
        );
        expect(
          restored.responseChanges.forAssistant('t', 'answer')!.reverted,
          true,
        );
        expect(
          restored.responseChanges
              .forAssistant('t', 'answer')!
              .aggregate!
              .forwardPatch,
          patch,
        );
        expect(await store.load('mac-two'), isEmpty);
      } finally {
        await root.delete(recursive: true);
      }
    },
  );
  test(
    'encrypted-cache field round trips tombstones and replay cannot resurrect',
    () {
      final s = ThreadLocalState();
      final l = s.responseChanges;
      feed(l, 'item/completed', event('fileChange'));
      feed(l, 'turn/diff/updated', {
        'threadId': 't',
        'turnId': 'v',
        'diff': patch,
      });
      finish(l);
      l.forAssistant('t', 'answer')!.reverted = true;
      final restored = ThreadLocalState.fromJson(s.toJson()).responseChanges;
      feed(restored, 'item/completed', event('fileChange'));
      feed(restored, 'turn/diff/updated', {
        'threadId': 't',
        'turnId': 'v',
        'diff': patch,
      });
      finish(restored);
      expect(restored.forAssistant('t', 'answer')!.reverted, true);
      expect(restored.forAssistant('t', 'answer')!.ready, false);
    },
  );
}
