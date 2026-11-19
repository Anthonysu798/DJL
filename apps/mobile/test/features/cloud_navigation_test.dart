import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/cloud_navigation.dart';

void main() {
  test(
    'Cloud destinations preserve selection without manufacturing a new presentation',
    () {
      final nav = CloudNavigationController();
      addTearDown(nav.dispose);
      nav.bindOwner('session-a:user:org');
      expect(nav.destination, CloudDestination.chat);
      expect(nav.open('c1'), true);
      final presentation = nav.presentation;
      nav.show(CloudDestination.settings);
      expect(nav.conversationId, 'c1');
      expect(nav.visibleConversationId, isNull);
      nav.show(CloudDestination.chat);
      expect(nav.visibleConversationId, 'c1');
      nav.open('c1');
      expect(nav.presentation, presentation);
      nav.newChat();
      expect(nav.conversationId, isNull);
      expect(nav.presentation, greaterThan(presentation));
    },
  );
  test(
    'Late conversation acknowledgements cannot overwrite a new page or owner',
    () {
      final nav = CloudNavigationController();
      addTearDown(nav.dispose);
      nav.bindOwner('a');
      final old = nav.presentation;
      nav.open('next');
      expect(nav.acknowledge('late', owner: 'a', presentation: old), false);
      expect(nav.conversationId, 'next');
      final current = nav.presentation;
      nav.show(CloudDestination.images);
      expect(
        nav.acknowledge('hidden', owner: 'a', presentation: current),
        false,
      );
      nav.bindOwner('b');
      expect(nav.conversationId, isNull);
      expect(nav.destination, CloudDestination.chat);
      expect(
        nav.acknowledge('old-account', owner: 'a', presentation: current),
        false,
      );
    },
  );
  test(
    'New conversation promotion preserves the live presentation identity',
    () {
      final nav = CloudNavigationController();
      addTearDown(nav.dispose);
      nav.bindOwner('a');
      final p = nav.presentation;
      expect(nav.acknowledge('created', owner: 'a', presentation: p), true);
      expect(nav.conversationId, 'created');
      expect(nav.presentation, p);
    },
  );
  test(
    'Attachment and image creation intents are consumed once by their owner',
    () {
      final nav = CloudNavigationController();
      addTearDown(nav.dispose);
      nav.bindOwner('a');
      nav.open('image-chat', image: {'fileId': 'f', 'type': 'image'});
      final p = nav.presentation;
      expect(nav.takeLaunch(owner: 'b', presentation: p).image, isNull);
      expect(nav.takeLaunch(owner: 'a', presentation: p).image, {
        'fileId': 'f',
        'type': 'image',
      });
      expect(nav.takeLaunch(owner: 'a', presentation: p).image, isNull);
      nav.newChat(createImage: true);
      expect(
        nav.takeLaunch(owner: 'a', presentation: nav.presentation).createImage,
        true,
      );
      expect(
        nav.takeLaunch(owner: 'a', presentation: nav.presentation).createImage,
        false,
      );
    },
  );
  test(
    'Profile loading retains a Settings choice while logout clears all presentation data',
    () {
      final nav = CloudNavigationController();
      addTearDown(nav.dispose);
      nav.show(CloudDestination.settings);
      nav.bindOwner('a');
      expect(nav.destination, CloudDestination.settings);
      nav.open('c');
      nav.show(CloudDestination.notifications);
      nav.bindOwner(null);
      expect(nav.destination, CloudDestination.chat);
      expect(nav.conversationId, isNull);
      expect(nav.open('unauthenticated'), false);
    },
  );
}
