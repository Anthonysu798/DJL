import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/guardian/domain/guardian_review.dart';
import 'package:djl_mobile/features/guardian/domain/guardian_reviews.dart';

void main() {
  test(
    'native fixture grants one retry through the real Guardian decoder',
    () async {
      final result = await Process.run('bun', [
        '--eval',
        r'''
import {createRuntimeFixture} from './integration_test/support/desktop_runtime_fixture.ts';
const messages=[];
const fixture=createRuntimeFixture('/tmp/disposable-mobile-qa',m=>messages.push(m));
fixture.handle({id:1,method:'turn/start',params:{threadId:'native-thread-1',input:[{type:'text',text:'[advanced] decoder acceptance'}]}});
await Bun.sleep(180);
console.log(JSON.stringify(messages.filter(m=>m.method?.startsWith('item/autoApprovalReview/'))));
''',
      ]);
      expect(result.exitCode, 0, reason: result.stderr.toString());
      final events = (jsonDecode(result.stdout as String) as List).cast<Map>();
      final reviews = GuardianReviews()..bind('fixture-mac', 'fixture-session');
      for (final event in events) {
        final params = Map<String, dynamic>.from(event['params'] as Map);
        final review = GuardianReview.decode(params);
        expect(review, isNotNull);
        reviews.upsert(params['threadId'] as String, review!, live: true);
      }
      final denied = reviews.reviews.values.single;
      expect(denied.retryUnavailableReason, isNull);
      final grant = reviews.consume(
        'native-thread-1',
        denied.reviewId,
        'fixture-mac',
        'fixture-session',
      );
      expect(grant, isNotNull);
      expect(grant!['action'], {
        'type': 'command',
        'source': 'unified_exec',
        'command': 'echo QA_RETRY',
        'cwd': '/tmp/disposable-mobile-qa',
      });
      expect(
        reviews.consume(
          'native-thread-1',
          denied.reviewId,
          'fixture-mac',
          'fixture-session',
        ),
        isNull,
      );
    },
  );
}
