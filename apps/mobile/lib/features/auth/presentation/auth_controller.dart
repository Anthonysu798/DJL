import 'dart:async';
import 'package:flutter/foundation.dart';
import '../../../core/network/cloud_client.dart';
import '../data/social_identity.dart';
import '../../../l10n/l10n.dart';

class AuthController extends ChangeNotifier {
  AuthController(
    this.client, {
    SocialIdentitySource? socialIdentity,
    this.clearCloudPreferences,
  }) : socialIdentity = socialIdentity ?? PluginSocialIdentitySource() {
    client.onSessionEnded = _ended;
  }
  final CloudClient client;
  final SocialIdentitySource socialIdentity;
  final Future<void> Function()? clearCloudPreferences;
  Set<SocialProvider> socialProviders = {};
  Map<String, Uri> policyUrls = {};
  String? socialConfigurationError;
  bool socialLoading = false;
  bool _socialAllowed = true, _socialInFlight = false, _disposed = false;
  Completer<void>? _socialResume;

  Future<void> loadSocialProviders() async {
    if (socialLoading || _disposed) return;
    socialLoading = true;
    socialProviders = {};
    policyUrls = {};
    socialConfigurationError = null;
    _notify();
    try {
      final response = await client.request(
        'GET',
        'v1/client-config',
        authenticated: false,
      );
      final raw = response['auth'];
      if (raw != null && raw is! Map) throw const FormatException();
      final flags = raw as Map? ?? {};
      if ([
        'apple',
        'google',
      ].any((key) => flags[key] != null && flags[key] is! bool)) {
        throw const FormatException();
      }
      final available = <SocialProvider>{};
      for (final provider in SocialProvider.values) {
        if (flags[provider.name] == true &&
            await socialIdentity.isAvailable(provider)) {
          available.add(provider);
        }
      }
      if (!_disposed) {
        socialProviders = available;
        final policies = response['policyUrls'];
        policyUrls = Map.unmodifiable({
          if (policies is Map)
            for (final key in ['terms', 'privacy'])
              if (_publicPolicyUrl(policies[key]) case final Uri uri) key: uri,
        });
      }
    } catch (_) {
      if (!_disposed) {
        socialProviders = {};
        policyUrls = {};
        socialConfigurationError = appStrings.authSignInOptionsFailed;
      }
    } finally {
      socialLoading = false;
      _notify();
    }
  }

  Uri? _publicPolicyUrl(dynamic value) {
    if (value is! String) return null;
    try {
      final uri = Uri.parse(value.trim());
      return {'http', 'https'}.contains(uri.scheme) &&
              uri.hasAuthority &&
              uri.host.isNotEmpty &&
              uri.userInfo.isEmpty
          ? uri
          : null;
    } on FormatException {
      return null;
    }
  }

  void setSocialAllowed(bool allowed) {
    _socialAllowed = allowed;
    if (allowed) _wakeSocial();
  }

  void _wakeSocial() {
    _socialResume?.complete();
    _socialResume = null;
  }

  void cancelSocialSignIn() {
    if (!_socialInFlight) return;
    _generation++;
    _wakeSocial();
  }

  bool _current(int generation, int revision) =>
      !_disposed && generation == _generation && revision == client.revision;

  Future<bool> _whenSocialAllowed(int generation, int revision) async {
    while (_current(generation, revision) && !_socialAllowed) {
      await (_socialResume ??= Completer<void>()).future;
    }
    return _current(generation, revision);
  }

  Future<bool> signInWithSocial(SocialProvider provider) async {
    if (busy ||
        _disposed ||
        !_socialAllowed ||
        !socialProviders.contains(provider)) {
      return false;
    }
    _busy = true;
    _socialInFlight = true;
    error = null;
    notice = null;
    final generation = _generation, revision = client.revision;
    var committing = false;
    _notify();
    try {
      final identity = await socialIdentity.acquire(provider);
      if (identity == null || !await _whenSocialAllowed(generation, revision)) {
        return false;
      }
      if (identity.provider != provider ||
          identity.token.trim().isEmpty ||
          provider == SocialProvider.apple &&
              identity.nonce?.isNotEmpty != true) {
        throw const SocialIdentityFailure();
      }
      final token = await client.authenticate('sign-in/social', {
        'provider': provider.name,
        'idToken': {
          'token': identity.token,
          if (identity.nonce != null) 'nonce': identity.nonce,
        },
      });
      if (!await _whenSocialAllowed(generation, revision)) return false;
      if (token == null || token.trim().isEmpty) {
        throw const SocialIdentityFailure();
      }
      committing = true;
      return await _completeSession(token, generation, revision, social: true);
    } catch (failure) {
      if (!_disposed &&
          generation == _generation &&
          (client.revision == revision ||
              committing && client.revision == revision + 1)) {
        error = failure is SocialIdentityFailure
            ? failure.toString()
            : appStrings.authCloudSignInFailed;
      }
      return false;
    } finally {
      _socialInFlight = false;
      _busy = false;
      _notify();
    }
  }

  Future<bool> _completeSession(
    String token,
    int generation,
    int revision, {
    bool social = false,
    bool Function()? formIsCurrent,
  }) async {
    final previous = await client.credentials.read('cloud.session');
    if (!_current(generation, revision) || formIsCurrent?.call() == false) {
      return false;
    }
    if (social && !await _whenSocialAllowed(generation, revision)) return false;
    final write = client.setSession(token);
    final committedRevision = revision + 1;
    await write;
    final current = social
        ? await _whenSocialAllowed(generation, committedRevision)
        : _current(generation, committedRevision);
    if (!current || formIsCurrent?.call() == false) {
      // Restore only our own invalidated write, never a newer owner's session.
      if (client.revision == committedRevision) {
        await client.setSession(previous);
      }
      return false;
    }
    _generation++;
    final completedGeneration = _generation;
    _socialInFlight = false;
    signedIn = true;
    await _resetCloudPreferences(completedGeneration);
    if (!_current(completedGeneration, committedRevision)) return false;
    _notify();
    await refreshAccount();
    return _current(completedGeneration, committedRevision) && signedIn;
  }

  bool ready = false, signedIn = false;
  bool _busy = false, _signingOut = false;
  bool get busy => _busy || _signingOut;
  String? error, notice;
  Map<String, dynamic>? account;
  int _generation = 0;
  Future<void> restore() async {
    try {
      signedIn = await client.signedIn;
    } catch (_) {
      signedIn = false;
      error = appStrings.authSecureStorageFailed;
    } finally {
      ready = true;
      _notify();
    }
    if (signedIn) await refreshAccount();
  }

  Future<void> refreshAccount() async {
    final generation = _generation;
    try {
      final value = await client.request('GET', 'v1/me');
      if (generation == _generation) account = value;
    } catch (e) {
      if (generation == _generation) error = e.toString();
    }
    _notify();
  }

  Future<bool> submit(
    String route,
    Map<String, dynamic> body, {
    bool requiresToken = true,
    bool Function()? formIsCurrent,
  }) async {
    if (busy || _disposed) return false;
    _busy = true;
    error = null;
    notice = null;
    final generation = _generation, revision = client.revision;
    _notify();
    try {
      final token = await client.authenticate(route, body);
      if (!_current(generation, revision) || formIsCurrent?.call() == false) {
        return false;
      }
      if (token != null) {
        return await _completeSession(
          token,
          generation,
          revision,
          formIsCurrent: formIsCurrent,
        );
      } else if (requiresToken) {
        notice = appStrings.authCheckEmailForCode;
      } else {
        notice = appStrings.authRequestSent;
      }
      return token != null || !requiresToken;
    } catch (e) {
      if (!_disposed &&
          generation == _generation &&
          formIsCurrent?.call() != false) {
        error = e.toString();
      }
      return false;
    } finally {
      _busy = false;
      _notify();
    }
  }

  Future<void> signOut() async {
    if (_signingOut || _disposed) return;
    _signingOut = true;
    _generation++;
    _wakeSocial();
    signedIn = false;
    account = null;
    error = null;
    notice = null;
    final cleanup = _resetCloudPreferences(_generation);
    _notify();
    try {
      await client.signOut();
      if (!_disposed) {
        try {
          await socialIdentity.signOut();
        } catch (_) {
          // Clearing the provider's app cache never restores a DJL session.
        }
      }
    } finally {
      await cleanup;
      _signingOut = false;
      _notify();
    }
  }

  void _ended() {
    _generation++;
    _wakeSocial();
    signedIn = false;
    account = null;
    error = appStrings.coreSessionEnded;
    unawaited(_resetCloudPreferences(_generation));
    _notify();
  }

  Future<void> _resetCloudPreferences(int generation) async {
    try {
      await clearCloudPreferences?.call();
    } catch (_) {
      if (!_disposed && generation == _generation) {
        notice = appStrings.authCloudDataNotCleared;
        _notify();
      }
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _wakeSocial();
    client.onSessionEnded = null;
    super.dispose();
  }
}
