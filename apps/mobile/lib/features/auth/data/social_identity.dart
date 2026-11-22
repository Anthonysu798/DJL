import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import '../../../l10n/l10n.dart';

enum SocialProvider { apple, google }

class SocialIdentity {
  const SocialIdentity(this.provider, this.token, {this.nonce});
  final SocialProvider provider;
  final String token;
  final String? nonce;
}

class SocialIdentityFailure implements Exception {
  const SocialIdentityFailure({this.configuration = false});
  final bool configuration;
  @override
  String toString() => configuration
      ? appStrings.authSocialNotConfigured
      : appStrings.authSocialOpenFailed;
}

abstract interface class SocialIdentitySource {
  Future<bool> isAvailable(SocialProvider provider);
  Future<SocialIdentity?> acquire(SocialProvider provider);
  Future<void> signOut();
}

class PluginSocialIdentitySource implements SocialIdentitySource {
  PluginSocialIdentitySource({
    TargetPlatform? targetPlatform,
    this.appleEnabled = const bool.fromEnvironment('DJL_APPLE_SIGN_IN_ENABLED'),
    this.googleIosClientId = const String.fromEnvironment(
      'DJL_GOOGLE_IOS_CLIENT_ID',
    ),
    this.googleServerClientId = const String.fromEnvironment(
      'DJL_GOOGLE_SERVER_CLIENT_ID',
    ),
    List<int> Function(int)? randomBytes,
  }) : _platform = targetPlatform ?? defaultTargetPlatform,
       _randomBytes = randomBytes ?? _secureBytes;
  final TargetPlatform _platform;
  final bool appleEnabled;
  final String googleIosClientId, googleServerClientId;
  final List<int> Function(int) _randomBytes;
  static const _configuration = MethodChannel('djl.mobile/social-config');
  static Future<void>? _googleInitialization;
  static String? _googleConfiguration;
  static Future<SocialIdentity?>? _acquisition;

  static List<int> _secureBytes(int length) {
    final random = Random.secure();
    return List.generate(length, (_) => random.nextInt(256));
  }

  bool _validClientId(String value) => RegExp(
    r'^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$',
  ).hasMatch(value);

  @override
  Future<bool> isAvailable(SocialProvider provider) async {
    if (kIsWeb) return false;
    if (provider == SocialProvider.apple) {
      if (_platform != TargetPlatform.iOS || !appleEnabled) return false;
      try {
        return await SignInWithApple.isAvailable();
      } catch (_) {
        return false;
      }
    }
    if (!_validClientId(googleServerClientId)) return false;
    if (_platform == TargetPlatform.android) return true;
    if (_platform != TargetPlatform.iOS || !_validClientId(googleIosClientId)) {
      return false;
    }
    try {
      final schemes = await _configuration.invokeListMethod<Object?>(
        'callbackSchemes',
      );
      return schemes?.contains(
            googleIosClientId.split('.').reversed.join('.'),
          ) ==
          true;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<SocialIdentity?> acquire(SocialProvider provider) {
    if (_acquisition != null) {
      return Future.error(const SocialIdentityFailure());
    }
    late final Future<SocialIdentity?> task;
    task = _acquire(provider).whenComplete(() {
      if (identical(_acquisition, task)) _acquisition = null;
    });
    _acquisition = task;
    return task;
  }

  Future<SocialIdentity?> _acquire(SocialProvider provider) async {
    try {
      if (!await isAvailable(provider)) {
        throw const SocialIdentityFailure(configuration: true);
      }
      if (provider == SocialProvider.apple) {
        final raw = base64UrlEncode(_randomBytes(32)).replaceAll('=', '');
        final nonce = sha256.convert(utf8.encode(raw)).toString();
        final credential = await SignInWithApple.getAppleIDCredential(
          scopes: [
            AppleIDAuthorizationScopes.email,
            AppleIDAuthorizationScopes.fullName,
          ],
          nonce: nonce,
        );
        final token = credential.identityToken;
        if (token == null || token.trim().isEmpty) {
          throw const SocialIdentityFailure();
        }
        return SocialIdentity(provider, token, nonce: nonce);
      }
      final clientId = _platform == TargetPlatform.iOS
          ? googleIosClientId
          : null;
      final configuration = jsonEncode([clientId, googleServerClientId]);
      if (_googleInitialization == null) {
        _googleConfiguration = configuration;
        // The plugin requires one initialization per process; Google nonce is
        // intentionally omitted, matching the Swift Cloud ID-token exchange.
        _googleInitialization = GoogleSignIn.instance.initialize(
          clientId: clientId,
          serverClientId: googleServerClientId,
        );
      }
      if (_googleConfiguration != configuration) {
        throw const SocialIdentityFailure(configuration: true);
      }
      await _googleInitialization;
      if (!GoogleSignIn.instance.supportsAuthenticate()) {
        throw const SocialIdentityFailure(configuration: true);
      }
      final account = await GoogleSignIn.instance.authenticate();
      final token = account.authentication.idToken;
      if (token == null || token.trim().isEmpty) {
        throw const SocialIdentityFailure();
      }
      return SocialIdentity(provider, token);
    } on SignInWithAppleAuthorizationException catch (error) {
      if (error.code == AuthorizationErrorCode.canceled) return null;
      throw const SocialIdentityFailure();
    } on GoogleSignInException catch (error) {
      if (error.code == GoogleSignInExceptionCode.canceled) return null;
      throw SocialIdentityFailure(
        configuration:
            error.code == GoogleSignInExceptionCode.clientConfigurationError ||
            error.code == GoogleSignInExceptionCode.providerConfigurationError,
      );
    } on SocialIdentityFailure {
      rethrow;
    } catch (_) {
      throw const SocialIdentityFailure();
    }
  }

  @override
  Future<void> signOut() async {
    // Neither plugin exposes prompt cancellation. Wait for the physical prompt
    // to finish, then clear only the SDK's app credential state.
    try {
      await _acquisition;
    } catch (_) {}
    if (_googleInitialization == null) return;
    await _googleInitialization;
    await GoogleSignIn.instance.signOut();
  }
}
