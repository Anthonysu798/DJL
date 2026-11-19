import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/support/native_advanced_acceptance.dart';

Map<String, Object> snapshot(
  List<Map<String, Object>> requests, {
  int? sequence,
}) => {'requests': requests, 'requestSequence': sequence ?? requests.length};
void main() {
  test(
    'source snake-case child rename trace fails passive native acceptance',
    () async {
      final result = await Process.run('bun', [
        '--eval',
        '''
import {createRuntimeFixture} from './integration_test/support/desktop_runtime_fixture.ts';
const fixture=createRuntimeFixture('/tmp/disposable-mobile-qa',()=>{});
fixture.handle({id:1,method:'thread/read',params:{threadId:'native-thread-1',includeTurns:true}});
fixture.handle({id:2,method:'thread/name/set',params:{thread_id:'native-thread-1',name:'Disposable child rename'}});
console.log(JSON.stringify(fixture.state()));
''',
      ]);
      expect(result.exitCode, 0, reason: result.stderr as String);
      final trace = jsonDecode(result.stdout as String) as Map;
      expect(
        passiveChildReadOnly(
          trace,
          childId: 'native-thread-1',
          afterSequence: 0,
        ),
        false,
      );
    },
  );

  test(
    'passive discovery requires actual child history read while parent activity is unrelated',
    () {
      expect(
        passiveChildReadOnly(
          snapshot([
            {'sequence': 1, 'method': 'turn/start', 'threadId': 'parent'},
            {
              'sequence': 2,
              'method': 'thread/read',
              'threadId': 'child',
              'includeTurns': true,
            },
            {'sequence': 3, 'method': 'thread/goal/get', 'threadId': 'child'},
          ]),
          childId: 'child',
          afterSequence: 0,
        ),
        true,
      );
    },
  );
  test('only unrelated parent reads cannot satisfy child discovery', () {
    expect(
      passiveChildReadOnly(
        snapshot([
          {
            'sequence': 1,
            'method': 'thread/read',
            'threadId': 'parent',
            'includeTurns': true,
          },
        ]),
        childId: 'child',
        afterSequence: 0,
      ),
      false,
    );
  });
  test(
    'parent completion reload is allowed but cannot hide child mutations',
    () {
      final reads = <Map<String, Object>>[
        {'sequence': 1, 'method': 'thread/resume', 'threadId': 'parent'},
        {
          'sequence': 2,
          'method': 'thread/read',
          'threadId': 'child',
          'includeTurns': true,
        },
        {
          'sequence': 3,
          'method': 'thread/read',
          'threadId': 'parent',
          'includeTurns': true,
        },
      ];
      expect(
        passiveChildReadOnly(
          snapshot(reads),
          childId: 'child',
          afterSequence: 0,
        ),
        true,
      );
      for (final method in ['thread/resume', 'djl/thread/runtimeMode/set']) {
        expect(
          passiveChildReadOnly(
            snapshot([
              ...reads,
              {'sequence': 4, 'method': method, 'threadId': 'child'},
            ]),
            childId: 'child',
            afterSequence: 0,
          ),
          false,
        );
      }
    },
  );
  for (final method in [
    'djl/thread/runtimeMode/set',
    'thread/resume',
    'turn/start',
    'thread/goal/set',
  ]) {
    test(
      'passive child $method mutation is rejected despite a successful child read',
      () {
        expect(
          passiveChildReadOnly(
            snapshot([
              {
                'sequence': 1,
                'method': 'thread/read',
                'threadId': 'child',
                'includeTurns': true,
              },
              {'sequence': 2, 'method': method, 'threadId': 'child'},
            ]),
            childId: 'child',
            afterSequence: 0,
          ),
          false,
        );
      },
    );
  }
  test('child read must include history in the current passive window', () {
    expect(
      passiveChildReadOnly(
        snapshot([
          {
            'sequence': 1,
            'method': 'thread/read',
            'threadId': 'child',
            'includeTurns': true,
          },
          {
            'sequence': 2,
            'method': 'thread/read',
            'threadId': 'parent',
            'includeTurns': true,
          },
        ]),
        childId: 'child',
        afterSequence: 1,
      ),
      false,
    );
    expect(
      passiveChildReadOnly(
        snapshot([
          {
            'sequence': 1,
            'method': 'thread/read',
            'threadId': 'child',
            'includeTurns': false,
          },
        ]),
        childId: 'child',
        afterSequence: 0,
      ),
      false,
    );
  });
  test(
    'bounded request oracle cannot hide a missing passive-window mutation',
    () {
      expect(
        passiveChildReadOnly(
          snapshot([
            {
              'sequence': 2,
              'method': 'thread/read',
              'threadId': 'child',
              'includeTurns': true,
            },
          ], sequence: 2),
          childId: 'child',
          afterSequence: 0,
        ),
        false,
      );
    },
  );
}
