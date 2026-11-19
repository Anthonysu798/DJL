import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'desktop_composer_send_test.dart' show mixed;

void main() {
  test(
    'selected canonical file token is appended when prose only names a longer prefix-colliding path',
    () {
      final draft = DesktopComposerDraft(
        text: 'inspect @lib/a.dart.bak',
        contexts: [
          const DesktopComposerContext(
            kind: DesktopContextKind.file,
            id: 'lib/a.dart',
            name: 'a.dart',
            path: 'lib/a.dart',
          ),
        ],
      );
      expect(draft.input(), [
        {'type': 'text', 'text': 'inspect @lib/a.dart.bak\n\n@lib/a.dart'},
      ]);
    },
  );
  test(
    'canonical file token boundaries support exact spaced and quoted desktop paths',
    () {
      const context = DesktopComposerContext(
        kind: DesktopContextKind.file,
        id: 'my folder/a.dart',
        name: 'a.dart',
        path: 'my folder/a.dart',
      );
      expect(
        DesktopComposerDraft(
          text: 'inspect "@my folder/a.dart"',
          contexts: [context],
        ).input(),
        [
          {'type': 'text', 'text': 'inspect "@my folder/a.dart"'},
        ],
      );
      expect(
        DesktopComposerDraft(
          text: 'inspect @my folder/a.dart.bak',
          contexts: [context],
        ).input(),
        [
          {
            'type': 'text',
            'text': 'inspect @my folder/a.dart.bak\n\n@my folder/a.dart',
          },
        ],
      );
    },
  );

  test(
    'legacy text reuses explicit canonical tokens and slash skills without duplicating them',
    () {
      final draft = mixed(text: '  /review inspect @drive @lib/a.dart  ');
      expect(
        draft.input().where((p) => p['type'] == 'text').single['text'],
        '/review inspect @drive @lib/a.dart',
      );
      expect(draft.input(skills: false, plugins: false), [
        {'type': 'image', 'url': 'data:image/jpeg;base64,YQ=='},
        {'type': 'text', 'text': '/review inspect @drive @lib/a.dart'},
      ]);
    },
  );
  test(
    'a fifth image and incomplete file context fail before building a partial input',
    () {
      expect(
        () => DesktopComposerDraft(
          images: List.filled(5, mixed().images.first),
        ).input(),
        throwsFormatException,
      );
      expect(
        () => DesktopComposerDraft(
          contexts: [
            const DesktopComposerContext(
              kind: DesktopContextKind.file,
              id: 'bad',
              name: 'bad',
            ),
          ],
        ).input(),
        throwsFormatException,
      );
    },
  );
  test(
    'history accepts source image types and URL aliases including nested values',
    () {
      for (final key in ['url', 'image_url', 'imageUrl', 'path']) {
        expect(
          desktopImageSource({key: '/desktop/photo.jpg'}),
          '/desktop/photo.jpg',
        );
        expect(
          desktopImageSource({
            'source': {
              key: {'url': 'https://example.test/photo.jpg'},
            },
          }),
          'https://example.test/photo.jpg',
        );
      }
      for (final type in [
        'image',
        'localImage',
        'input_image',
        'output-image',
      ]) {
        expect(desktopIsImage({'type': type}), isTrue);
      }
      expect(desktopIsImage({'type': 'text'}), isFalse);
    },
  );
  test(
    'history retains inline payloads through the source 12000000-byte boundary and strips larger payloads',
    () {
      final atLimit = 'data:image/jpeg;base64,'.padRight(12000000, 'a');
      final saved = desktopHistoryItem({
        'content': [
          {'type': 'image', 'url': atLimit},
          {
            'type': 'image',
            'image_url': '${atLimit}a',
            'path': '/desktop/image.jpg',
          },
        ],
      });
      final parts = saved['content'] as List;
      expect((parts.first['url'] as String).length, 12000000);
      expect(parts.last['image_url'], isNull);
      expect(desktopImageSource(parts.last as Map), '/desktop/image.jpg');
    },
  );
}
