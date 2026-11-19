import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'cloud_model_catalog_test.dart' show CatalogFixture;

void main() {
  for (final cold in [false, true]) {
    test(
      'selected model survives a ${cold ? 'cold repository' : 'new chat'} without sending',
      () async {
        final fixture = CatalogFixture();
        addTearDown(fixture.close);
        await fixture.chat.initialize();
        fixture.chat.setModel('text');
        await Future<void>.delayed(Duration.zero);
        final next = ChatController(
          cold ? CloudRepository(fixture.client) : fixture.chat.repository,
          accountScope: 'u:o',
        );
        addTearDown(next.dispose);
        await next.initialize();
        expect(next.model, 'text');
        expect(fixture.mutations, 0);
      },
    );
  }
  test(
    'unavailable saved model normalizes to the first selectable chat model',
    () async {
      final fixture = CatalogFixture();
      addTearDown(fixture.close);
      await fixture.client.credentials.write(
        'djl.cloud.selectedModelID',
        'embed',
      );
      await fixture.chat.initialize();
      expect(fixture.chat.model, 'preview');
      expect(
        await fixture.client.credentials.read('djl.cloud.selectedModelID'),
        'preview',
      );
      expect(fixture.mutations, 0);
    },
  );
}
