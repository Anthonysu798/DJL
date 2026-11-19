import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';
import 'package:djl_mobile/features/auth/data/social_identity.dart';
import 'social_identity_test.dart' show NativeGoogleBoundary;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'Android Google uses explicit server client ID without an iOS client or nonce',
    () async {
      final native = NativeGoogleBoundary();
      GoogleSignInPlatform.instance = native;
      final source = PluginSocialIdentitySource(
        targetPlatform: TargetPlatform.android,
        googleServerClientId: '123456-serverclient.apps.googleusercontent.com',
      );
      expect(await source.isAvailable(SocialProvider.google), isTrue);
      expect(native.initializations, isEmpty);
      expect(
        (await source.acquire(SocialProvider.google))?.token,
        'google-provider-token',
      );
      await source.acquire(SocialProvider.google);
      expect(native.initializations, hasLength(1));
      expect(
        native.initializations.single.serverClientId,
        '123456-serverclient.apps.googleusercontent.com',
      );
      expect(native.initializations.single.clientId, isNull);
      expect(native.initializations.single.nonce, isNull);
      await source.signOut();
      expect(native.signOuts, 1);
      expect(native.disconnects, 0);
    },
  );
}
