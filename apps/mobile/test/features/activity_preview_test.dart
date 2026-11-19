import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/activity/domain/activity_preview.dart';

void main() {
  test(
    'resolved paths retain existing normalization and reject decoded wildcards',
    () {
      expect(activityWorkspacePath('image%252A.png', cwd: '/repo'), isNull);
      expect(
        activityWorkspacePath('caf%25C3%25A9.png', cwd: '/repo'),
        '/repo/café.png',
      );
      expect(
        activityWorkspacePath('%252E%252E/image.png', cwd: '/repo'),
        '/image.png',
      );
      expect(activityWorkspacePath('👩‍💻.png'), isNull);
      expect(
        activityWorkspacePath('👩‍💻.png', cwd: 'relative-workspace'),
        isNull,
      );
    },
  );

  for (final (command, output, cwd, expected) in [
    (
      'python render.py',
      '![Result](/tmp/chart.png)',
      '/repo',
      '/tmp/chart.png',
    ),
    ('echo', 'plot.png', '/repo', '/repo/plot.png'),
    ('echo', 'Saved: /tmp/chart.png', '/repo', '/tmp/chart.png'),
    ('echo', 'path=/tmp/chart.png done', '/repo', '/tmp/chart.png'),
    ('echo', "Saved '/tmp/chart.png' successfully", '/repo', '/tmp/chart.png'),
    ('echo', '[Result](/tmp/chart.png)', '/repo', '/tmp/chart.png'),
    ('echo', 'café.png', '/repo', '/repo/café.png'),
    ('echo', '👩‍💻.png', '/repo', '/repo/👩‍💻.png'),
    (
      'echo',
      '%F0%9F%91%A9%E2%80%8D%F0%9F%92%BB.png',
      '/repo',
      '/repo/👩‍💻.png',
    ),
    ('echo', 'file:///repo/caf%C3%A9.png', '/repo', '/repo/café.png'),
    ('cat "/repo/👩‍💻.png"', '', '/repo', '/repo/👩‍💻.png'),
    ('ls images', 'chart.png', '/repo', '/repo/images/chart.png'),
    (
      '/bin/zsh -lc "ls /tmp/images"',
      'chart.png',
      '/repo',
      '/tmp/images/chart.png',
    ),
    ('open "/tmp/My Image.png"', '', '/repo', '/tmp/My Image.png'),
    ('echo', 'file:///tmp/chart%20one.png', '/repo', '/tmp/chart one.png'),
  ]) {
    test('source local image reference resolves $command / $output', () {
      expect(
        activityImageReference(command: command, outputTail: output, cwd: cwd),
        expected,
      );
    });
  }
  for (final output in [
    'https://example.com/image.png',
    '![Remote](https://example.com/image.png)',
    '//example.com/image.png',
    'file://other-host/image.png',
    'data:image/png;base64,abc',
    '*.png',
    'image%2A.png',
    'image?.png',
    'bad%ZZ.png',
    'bad%.png',
    '%00.png',
    '%2F%2Fother-host/image.png',
    'file%3A%2F%2Fother-host/image.png',
    'https%3A%2F%2Fexample.com/👩‍💻.png',
    'https%3A//example.com/image.png',
    'file%3A//other-host/image.png',
    'https://example.com%2Fimage.png',
    '![Remote](https%3A%2F%2Fexample.com/image.png)',
    '👩‍💻%2A.png',
  ]) {
    test(
      'external or wildcard output is never a workspace image reference: $output',
      () {
        expect(
          activityImageReference(
            command: 'echo',
            outputTail: output,
            cwd: '/repo',
          ),
          isNull,
        );
      },
    );
  }
  test(
    'preview shortens shell wrapping without changing detail command and keeps the trailing argument',
    () {
      expect(activityCommandPreview('/bin/zsh -lc "echo one"'), 'echo one');
      expect(
        activityCommandPreview(
          'prefix ${List.filled(100, 'x').join()} final-target.txt',
        ).endsWith('final-target.txt'),
        true,
      );
      expect(activityWorkspacePath('relative.txt'), isNull);
    },
  );
}
