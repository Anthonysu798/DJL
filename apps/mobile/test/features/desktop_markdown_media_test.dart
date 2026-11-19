import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_markdown_media.dart';

void main() {
  test(
    'local preview paths preserve workspace and bridge allowlist bounds',
    () {
      for (final entry in <String, String?>{
        'images/a%20b.png': '/repo/images/a b.png',
        'file:///repo/images/a.png': '/repo/images/a.png',
        '/repo/../repo/photo.JPG': '/repo/photo.JPG',
        '/tmp/shot.png': '/tmp/shot.png',
        '/private/var/folders/aa/bb/T/shot.heic':
            '/private/var/folders/aa/bb/T/shot.heic',
        '/home/mac/.codex/generated_images/a.webp':
            '/home/mac/.codex/generated_images/a.webp',
        '/repo-other/a.png': null,
        '../outside.png': null,
        '/tmp/../../outside.png': null,
        'https://example.test/a.png': null,
        'file://other-host/repo/a.png': null,
        'a.svg': null,
        '*.png': null,
        'a\u0000.png': null,
      }.entries) {
        expect(
          desktopMarkdownImagePath(entry.key, cwd: '/repo'),
          entry.value,
          reason: entry.key,
        );
      }
    },
  );

  test(
    'generated previews follow prose while screenshots keep authored syntax',
    () {
      const text =
          'Before\n\n![Shot](/tmp/shot.png)\n\nBetween\n\n![Made](/home/mac/.codex/generated_images/a.png)\n\nAfter';
      final result = desktopMarkdownMedia(text, cwd: '/repo');
      expect(
        result.markdown,
        'Before\n\n![Shot](/tmp/shot.png)\n\nBetween\n\n\nAfter',
      );
      expect(result.images, [
        (path: '/home/mac/.codex/generated_images/a.png', alt: 'Made'),
      ]);
    },
  );

  test(
    'mixed prose retains image alt or filename and authored duplicate previews',
    () {
      final result = desktopMarkdownMedia(
        'See ![Diagram](a.png) and ![](b.png).\n![Again](a.png)',
        cwd: '/repo',
      );
      expect(result.markdown, 'See Diagram and b.png.');
      expect(result.images, [
        (path: '/repo/a.png', alt: 'Diagram'),
        (path: '/repo/b.png', alt: ''),
        (path: '/repo/a.png', alt: 'Again'),
      ]);
    },
  );

  test('fenced, indented, inline and escaped image examples remain literal', () {
    const text =
        '```text\n![One](a.png)\n```\n~~~md\n![Two](b.png)\n~~~\n````md\n```\n![Three](c.png)\n````\n    ![Four](d.png)\n`![Five](e.png)`\n\\![Six](f.png)\n![Outside](/outside.png)';
    final result = desktopMarkdownMedia(text, cwd: '/repo');
    expect(result.markdown, text);
    expect(result.images, isEmpty);
  });

  test('large Unicode content stays intact before media extraction work', () {
    final text = '${'😀' * 16000}\n![Result](a.png)';
    final result = desktopMarkdownMedia(text, cwd: '/repo');
    expect(result.markdown, text);
    expect(result.images, isEmpty);
  });
}
