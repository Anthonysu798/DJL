import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/root_route.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';

void main() {
  test(
    'status qualifiers are paired unique case-insensitive and part of target identity',
    () {
      final hash = 'a' * 64;
      final uri = DesktopLinkTarget.statusUri('same thread', 'mac-a', hash)!;
      final a = DesktopLinkTarget.parse(uri)!;
      expect(a.macId, 'mac-a');
      expect(a.macKeySha256, hash);
      expect(a.thread, 'same thread');
      expect(
        a,
        isNot(
          DesktopLinkTarget.parse(
            Uri.parse(uri.toString().replaceAll('mac-a', 'mac-b')),
          ),
        ),
      );
      expect(a, isNot(const DesktopLinkTarget('same thread')));
      for (final query in [
        'macId=a',
        'macKeySha256=$hash',
        'macId=a&macKeySha256=wrong',
        'macId=a&macId=a&macKeySha256=$hash',
        'macId=a&MACID=b&macKeySha256=$hash',
        'macId=a&macKeySha256=$hash&MACKEYSHA256=$hash',
        'macId=a%2Fb&macKeySha256=$hash',
        'macId=a&macKeySha256=${'A' * 64}',
      ]) {
        expect(
          DesktopLinkTarget.parse(Uri.parse('djl://thread/t?$query')),
          isNull,
          reason: query,
        );
      }
      expect(DesktopLinkTarget.statusUri('bad/id', 'mac-a', hash), isNull);
      expect(DesktopLinkTarget.keyFingerprint('not-a-key'), isNull);
    },
  );
  test('desktop routing stays independent of the Cloud session', () {
    for (final signed in [false, true]) {
      expect(
        resolveRootRoute(AppSection.myMacs, signedIn: signed),
        RootRoute.myMacs,
      );
      expect(
        resolveRootRoute(AppSection.cloud, signedIn: signed),
        signed ? RootRoute.cloud : RootRoute.welcome,
      );
    }
  });
  test(
    'desktop parser preserves aliases, first query order, and one decode',
    () {
      for (final path in [
        'djl://thread/',
        'djl://threads/',
        'djl:/thread/',
        'djl:///threads/',
      ]) {
        final target = DesktopLinkTarget.parse(
          Uri.parse(
            '${path}thread%201?TURN=x&turnId=y&ITEM=i&MESSAGE=m&thread=ignored',
          ),
        )!;
        expect(target.thread, 'thread 1');
        expect(target.turn, 'x');
        expect(target.item, 'i');
        expect(target.message, 'm');
      }
      expect(
        DesktopLinkTarget.parse(Uri.parse('djl://thread?THREAD=t'))?.thread,
        't',
      );
      expect(
        DesktopLinkTarget.parse(Uri.parse('djl://thread/a%2520b'))?.thread,
        'a%20b',
      );
    },
  );
  test(
    'desktop parser does not steal other owners or accept path injection',
    () {
      for (final uri in [
        'https://thread/a',
        'phodex://thread/a',
        'djl://cloud/c/a?thread=t',
        'djl://auth/gpt/callback?thread=t',
        'djl://relay?thread=t',
        'djl://user@thread/a',
        'djl://thread:23/a',
        'djl://thread/a#x',
        'djl://thread/a/b',
        'djl://thread/a%2Fb',
        'djl://thread/a%5Cb',
        'djl://thread/a%00b',
        'djl://thread?thread=%20',
        'djl:/unknown?thread=t',
        'djl://thread/a?item=a%2Fb',
        'djl://thread/a?turn=a%00b',
      ]) {
        expect(DesktopLinkTarget.parse(Uri.parse(uri)), isNull, reason: uri);
      }
    },
  );
  test('focus picks exact message then last item then last turn', () {
    final rows = <Map<String, dynamic>>[
      {'id': 'm1', 'itemId': 'i', 'turnId': 't'},
      {'id': 'm2', 'sourceItemKey': 'i', 'turnId': 't'},
      {'id': 'm3', 'turnId': 't'},
    ];
    expect(
      const DesktopLinkTarget(
        'thread',
        message: 'm1',
        item: 'i',
        turn: 't',
      ).focusIndex(rows),
      0,
    );
    expect(
      const DesktopLinkTarget(
        'thread',
        message: 'missing',
        item: 'i',
        turn: 't',
      ).focusIndex(rows),
      1,
    );
    expect(
      const DesktopLinkTarget(
        'thread',
        item: 'missing',
        turn: 't',
      ).focusIndex(rows),
      2,
    );
    expect(
      const DesktopLinkTarget('thread', message: 'missing').focusIndex(rows),
      isNull,
    );
  });
}
