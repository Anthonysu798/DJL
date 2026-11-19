import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_new_chat_draft_test.dart'
    show DraftTransport, draftDesktop, finishDraft;

class CatalogRefreshTransport extends DraftTransport {
  CatalogRefreshTransport(super.pairings);
  final pending = Completer<RemoteJson>();
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) {
    if (method == 'model/list') {
      calls.add({'method': method, 'params': params});
      return pending.future;
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<DesktopController> catalogDesktop(
  WidgetTester tester,
  CatalogRefreshTransport remote,
) async {
  final desktop = await draftDesktop(remote);
  desktop.thread = {'id': 'catalog125'};
  desktop.model = 'qa';
  desktop.turnId = 'running125';
  await tester.pumpWidget(
    MaterialApp(home: DesktopChatPage(controller: desktop)),
  );
  await tester.pumpAndSettle();
  remote.calls.clear();
  return desktop;
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'refreshed capabilities normalize only next-turn unsupported choices',
    (tester) async {
      final remote = CatalogRefreshTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await catalogDesktop(tester, remote);
      desktop.effort = 'high';
      desktop.serviceTier = 'fast';
      final pending = desktop.refreshModels();
      remote.pending.complete({
        'data': [
          {
            'id': 'qa',
            'model': 'qa',
            'supportedReasoningEfforts': ['low', 'medium'],
            'defaultReasoningEffort': 'medium',
          },
        ],
      });
      await pending;
      expect(desktop.model, 'qa');
      expect(desktop.effort, 'medium');
      expect(desktop.serviceTier, 'default');
      expect(desktop.turnId, 'running125');
      expect(remote.calls, [
        {'method': 'model/list', 'params': <String, Object?>{}},
      ]);
      await finishDraft(tester, desktop);
    },
  );
  for (final key in ['data', 'items', 'models']) {
    testWidgets(
      'catalog refresh accepts $key without touching active execution or selection',
      (tester) async {
        final remote = CatalogRefreshTransport(
          PairingRepository(TestCredentials()),
        );
        final desktop = await catalogDesktop(tester, remote);
        final pending = desktop.refreshModels();
        expect(desktop.isLoadingModels, isTrue);
        expect(desktop.busy, isFalse);
        remote.pending.complete({
          key: [
            {'id': 'opaque::fresh', 'model': 'fresh'},
          ],
        });
        await pending;
        expect(desktop.models.single['id'], 'opaque::fresh');
        expect(
          desktop.model,
          'qa',
          reason:
              'A disappeared selected model must not silently become another provider',
        );
        expect(desktop.thread?['id'], 'catalog125');
        expect(desktop.turnId, 'running125');
        expect(desktop.isLoadingModels, isFalse);
        expect(remote.calls, [
          {'method': 'model/list', 'params': <String, Object?>{}},
        ]);
        await finishDraft(tester, desktop);
      },
    );
  }

  testWidgets('concurrent catalog refreshes share one pending read', (
    tester,
  ) async {
    final remote = CatalogRefreshTransport(
      PairingRepository(TestCredentials()),
    );
    final desktop = await catalogDesktop(tester, remote);
    final first = desktop.refreshModels();
    var secondDone = false;
    final second = desktop.refreshModels().then((_) => secondDone = true);
    await tester.pump();
    expect(secondDone, isFalse);
    expect(remote.calls, hasLength(1));
    remote.pending.complete({
      'data': [
        {'id': 'qa', 'model': 'qa'},
      ],
    });
    await Future.wait([first, second]);
    expect(desktop.isLoadingModels, isFalse);
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'catalog failure retains the usable catalog and existing chat error',
    (tester) async {
      final remote = CatalogRefreshTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await catalogDesktop(tester, remote);
      final previous = desktop.models;
      desktop.error = 'Existing chat error';
      final pending = desktop.refreshModels();
      final failure = expectLater(pending, throwsStateError);
      remote.pending.completeError(StateError('Catalog unavailable'));
      await failure;
      expect(desktop.models, same(previous));
      expect(desktop.error, 'Existing chat error');
      expect(desktop.isLoadingModels, isFalse);
      expect(desktop.turnId, 'running125');
      await finishDraft(tester, desktop);
    },
  );

  for (final failed in [false, true]) {
    testWidgets(
      'a replaced pin ignores late catalog ${failed ? 'error' : 'data'}',
      (tester) async {
        final remote = CatalogRefreshTransport(
          PairingRepository(TestCredentials()),
        );
        final desktop = await catalogDesktop(tester, remote);
        final pending = desktop.refreshModels();
        final replacement = <RemoteJson>[
          {'id': 'replacement', 'model': 'replacement'},
        ];
        desktop.active = Pairing({
          ...desktop.active!.data,
          'macIdentityPublicKey': 'new-pin125',
        });
        desktop.models = replacement;
        desktop.model = 'replacement';
        desktop.error = 'Replacement error';
        if (failed) {
          remote.pending.completeError(StateError('Old catalog failure'));
        } else {
          remote.pending.complete({
            'data': [
              {'id': 'stale', 'model': 'stale'},
            ],
          });
        }
        await pending;
        expect(desktop.models, same(replacement));
        expect(desktop.model, 'replacement');
        expect(desktop.error, 'Replacement error');
        expect(desktop.isLoadingModels, isFalse);
        await finishDraft(tester, desktop);
      },
    );
  }

  testWidgets(
    'disposed catalog refresh discards late failure without notifying',
    (tester) async {
      final remote = CatalogRefreshTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await catalogDesktop(tester, remote);
      final pending = desktop.refreshModels();
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      remote.pending.completeError(StateError('Disposed catalog failure'));
      await pending;
      await tester.pump();
      expect(tester.takeException(), isNull);
    },
  );
}
