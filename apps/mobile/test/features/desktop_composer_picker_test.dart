import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_controller.dart';

class PendingImagePicker extends DesktopComposerImagePicker {
  final jobs = <Completer<DesktopComposerImage?>>[];
  final sources = <bool>[];
  @override
  Future<DesktopComposerImage?> pick({bool camera = false}) {
    sources.add(camera);
    final job = Completer<DesktopComposerImage?>();
    jobs.add(job);
    return job.future;
  }
}

const scope = (mac: 'mac-a', thread: 't1', cwd: '/repo');
DesktopComposerImage photo(String id) => DesktopComposerImage(
  id: id,
  name: '$id.jpg',
  dataUrl: 'data:image/jpeg;base64,YQ==',
);

void main() {
  for (final message in ['The user did not allow camera access.', null]) {
    test(
      'native picker denial is readable without losing text: $message',
      () async {
        final picker = PendingImagePicker();
        final composer = DesktopComposerController(picker: picker)
          ..bind(scope, DesktopComposerDraft(text: 'Keep this unsent draft'));
        addTearDown(composer.dispose);
        final pending = composer.pickImage(camera: true);
        picker.jobs.single.completeError(
          PlatformException(code: 'camera_access_denied', message: message),
        );
        await pending;
        expect(
          composer.slots.single.error,
          message ?? 'Could not open the picker. Please try again.',
        );
        expect(composer.draft.images, isEmpty);
        expect(composer.draft.text, 'Keep this unsent draft');
        expect(composer.canSend, isFalse);
        composer.removeImage(composer.slots.single.id);
        expect(composer.canSend, isTrue);
        expect(composer.draft.text, 'Keep this unsent draft');
      },
    );
  }

  test(
    'four slots includes loading work and removal cannot resurrect a late image',
    () async {
      final picker = PendingImagePicker();
      final state = DesktopComposerController(picker: picker)
        ..bind(scope, DesktopComposerDraft());
      final jobs = [
        for (var i = 0; i < 4; i++) state.pickImage(camera: i == 0),
      ];
      expect(state.slots, hasLength(4));
      expect(state.canSend, isFalse);
      await state.pickImage();
      expect(picker.jobs, hasLength(4));
      state.removeImage(state.slots.first.id);
      for (var i = 0; i < 4; i++) {
        picker.jobs[i].complete(photo('image-$i'));
      }
      await Future.wait(jobs);
      expect(state.draft.images.map((v) => v.id), [
        'image-1',
        'image-2',
        'image-3',
      ]);
      expect(state.canSend, isTrue);
      expect(picker.sources.first, isTrue);
      state.dispose();
    },
  );
  test(
    'cancel removes loading tile while failure blocks partial send until removed',
    () async {
      final picker = PendingImagePicker();
      final composer = DesktopComposerController(picker: picker)
        ..bind(scope, DesktopComposerDraft(text: 'keep'));
      final cancelled = composer.pickImage();
      picker.jobs.first.complete(null);
      await cancelled;
      expect(composer.slots, isEmpty);
      final failed = composer.pickImage(camera: true);
      picker.jobs.last.completeError(StateError('Camera permission denied'));
      await failed;
      expect(composer.slots.single.error, contains('Camera permission denied'));
      expect(composer.canSend, isFalse);
      composer.removeImage(composer.slots.single.id);
      expect(composer.canSend, isTrue);
      expect(composer.draft.text, 'keep');
      composer.dispose();
    },
  );
  for (final next in [
    (mac: 'mac-b', thread: 't1', cwd: '/repo'),
    (mac: 'mac-a', thread: 't2', cwd: '/repo'),
    (mac: 'mac-a', thread: 't1', cwd: '/other'),
  ]) {
    test('late image cannot cross scope $next', () async {
      final picker = PendingImagePicker();
      final state = DesktopComposerController(picker: picker)
        ..bind(scope, DesktopComposerDraft());
      final pending = state.pickImage();
      state.bind(next, DesktopComposerDraft(text: 'destination draft'));
      picker.jobs.single.complete(photo('old-photo'));
      await pending;
      expect(state.draft.text, 'destination draft');
      expect(state.slots, isEmpty);
      state.dispose();
    });
  }
  test(
    'a restored context from an earlier project blocks send until removed',
    () {
      final state = DesktopComposerController()
        ..bind(
          scope,
          DesktopComposerDraft.fromJson({
            'text': 'keep',
            'cwd': '/old',
            'contexts': [
              {'kind': 'file', 'id': 'a', 'name': 'a', 'path': 'a.dart'},
            ],
          }),
        );
      expect(state.canSend, isFalse);
      expect(state.contextScopeError, isNotNull);
      state.removeContext(state.contexts.single.key);
      expect(state.canSend, isTrue);
      expect(state.draft.text, 'keep');
      state.dispose();
    },
  );
  test(
    'returning to the same scope cannot revive cancelled work and disposal ignores picker callbacks',
    () async {
      final picker = PendingImagePicker();
      final state = DesktopComposerController(picker: picker)
        ..bind(scope, DesktopComposerDraft());
      final pending = state.pickImage();
      state.bind((
        mac: 'mac-a',
        thread: 't2',
        cwd: '/repo',
      ), DesktopComposerDraft());
      state.bind(scope, DesktopComposerDraft());
      picker.jobs.single.complete(photo('old'));
      await pending;
      expect(state.slots, isEmpty);
      final disposed = state.pickImage();
      state.dispose();
      picker.jobs.last.complete(photo('after-dispose'));
      await disposed;
    },
  );
}
