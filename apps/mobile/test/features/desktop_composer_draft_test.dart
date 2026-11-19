import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';

void main() {
  test(
    'mixed draft survives local-state serialization without restoring approvals',
    () {
      final state = ThreadLocalState.fromJson({
        'drafts': {'t1': 'draft'},
        'composerDrafts': {
          't1': {
            'text': 'draft',
            'images': [
              {
                'id': 'image-a',
                'name': 'photo.jpg',
                'dataUrl': 'data:image/jpeg;base64,YQ==',
              },
            ],
            'contexts': [
              {
                'kind': 'file',
                'id': 'lib/a.dart',
                'name': 'a.dart',
                'path': 'lib/a.dart',
              },
            ],
          },
        },
        'approvals': [
          {'id': 'old-authority'},
        ],
      });
      expect(state.toJson()['composerDrafts'], {
        't1': {
          'text': 'draft',
          'images': [
            {
              'id': 'image-a',
              'name': 'photo.jpg',
              'dataUrl': 'data:image/jpeg;base64,YQ==',
            },
          ],
          'contexts': [
            {
              'kind': 'file',
              'id': 'lib/a.dart',
              'name': 'a.dart',
              'path': 'lib/a.dart',
            },
          ],
        },
      });
      expect(state.approvals, isEmpty);
      state.remove('t1');
      expect((state.toJson()['composerDrafts'] as Map), isEmpty);
    },
  );
}
