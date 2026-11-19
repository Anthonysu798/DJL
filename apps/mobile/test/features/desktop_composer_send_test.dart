import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import 'desktop_requests_test.dart' show TestTransport;
import '../core/cloud_client_test.dart' show TestCredentials;

class MixedTransport extends TestTransport {
  MixedTransport(super.pairings);
  final responses = <Object>[];
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (!{'turn/start', 'turn/steer'}.contains(method)) {
      return super.request(method, params, timeout: timeout);
    }
    calls.add({'method': method, 'params': params});
    if (responses.isNotEmpty) {
      final next = responses.removeAt(0);
      if (next is Completer<RemoteJson>) return next.future;
      if (next is RemoteJson) return next;
      throw next;
    }
    return {
      'turn': {'id': 'turn-1'},
    };
  }
}

class NewChatTransport extends MixedTransport {
  NewChatTransport(super.pairings);
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/start') {
      return {
        'thread': {'id': 'created'},
      };
    }
    if (method == 'thread/list') {
      return {
        'data': [
          {'id': 'created'},
        ],
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

DesktopComposerDraft mixed({String text = '  inspect  '}) =>
    DesktopComposerDraft(
      text: text,
      images: [
        const DesktopComposerImage(
          id: 'image-1',
          name: 'photo.jpg',
          dataUrl: 'data:image/jpeg;base64,YQ==',
        ),
      ],
      contexts: [
        const DesktopComposerContext(
          kind: DesktopContextKind.skill,
          id: 'review-id',
          name: 'review',
          path: '/skills/review/SKILL.md',
        ),
        const DesktopComposerContext(
          kind: DesktopContextKind.plugin,
          id: 'plugin://drive@official',
          name: 'drive',
          path: 'plugin://drive@official',
        ),
        const DesktopComposerContext(
          kind: DesktopContextKind.file,
          id: 'lib/a.dart',
          name: 'a.dart',
          path: 'lib/a.dart',
        ),
      ],
    );
DesktopController setup(MixedTransport transport) =>
    DesktopController(transport.pairings, connection: transport)
      ..thread = {'id': 't1'}
      ..model = 'qa';

void main() {
  for (final shape in ['canonical', 'legacy', 'snake', 'plain', 'missing']) {
    test(
      'steer $shape acknowledgement owns the accepted turn and Stop',
      () async {
        final transport = MixedTransport(PairingRepository(TestCredentials()));
        final desktop = setup(transport)..turnId = 'expected-live';
        transport.responses.add(switch (shape) {
          'canonical' => <String, dynamic>{'turnId': 'accepted-live'},
          'snake' => <String, dynamic>{'turn_id': 'accepted-live'},
          'plain' => <String, dynamic>{'id': 'accepted-live'},
          'legacy' => <String, dynamic>{
            'turn': {'id': 'accepted-live'},
          },
          _ => <String, dynamic>{},
        });
        final accepted = shape == 'missing' ? 'expected-live' : 'accepted-live';
        expect(await desktop.send('public steering follow-up'), isTrue);
        expect(transport.calls.single['method'], 'turn/steer');
        expect(
          (transport.calls.single['params'] as Map)['expectedTurnId'],
          'expected-live',
        );
        expect(desktop.turnId, accepted);
        expect(desktop.timeline.single['turnId'], accepted);
        expect(desktop.timeline.single['delivery'], 'confirmed');
        await desktop.stop();
        expect(transport.calls.last['method'], 'turn/interrupt');
        expect((transport.calls.last['params'] as Map)['turnId'], accepted);
        expect(
          transport.calls.where((call) => call['method'] == 'turn/start'),
          isEmpty,
        );
        desktop.dispose();
      },
    );
  }
  test(
    'steer acknowledgement preserves nested then canonical ID precedence',
    () async {
      final transport = MixedTransport(PairingRepository(TestCredentials()));
      final desktop = setup(transport)..turnId = 'expected-live';
      transport.responses.add({
        'turn': {'id': 'nested-live'},
        'turnId': 'canonical-live',
        'turn_id': 'snake-live',
        'id': 'plain-live',
      });
      expect(await desktop.send('first follow-up'), isTrue);
      expect(desktop.turnId, 'nested-live');
      transport.responses.add({
        'turnId': 'canonical-live',
        'turn_id': 'snake-live',
        'id': 'plain-live',
      });
      expect(await desktop.send('second follow-up'), isTrue);
      expect(desktop.turnId, 'canonical-live');
      expect(desktop.timeline.map((row) => row['turnId']), [
        'nested-live',
        'canonical-live',
      ]);
      expect(
        desktop.timeline.map((row) => row['delivery']),
        everyElement('confirmed'),
      );
      desktop.dispose();
    },
  );
  for (final itemKey in ['type', 'item', 'content', 'output']) {
    test(
      'steer item payload $itemKey never replaces the active turn with its id',
      () async {
        final transport = MixedTransport(PairingRepository(TestCredentials()));
        final desktop = setup(transport)..turnId = 'expected-live';
        transport.responses.add({'id': 'item-only-id', itemKey: null});
        expect(await desktop.send('item-shaped acknowledgement'), isTrue);
        expect(desktop.turnId, 'expected-live');
        expect(desktop.timeline.single['turnId'], 'expected-live');
        expect(desktop.timeline.single['delivery'], 'confirmed');
        await desktop.stop();
        expect(
          (transport.calls.last['params'] as Map)['turnId'],
          'expected-live',
        );
        desktop.dispose();
      },
    );
  }
  test(
    'ambiguous path-only echo never replaces either same-turn image-only optimistic row or borrows its preview',
    () async {
      final transport = MixedTransport(PairingRepository(TestCredentials()));
      final desktop = setup(transport);
      await desktop.sendDraft(DesktopComposerDraft(images: mixed().images));
      await desktop.sendDraft(
        DesktopComposerDraft(
          images: [
            const DesktopComposerImage(
              id: 'later',
              name: 'later.jpg',
              dataUrl: 'data:image/jpeg;base64,Yg==',
            ),
          ],
        ),
      );
      final ids = desktop.timeline.map((v) => v['id']).toList();
      transport.events.add({
        'method': 'item/started',
        'params': {
          'threadId': 't1',
          'turnId': 'turn-1',
          'item': {
            'id': 'later-canonical',
            'type': 'userMessage',
            'content': [
              {'type': 'image', 'path': '/desktop/later.jpg'},
            ],
          },
        },
      });
      expect(desktop.timeline.take(2).map((v) => v['id']), ids);
      expect(desktop.timeline, hasLength(3));
      expect(
        (desktop.timeline.last['content'] as List).single['_previewUrl'],
        isNull,
      );
      desktop.dispose();
    },
  );

  for (final steer in [false, true]) {
    test(
      'mixed ${steer ? 'steer' : 'start'} emits image, legacy text, skill and mention items',
      () async {
        final transport = MixedTransport(PairingRepository(TestCredentials()));
        final desktop = setup(transport)..turnId = steer ? 'running' : null;
        expect(await desktop.sendDraft(mixed()), isTrue);
        expect(
          transport.calls.single['method'],
          steer ? 'turn/steer' : 'turn/start',
        );
        final params = transport.calls.single['params'] as Map;
        expect(params['input'], [
          {'type': 'image', 'url': 'data:image/jpeg;base64,YQ=='},
          {'type': 'text', 'text': 'inspect\n\n\$review @drive @lib/a.dart'},
          {
            'type': 'skill',
            'id': 'review-id',
            'name': 'review',
            'path': '/skills/review/SKILL.md',
          },
          {
            'type': 'mention',
            'name': 'drive',
            'path': 'plugin://drive@official',
          },
        ]);
        expect(params['expectedTurnId'], steer ? 'running' : null);
        expect(desktop.timeline.single['delivery'], 'confirmed');
        expect((desktop.timeline.single['content'] as List).first, {
          'type': 'image',
          'url': 'data:image/jpeg;base64,YQ==',
        });
        desktop.dispose();
      },
    );
  }
  test(
    'explicit input rejections fall back once per encoding without dropping images',
    () async {
      final transport = MixedTransport(PairingRepository(TestCredentials()))
        ..responses.addAll([
          const RemoteRpcException(
            -32602,
            'Missing input image_url field',
            null,
          ),
          const RemoteRpcException(
            -32602,
            'Unsupported input item type skill',
            null,
          ),
          const RemoteRpcException(
            -32602,
            'Unknown input item type mention',
            null,
          ),
        ]);
      final desktop = setup(transport);
      expect(await desktop.sendDraft(mixed()), isTrue);
      expect(transport.calls, hasLength(4));
      expect((transport.calls.last['params'] as Map)['input'], [
        {'type': 'image', 'image_url': 'data:image/jpeg;base64,YQ=='},
        {'type': 'text', 'text': 'inspect\n\n\$review @drive @lib/a.dart'},
      ]);
      desktop.dispose();
    },
  );
  for (final failure in [
    TimeoutException('Reply lost'),
    StateError('Disconnected'),
    const RemoteRpcException(
      -32000,
      'invalid input skill after mutation',
      null,
    ),
    const RemoteRpcException(-32602, 'invalid model', null),
  ]) {
    test(
      'uncertain or unrelated failure never retries mixed send: ${failure.runtimeType} $failure',
      () async {
        final transport = MixedTransport(PairingRepository(TestCredentials()))
          ..responses.add(failure);
        final desktop = setup(transport);
        desktop.threadList.data.setComposerDraft('t1', mixed());
        expect(await desktop.sendDraft(mixed()), isFalse);
        expect(transport.calls, hasLength(1));
        expect(
          desktop.threadList.data.composerDraft('t1').images,
          hasLength(1),
        );
        desktop.dispose();
      },
    );
  }
  test(
    'applied runtime uncertainty never retries the mixed mutation',
    () async {
      final transport = MixedTransport(PairingRepository(TestCredentials()))
        ..responses.add({'runtimeMode': 'full-access'});
      final desktop = setup(transport);
      expect(await desktop.sendDraft(mixed()), isFalse);
      expect(transport.calls, hasLength(1));
      desktop.dispose();
    },
  );
  test(
    'successful send clears only sent snapshot while retaining edits made during send',
    () async {
      final gate = Completer<RemoteJson>();
      final transport = MixedTransport(PairingRepository(TestCredentials()))
        ..responses.add(gate);
      final desktop = setup(transport);
      final sent = mixed();
      desktop.threadList.data.setComposerDraft('t1', sent);
      final sending = desktop.sendDraft(sent);
      await Future<void>.delayed(Duration.zero);
      desktop.threadList.data.setComposerDraft(
        't1',
        sent.copyWith(
          text: 'next draft',
          images: [
            ...sent.images,
            const DesktopComposerImage(
              id: 'new',
              name: 'new.jpg',
              dataUrl: 'data:image/jpeg;base64,Yg==',
            ),
          ],
        ),
      );
      gate.complete({
        'turn': {'id': 'turn-1'},
      });
      expect(await sending, isTrue);
      final saved = desktop.threadList.data.composerDraft('t1');
      expect(saved.text, 'next draft');
      expect(saved.images.map((v) => v.id), ['new']);
      expect(saved.contexts, isEmpty);
      desktop.dispose();
    },
  );
  test('late send response cannot change the newly selected chat', () async {
    final gate = Completer<RemoteJson>();
    final transport = MixedTransport(PairingRepository(TestCredentials()))
      ..responses.add(gate);
    final desktop = setup(transport);
    final sending = desktop.sendDraft(mixed());
    await Future<void>.delayed(Duration.zero);
    desktop.thread = {'id': 'other'};
    desktop.timeline = [
      {'id': 'other-message', 'text': 'other'},
    ];
    desktop.turnId = null;
    gate.complete({
      'turn': {'id': 'old-turn'},
    });
    await sending;
    expect(desktop.turnId, isNull);
    expect(desktop.timeline.single['id'], 'other-message');
    desktop.dispose();
  });
  test(
    'mixed echo without structured items replaces optimistic bubble and retains confirmed file context',
    () async {
      final transport = MixedTransport(PairingRepository(TestCredentials()));
      final desktop = setup(transport);
      await desktop.sendDraft(mixed());
      transport.events.add({
        'method': 'item/started',
        'params': {
          'threadId': 't1',
          'turnId': 'turn-1',
          'item': {
            'id': 'canonical',
            'type': 'userMessage',
            'content': [
              {'type': 'image', 'path': '/desktop/image.jpg'},
              {
                'type': 'text',
                'text': 'inspect\n\n\$review @drive @lib/a.dart',
              },
            ],
          },
        },
      });
      expect(desktop.timeline, hasLength(1));
      expect(desktop.timeline.single['fileMentions'], ['lib/a.dart']);
      expect(
        (desktop.timeline.single['content'] as List).first['_previewUrl'],
        'data:image/jpeg;base64,YQ==',
      );
      desktop.dispose();
    },
  );
  test(
    'encoding fallback retains the originally selected runtime snapshot',
    () async {
      final gate = Completer<RemoteJson>();
      final transport = MixedTransport(PairingRepository(TestCredentials()))
        ..responses.add(gate);
      final desktop = setup(transport);
      final pending = desktop.sendDraft(mixed());
      await Future<void>.delayed(Duration.zero);
      desktop.access = 'full-access';
      gate.completeError(
        const RemoteRpcException(-32602, 'Unsupported input type skill', null),
      );
      expect(await pending, isTrue);
      expect(
        (transport.calls.last['params'] as Map)['approvalPolicy'],
        'on-request',
      );
      desktop.dispose();
    },
  );
  test(
    'a new chat retains the complete source draft when the first turn fails',
    () async {
      final transport = NewChatTransport(PairingRepository(TestCredentials()))
        ..responses.add(TimeoutException('Reply lost'));
      final desktop =
          DesktopController(
              transport.pairings,
              connection: transport,
              localStore: RecoveryMemoryStore(),
            )
            ..active = const Pairing({'macDeviceId': 'mac-a'})
            ..model = 'qa';
      await desktop.threadList.attach('mac-a');
      expect(await desktop.sendDraft(mixed()), isFalse);
      expect(
        desktop.threadList.data.composerDraft('created').images,
        hasLength(1),
      );
      expect(
        desktop.threadList.data.composerDraft('created').text,
        '  inspect  ',
      );
      desktop.dispose();
    },
  );
  test(
    'a draft bound to another project cannot send its relative file context',
    () async {
      final transport = MixedTransport(PairingRepository(TestCredentials()));
      final desktop = setup(transport)..thread = {'id': 't1', 'cwd': '/new'};
      final draft = DesktopComposerDraft.fromJson({
        ...mixed().toJson(),
        'cwd': '/old',
      });
      expect(await desktop.sendDraft(draft), isFalse);
      expect(transport.calls, isEmpty);
      desktop.dispose();
    },
  );
  test(
    'server echoes distinguish image-only optimistic rows by image source',
    () async {
      final transport = MixedTransport(PairingRepository(TestCredentials()));
      final desktop = setup(transport);
      await desktop.sendDraft(DesktopComposerDraft(images: mixed().images));
      await desktop.sendDraft(
        DesktopComposerDraft(
          images: [
            const DesktopComposerImage(
              id: 'second',
              name: 'second.jpg',
              dataUrl: 'data:image/jpeg;base64,Yg==',
            ),
          ],
        ),
      );
      transport.events.add({
        'method': 'item/started',
        'params': {
          'threadId': 't1',
          'turnId': 'turn-1',
          'item': {
            'id': 'two-images',
            'type': 'userMessage',
            'content': [
              {'type': 'image', 'imageUrl': 'data:image/jpeg;base64,Yg=='},
            ],
          },
        },
      });
      expect(
        (desktop.timeline.first['content'] as List).first['url'],
        'data:image/jpeg;base64,YQ==',
      );
      expect(desktop.timeline.last['id'], 'two-images');
      desktop.dispose();
    },
  );
  test(
    'image-only and context-only snapshots can send and repeated explicit errors are bounded',
    () async {
      final transport = MixedTransport(PairingRepository(TestCredentials()));
      final desktop = setup(transport);
      expect(
        await desktop.sendDraft(DesktopComposerDraft(images: mixed().images)),
        isTrue,
      );
      expect(
        await desktop.sendDraft(
          DesktopComposerDraft(contexts: mixed().contexts),
        ),
        isTrue,
      );
      transport.calls.clear();
      transport.responses.addAll(
        List.filled(
          5,
          const RemoteRpcException(-32602, 'Missing input image_url', null),
        ),
      );
      expect(await desktop.sendDraft(mixed()), isFalse);
      expect(transport.calls, hasLength(2));
      expect(
        ((transport.calls.last['params'] as Map)['input'] as List)
            .first['type'],
        'image',
      );
      desktop.dispose();
    },
  );
}
