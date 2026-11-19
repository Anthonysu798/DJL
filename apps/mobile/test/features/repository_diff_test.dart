import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/git/domain/repository_diff.dart';

void main() {
  test('repository diff groups files and counts body rows, not metadata', () {
    final diff = RepositoryDiff.parse('''diff --git a/src/a.dart b/src/a.dart
--- a/src/a.dart
+++ b/src/a.dart
@@ -4,2 +4,3 @@
 same
-old
+new
+extra
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -9 +0,0 @@
-gone
''');
    expect(diff.files.map((file) => file.path), ['src/a.dart', 'old.txt']);
    expect(diff.additions, 2);
    expect(diff.deletions, 2);
    final first = diff.files.first.hunks.single;
    expect(first.label, 'Lines 4-6');
    expect(first.lines.map((line) => line.oldNumber), [4, 5, null, null]);
    expect(first.lines.map((line) => line.newNumber), [4, null, 5, 6]);
    expect(first.lines.map((line) => line.text), [
      'same',
      'old',
      'new',
      'extra',
    ]);
    expect(first.lines.map((line) => line.kind), [
      GitDiffLineKind.context,
      GitDiffLineKind.deletion,
      GitDiffLineKind.addition,
      GitDiffLineKind.addition,
    ]);
    expect(diff.files.last.hunks.single.label, 'Line 9');
  });

  test('hunk label follows actual numbered content rather than odd counts', () {
    final diff = RepositoryDiff.parse('''diff --git a/a b/a
--- a/a
+++ b/a
@@ -12,99 +40,80 @@
 unchanged
+added
@@ -100 +140 @@
-before
+after
''');
    expect(diff.files.single.hunks.map((hunk) => hunk.label), [
      'Lines 40-41',
      'Line 140',
    ]);
  });

  test('synthetic history rows use Patch and preserve code whitespace', () {
    final diff = RepositoryDiff.parse(
      '''diff --git a/space name.txt b/space name.txt
--- a/space name.txt
+++ b/space name.txt
-  old  
+  new  
\\ No newline at end of file
''',
    );
    final file = diff.files.single;
    expect(file.path, 'space name.txt');
    expect(file.hunks.single.label, 'Patch');
    expect(file.hunks.single.lines.map((line) => line.text), [
      '  old  ',
      '  new  ',
    ]);
    expect(file.additions, 1);
    expect(file.deletions, 1);
  });

  test('metadata-only and binary files retain exact raw fallback', () {
    const patch = '''diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
diff --git a/icon.png b/icon.png
index 123..456 100644
Binary files a/icon.png and b/icon.png differ
''';
    final diff = RepositoryDiff.parse(patch);
    expect(diff.files.map((file) => file.path), ['new.txt', 'icon.png']);
    expect(diff.files.every((file) => file.hunks.isEmpty), isTrue);
    expect(diff.additions, 0);
    expect(diff.deletions, 0);
    expect(diff.files.first.rawPatch, contains('rename from old.txt'));
    expect(diff.files.last.rawPatch, contains('Binary files'));
    expect(diff.rawPatch, patch);
  });

  test('unidentified patch keeps raw text without inventing a filename', () {
    const patch = 'unstructured patch\n+ text  \n';
    final diff = RepositoryDiff.parse(patch);
    expect(diff.files, isEmpty);
    expect(diff.rawPatch, patch);
    expect(RepositoryDiff.parse(' \n').files, isEmpty);
  });

  test('CRLF parsing keeps exact raw patch and unescaped display path', () {
    const patch =
        'diff --git a/中文.txt b/中文.txt\r\n'
        '--- a/中文.txt\r\n+++ b/中文.txt\r\n@@ -0,0 +1 @@\r\n+内容\r\n';
    final diff = RepositoryDiff.parse(patch);
    expect(diff.rawPatch, patch);
    expect(diff.files.single.path, '中文.txt');
    expect(diff.files.single.hunks.single.lines.single.text, '内容');
    expect(diff.files.single.hunks.single.lines.single.newNumber, 1);
  });

  test('binary payload is raw data rather than synthetic source lines', () {
    const patch =
        'diff --git a/blob b/blob\nGIT binary patch\nliteral 5\n+opaque payload\n';
    final diff = RepositoryDiff.parse(patch);
    expect(diff.files.single.hunks, isEmpty);
    expect(diff.additions, 0);
    expect(diff.files.single.rawPatch, patch);
  });

  test(
    'out-of-range hunk numbers fall back without throwing or inventing a range',
    () {
      final diff = RepositoryDiff.parse(
        'diff --git a/a b/a\n'
        '@@ -999999999999999999999999999999 +1 @@\n+source\n',
      );
      expect(diff.files.single.hunks.single.label, 'Patch');
      expect(diff.files.single.hunks.single.lines.single.text, 'source');
    },
  );

  test('header-like source text inside a hunk is not metadata', () {
    final diff = RepositoryDiff.parse(
      'diff --git a/a b/a\n--- a/a\n+++ b/a\n'
      '@@ -1 +1 @@\n--- removed source\n+++ added source\n',
    );
    expect(diff.files.single.hunks.single.lines.map((line) => line.text), [
      '-- removed source',
      '++ added source',
    ]);
    expect(diff.additions, 1);
    expect(diff.deletions, 1);
    final headerOnly = RepositoryDiff.parse(
      'diff --git a/a b/a\n'
      '@@ -1 +1 @@\n--- removed source\n+++ added source\n',
    );
    expect(headerOnly.files.single.path, 'a');
  });

  test('an unidentified file chunk falls back to the complete raw patch', () {
    const patch =
        'diff --git a/known b/known\n@@ -0,0 +1 @@\n+known\n'
        'diff --git unidentified\nBinary files have changed\n';
    final diff = RepositoryDiff.parse(patch);
    expect(diff.files, isEmpty);
    expect(diff.rawPatch, patch);
  });
}
