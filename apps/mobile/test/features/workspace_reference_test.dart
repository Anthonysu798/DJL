import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/workspace/domain/workspace_reference.dart';

void main() {
  test('workspace links retain decoded file paths and omit line suffixes', () {
    expect(
      workspaceReference('file:///repo/My%20File.dart#L12')?.path,
      '/repo/My File.dart',
    );
    expect(workspaceReference('/repo/a.dart:12:3')?.path, '/repo/a.dart');
    expect(workspaceReference('preview.SVG')?.image, isTrue);
    expect(workspaceReference('hello.dart:12')?.path, 'hello.dart');
    expect(
      workspaceReference('file:///repo/100%25.txt')?.path,
      '/repo/100%.txt',
    );
    expect(workspaceReference('https://example.com/a.png'), isNull);
    expect(workspaceReference('file://another-host/file'), isNull);
    expect(workspaceReference('#L2'), isNull);
  });
}
