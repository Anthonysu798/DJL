import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/paired_login_callback.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/host/data/paired_login_store.dart';
import 'package:djl_mobile/features/host/domain/paired_login.dart';
import 'package:djl_mobile/features/host/presentation/paired_login_controller.dart';
import 'package:djl_mobile/features/host/presentation/host_controller.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'host_controller_test.dart' show HostStore, HostTransport;

class LoginCredentials implements CredentialStore {
  final values = <String, String>{};
  bool failRead = false, failWrite = false;
  Completer<String?>? readGate;
  @override
  Future<String?> read(String key) async {
    if (failRead) throw StateError('private storage details');
    return readGate == null ? values[key] : readGate!.future;
  }

  @override
  Future<void> write(String key, String? value) async {
    if (failWrite) throw StateError('private storage details');
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

void main() {
  final received = DateTime.utc(2026, 10, 28);
  const identity = LoginIdentity('a', 'pin-a');
  const second = LoginIdentity('b', 'pin-b');
  test(
    'callback accepts canonical route only and stays separate from Cloud',
    () {
      expect(
        pairedLoginCallback(Uri.parse('DJL://auth/GPT/CALLBACK?code=fixture')),
        isNotNull,
      );
      for (final value in [
        'djl://auth/x/gpt/callback',
        'djl://auth/gpt/callback/extra',
        'djl://user@auth/gpt/callback',
        'djl://auth:22/gpt/callback',
        'djl://cloud/c/one',
        'https://auth/gpt/callback',
        'djl://auth/gpt%2fcallback',
        'djl://auth/gpt/callback#fragment',
      ]) {
        expect(pairedLoginCallback(Uri.parse(value)), isNull);
      }
    },
  );
  test(
    'start aliases validate type URL and optional expiry without fabricated TTL',
    () {
      final pending = PendingLogin.decode({
        'type': 'chatgpt',
        'login_id': 'one',
        'auth_url': 'https://auth.example/login',
        'expires_at': received
            .add(const Duration(minutes: 5))
            .millisecondsSinceEpoch,
      }, now: received);
      expect(pending.loginId, 'one');
      expect(pending.expired(received), isFalse);
      expect(pending.expired(received.add(const Duration(minutes: 5))), isTrue);
      expect(
        PendingLogin.decode({
          'type': 'chatgpt',
          'loginId': 'one',
          'authUrl': 'https://auth.example/login',
        }, now: received).expiresAt,
        isNull,
      );
      expect(
        PendingLogin.decode({
          'type': 'chatgpt',
          'loginId': 'one',
          'authUrl': 'https://auth.example/login',
          'expiresAt': '2026-10-28T00:01:00Z',
        }, now: received).expiresAt,
        received.add(const Duration(minutes: 1)),
      );
      for (final url in [
        'javascript:bad',
        'https:opaque',
        'https://user@auth.example/login',
        'http://auth.example/login',
      ]) {
        expect(
          () => PendingLogin.decode({
            'type': 'chatgpt',
            'loginId': 'one',
            'authUrl': url,
          }, now: received),
          throwsFormatException,
        );
      }
      expect(
        () => PendingLogin.decode({
          'type': 'apikey',
          'loginId': 'one',
          'authUrl': 'https://auth.example',
        }, now: received),
        throwsFormatException,
      );
    },
  );

  late HostTransport transport;
  late HostController host;
  late LoginCredentials credentials;
  late PairedLoginStore store;
  late PairedLoginController login;
  var now = received;
  Future<void> settle() async {
    for (var i = 0; i < 8; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  Future<void> online({LoginIdentity target = identity}) async {
    host.bind(
      device: target.device,
      session: 's1',
      connected: true,
      trusted: true,
    );
    login.bind(target);
    await login.load();
    await host.refresh();
  }

  setUp(() {
    now = received;
    credentials = LoginCredentials();
    store = PairedLoginStore(credentials);
    transport = HostTransport();
    transport.status['status'] = 'not_logged_in';
    transport.status['loginInFlight'] = true;
    transport.status['hostCapabilities'] = {'hostBrowserLogin': true};
    transport.handler = (m, p) async => m == 'account/status/read'
        ? transport.status
        : m == 'account/login/start'
        ? {
            'type': 'chatgpt',
            'loginId': 'one',
            'authUrl': 'https://auth.example/login',
          }
        : {};
    host = HostController(transport, store: HostStore());
    login = PairedLoginController(host, store, now: () => now);
  });
  tearDown(() {
    login.dispose();
    host.dispose();
  });

  test(
    'explicit host login uses exact wire and reuses secure pending URL',
    () async {
      await online();
      expect(await login.openOnHost(), isTrue);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/start').single.$2,
        {'type': 'chatgpt'},
      );
      expect(transport.calls.last.$1, 'account/login/openOnMac');
      expect(transport.calls.last.$2, {
        'authUrl': 'https://auth.example/login',
      });
      expect(await login.openOnHost(), isTrue);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/start').length,
        1,
      );
      expect((await store.read(identity)).pending?.loginId, 'one');
      expect(await store.read(second), isA<LoginRecord>());
      expect((await store.read(second)).pending, isNull);
      expect(
        (await store.read(const LoginIdentity('a', 'different-pin'))).pending,
        isNull,
      );
    },
  );
  test(
    'pre-login authenticated status cannot clear a new pending flow before a fresh read',
    () async {
      transport.status['status'] = 'authenticated';
      transport.status['tokenReady'] = true;
      await online();
      await login.openOnHost();
      expect(login.pending?.loginId, 'one');
      expect(await login.openOnHost(), isTrue);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/start').length,
        1,
      );
      transport.status['status'] = 'login_pending';
      transport.status['tokenReady'] = false;
      await login.poll();
      expect(login.pending?.loginId, 'one');
    },
  );
  for (final terminal in ['authenticated', 'expired']) {
    test(
      'earlier in-flight $terminal status cannot clear a newer login flow',
      () async {
        await online();
        final earlierStatus = Completer<Map<String, dynamic>>();
        transport.handler = (method, params) async =>
            method == 'account/status/read'
            ? earlierStatus.future
            : method == 'account/login/start'
            ? {
                'type': 'chatgpt',
                'loginId': 'one',
                'authUrl': 'https://auth.example/login',
              }
            : {};
        final earlier = host.refresh();
        expect(await login.openOnHost(), isTrue);
        expect(login.pending?.loginId, 'one');
        earlierStatus.complete({
          ...transport.status,
          'status': terminal,
          'tokenReady': terminal == 'authenticated',
          'loginInFlight': false,
        });
        await earlier;
        await settle();
        expect(host.snapshot?.status, terminal);
        expect(login.pending?.loginId, 'one');
        expect((await store.read(identity)).pending?.loginId, 'one');
        expect(await login.openOnHost(), isTrue);
        expect(
          transport.calls.where((c) => c.$1 == 'account/login/start').length,
          1,
        );
        transport.handler = (method, params) async =>
            method == 'account/status/read'
            ? {
                ...transport.status,
                'status': terminal,
                'tokenReady': terminal == 'authenticated',
              }
            : {};
        await login.poll();
        await settle();
        expect(login.pending, isNull);
        expect((await store.read(identity)).pending, isNull);
        expect(
          transport.calls.where((c) => c.$1 == 'account/login/start').length,
          1,
        );
      },
    );
  }
  test(
    'coalescing an earlier status read cannot unlock an uncertain start',
    () async {
      await online();
      final earlierStatus = Completer<Map<String, dynamic>>();
      final startResult = Completer<Map<String, dynamic>>();
      transport.handler = (method, params) => method == 'account/status/read'
          ? earlierStatus.future
          : startResult.future;
      final earlier = host.refresh();
      final start = login.openOnHost();
      await settle();
      startResult.completeError(TimeoutException('fixture uncertain result'));
      expect(await start, isFalse);
      expect(login.uncertainStart, isTrue);
      final check = login.checkStatus();
      earlierStatus.complete({
        ...transport.status,
        'status': 'not_logged_in',
        'loginInFlight': false,
      });
      await Future.wait([earlier, check]);
      await settle();
      expect(login.uncertainStart, isTrue);
      expect((await store.read(identity)).uncertainStart, isTrue);
      expect(await login.openOnHost(), isFalse);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/start').length,
        1,
      );
      transport.handler = (method, params) async =>
          method == 'account/status/read'
          ? {
              ...transport.status,
              'status': 'not_logged_in',
              'loginInFlight': false,
            }
          : method == 'account/login/start'
          ? {
              'type': 'chatgpt',
              'loginId': 'two',
              'authUrl': 'https://auth.example/next',
            }
          : {};
      await login.checkStatus();
      expect(login.uncertainStart, isFalse);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/start').length,
        1,
      );
      expect(await login.openOnHost(), isTrue);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/start').length,
        2,
      );
    },
  );
  test(
    'privacy round trip resumes a clean secure load and rejects its old result',
    () async {
      host.bind(device: 'a', session: 's1', connected: true, trusted: true);
      await host.refresh();
      final oldRead = Completer<String?>(), currentRead = Completer<String?>();
      final record = LoginRecord(
        pending: PendingLogin(
          'current',
          'https://auth.example/current',
          now,
          null,
        ),
      );
      credentials.readGate = oldRead;
      login.bind(identity);
      final oldLoad = login.load();
      await settle();
      login.setAllowed(false);
      credentials.readGate = currentRead;
      login.setAllowed(true);
      await settle();
      oldRead.complete(
        jsonEncode(
          LoginRecord(
            pending: PendingLogin('old', 'https://auth.example/old', now, null),
          ).toJson(),
        ),
      );
      await oldLoad;
      await settle();
      expect(login.loaded, isFalse);
      expect(login.pending, isNull);
      currentRead.complete(jsonEncode(record.toJson()));
      await settle();
      expect(login.loaded, isTrue);
      expect(login.pending?.loginId, 'current');
      expect(login.storageError, isNull);
      expect(host.session, 's1');
      expect(
        transport.calls.where(
          (c) => c.$1.startsWith('account/login/') || c.$1 == 'account/logout',
        ),
        isEmpty,
      );
    },
  );
  test(
    'declared host browser capability is required, including legacy Mac fallback',
    () async {
      transport.status.remove('hostCapabilities');
      await online();
      expect(host.capabilities.hostBrowserLogin, isTrue);
      expect(await login.openOnHost(), isFalse);
      expect(
        transport.calls.where((c) => c.$1.startsWith('account/login/')),
        isEmpty,
      );
    },
  );
  test(
    'duplicate taps and uncertain start never replay on refresh or reconnect',
    () async {
      await online();
      final gate = Completer<Map<String, dynamic>>();
      transport.handler = (m, p) => m == 'account/login/start'
          ? gate.future
          : Future.value(transport.status);
      final first = login.openOnHost();
      await settle();
      expect(await login.openOnHost(), isFalse);
      gate.completeError(TimeoutException('private auth URL'));
      expect(await first, isFalse);
      expect(await login.openOnHost(), isFalse);
      await host.refresh();
      host.bind(device: 'a', session: 's2', connected: true, trusted: true);
      await host.refresh();
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/start').length,
        1,
      );
      expect(login.error, isNot(contains('private')));
      expect((await store.read(identity)).uncertainStart, isTrue);
    },
  );
  test(
    'storage errors are visible and pending survives failed write for explicit retry',
    () async {
      credentials.failRead = true;
      await online();
      expect(login.storageError, isNotNull);
      expect(await login.openOnHost(), isFalse);
      credentials.failRead = false;
      await login.load();
      transport.handler = (m, p) async {
        if (m == 'account/login/start') {
          credentials.failWrite = true;
          return {
            'type': 'chatgpt',
            'loginId': 'one',
            'authUrl': 'https://auth.example/login',
          };
        }
        return m == 'account/status/read' ? transport.status : {};
      };
      expect(await login.openOnHost(), isFalse);
      expect(login.pending?.loginId, 'one');
      expect(login.storageError, isNotNull);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/openOnMac'),
        isEmpty,
      );
      credentials.failWrite = false;
      await login.retryStorage();
      expect((await store.read(identity)).pending?.loginId, 'one');
      expect(await login.openOnHost(), isTrue);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/start').length,
        1,
      );
    },
  );
  test(
    'old device start result and secure load cannot overwrite current identity',
    () async {
      await online();
      final gate = Completer<Map<String, dynamic>>();
      transport.handler = (m, p) => gate.future;
      final start = login.openOnHost();
      await settle();
      host.bind(device: 'b', session: 's2', connected: true, trusted: true);
      login.bind(second);
      await login.load();
      gate.complete({
        'type': 'chatgpt',
        'loginId': 'old',
        'authUrl': 'https://auth.example/login',
      });
      expect(await start, isFalse);
      expect(login.pending, isNull);
      expect((await store.read(second)).pending, isNull);
    },
  );
  test(
    'callback binds exact pending ID, queues behind privacy and survives offline restore',
    () async {
      await online();
      await login.openOnHost();
      login.setAllowed(false);
      expect(
        await login.receiveCallback(
          Uri.parse('djl://auth/gpt/callback?loginId=wrong&code=fixture'),
          identity: identity,
          receivedAt: now,
        ),
        isFalse,
      );
      expect(
        await login.receiveCallback(
          Uri.parse('djl://auth/gpt/callback?login_id=one&code=fixture'),
          identity: identity,
          receivedAt: now,
        ),
        isTrue,
      );
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/complete'),
        isEmpty,
      );
      host.bind(device: 'a', session: null, connected: false, trusted: true);
      login.setAllowed(true);
      final record = await store.read(identity);
      expect(record.callback?.loginId, 'one');
      login.dispose();
      login = PairedLoginController(host, store, now: () => now);
      login.bind(identity);
      await login.load();
      expect(login.callback?.loginId, 'one');
      host.bind(device: 'a', session: 's2', connected: true, trusted: true);
      await host.refresh();
      await settle();
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/complete'),
        isEmpty,
      );
      expect(await login.retryCallback(), isTrue);
      expect(transport.calls.last.$1, 'account/login/complete');
      expect(transport.calls.last.$2, {
        'loginId': 'one',
        'callbackUrl': 'djl://auth/gpt/callback?login_id=one&code=fixture',
      });
    },
  );
  test(
    'privacy unlock completes a queued never-attempted return once',
    () async {
      await online();
      await login.openOnHost();
      login.setAllowed(false);
      await login.receiveCallback(
        Uri.parse('djl://auth/gpt/callback?code=fixture'),
        identity: identity,
        receivedAt: now,
      );
      login.setAllowed(true);
      await settle();
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/complete').length,
        1,
      );
      login.setAllowed(false);
      login.setAllowed(true);
      await settle();
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/complete').length,
        1,
      );
    },
  );
  test(
    'acknowledged callback is consumed across duplicate delivery and cold restore',
    () async {
      await online();
      await login.openOnHost();
      final uri = Uri.parse('djl://auth/gpt/callback?code=fixture');
      await login.receiveCallback(uri, identity: identity, receivedAt: now);
      await login.receiveCallback(uri, identity: identity, receivedAt: now);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/complete').length,
        1,
      );
      login.dispose();
      login = PairedLoginController(host, store, now: () => now);
      login.bind(identity);
      await login.load();
      await login.receiveCallback(uri, identity: identity, receivedAt: now);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/complete').length,
        1,
      );
    },
  );
  test(
    'fresh logged-out status resolves unconfirmed logout without replaying it',
    () async {
      await online();
      await login.openOnHost();
      host.bind(device: 'a', session: null, connected: false, trusted: true);
      await login.logout();
      host.bind(device: 'a', session: 's2', connected: true, trusted: true);
      transport.status['loginInFlight'] = false;
      await login.checkStatus();
      expect(login.remoteUnconfirmed, isFalse);
      expect(login.canOpen, isTrue);
      expect(transport.calls.where((c) => c.$1 == 'account/logout'), isEmpty);
    },
  );
  test(
    'failed intent persistence sends no start; retry cannot lose uncertain guard',
    () async {
      await online();
      credentials.failWrite = true;
      expect(await login.openOnHost(), isFalse);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/start'),
        isEmpty,
      );
      expect(login.storageError, isNotNull);
      credentials.failWrite = false;
      await login.retryStorage();
      expect((await store.read(identity)).uncertainStart, isTrue);
      expect(await login.openOnHost(), isFalse);
      transport.status['loginInFlight'] = false;
      await login.checkStatus();
      expect(await login.openOnHost(), isTrue);
    },
  );
  test(
    'missing loginInFlight is not proof that an uncertain start ended',
    () async {
      await online();
      transport.handler = (m, p) async => m == 'account/login/start'
          ? throw TimeoutException('fixture')
          : transport.status;
      await login.openOnHost();
      transport.status.remove('loginInFlight');
      await login.checkStatus();
      expect(login.uncertainStart, isTrue);
      expect(await login.openOnHost(), isFalse);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/start').length,
        1,
      );
    },
  );
  test('forget removes only matching pinned pair secure state', () async {
    await online();
    await login.openOnHost();
    await store.write(
      second,
      LoginRecord(
        pending: PendingLogin.decode({
          'type': 'chatgpt',
          'loginId': 'two',
          'authUrl': 'https://auth.example/second',
        }, now: now),
      ),
    );
    await login.forget(identity);
    expect((await store.read(identity)).pending, isNull);
    expect((await store.read(second)).pending?.loginId, 'two');
    expect(login.identity, isNull);
  });
  test('an old secure read cannot overwrite a new pinned selection', () async {
    credentials.readGate = Completer<String?>();
    login.bind(identity);
    final first = login.load();
    await settle();
    final gate = credentials.readGate!;
    credentials.readGate = null;
    login.bind(second);
    await login.load();
    gate.complete(
      '{"pending":{"type":"chatgpt","loginId":"old","authUrl":"https://auth.example/old","createdAt":"2026-10-28T00:00:00Z"}}',
    );
    await first;
    expect(login.identity, second);
    expect(login.pending, isNull);
    expect(login.loaded, isTrue);
  });
  test(
    'unsupported complete retains callback and offers paired-device recovery; no blind retry',
    () async {
      await online();
      await login.openOnHost();
      transport.handler = (m, p) async {
        if (m == 'account/login/complete') {
          throw const RemoteRpcException(-32601, 'private callback', null);
        }
        return transport.status;
      };
      await login.receiveCallback(
        Uri.parse('djl://auth/gpt/callback?code=fixture'),
        identity: identity,
        receivedAt: now,
      );
      expect(login.callback, isNotNull);
      expect(login.error, contains('paired device'));
      await host.refresh();
      await settle();
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/complete').length,
        1,
      );
      transport.status['status'] = 'authenticated';
      transport.status['tokenReady'] = true;
      expect(await login.retryCallback(), isFalse);
      expect(login.pending, isNull);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/complete').length,
        1,
      );
    },
  );
  test(
    'callback expiry and device switch reject completion and old matching events',
    () async {
      await online();
      await login.openOnHost();
      login.setAllowed(false);
      await login.receiveCallback(
        Uri.parse('djl://auth/gpt/callback?code=fixture'),
        identity: identity,
        receivedAt: now,
      );
      now = now.add(const Duration(minutes: 10));
      login.setAllowed(true);
      expect(await login.retryCallback(), isFalse);
      expect(login.callback, isNull);
      host.bind(device: 'b', session: 's2', connected: true, trusted: true);
      login.bind(second);
      await login.load();
      await login.handleEvent('account/login/completed', {
        'loginId': 'one',
        'success': true,
      });
      expect(login.pending, isNull);
      expect(
        transport.calls.where((c) => c.$1 == 'account/login/complete'),
        isEmpty,
      );
    },
  );
  test(
    'matching completion events refresh once; mismatches and duplicates ignored',
    () async {
      await online();
      await login.openOnHost();
      transport.calls.clear();
      await login.handleEvent('account/login/completed', {
        'loginId': 'other',
        'success': true,
      });
      expect(transport.calls, isEmpty);
      await login.handleEvent('account/login/completed', {
        'login_id': 'one',
        'success': true,
      });
      final count = transport.calls.length;
      await login.handleEvent('account/login/completed', {
        'loginId': 'one',
        'success': true,
      });
      expect(transport.calls.length, count);
      expect(count, 1);
      await login.handleEvent('account/updated', {});
      expect(transport.calls.length, count + 1);
    },
  );
  test(
    'offline logout clears only local paired flow with unconfirmed remote result',
    () async {
      credentials.values['cloud.session'] = 'fixture-cloud';
      credentials.values['desktop.trusted'] = 'fixture-pair';
      await online();
      await login.openOnHost();
      host.bind(device: 'a', session: null, connected: false, trusted: true);
      expect(await login.logout(), isFalse);
      expect(login.pending, isNull);
      expect(login.remoteUnconfirmed, isTrue);
      expect((await store.read(identity)).pending, isNull);
      expect(credentials.values['cloud.session'], 'fixture-cloud');
      expect(credentials.values['desktop.trusted'], 'fixture-pair');
      await login.logout();
      expect(transport.calls.where((c) => c.$1 == 'account/logout'), isEmpty);
    },
  );
  test(
    'cancel and acknowledged logout accept empty result and use exact params',
    () async {
      await online();
      await login.openOnHost();
      await login.cancel();
      expect(transport.calls.last.$1, 'account/login/cancel');
      expect(transport.calls.last.$2, {'loginId': 'one'});
      expect(login.pending, isNull);
      expect(await login.logout(), isTrue);
      expect(transport.calls.last.$1, 'account/logout');
      expect(transport.calls.last.$2, <String, dynamic>{});
    },
  );
  test(
    'poll coalesces safe reads and stops when hidden expired cancelled or ready',
    () async {
      await online();
      await login.openOnHost();
      final before = transport.calls.length;
      await login.poll();
      expect(transport.calls.length, before + 1);
      expect(transport.calls.last.$1, 'account/status/read');
      login.setAllowed(false);
      await login.poll();
      expect(transport.calls.length, before + 1);
      login.setAllowed(true);
      transport.status['status'] = 'authenticated';
      transport.status['tokenReady'] = false;
      await login.poll();
      expect(login.pending, isNotNull);
      transport.status['tokenReady'] = true;
      await login.poll();
      expect(login.pending, isNull);
      expect(
        transport.calls.where((c) => c.$1 == 'desktop/preferences/update'),
        isEmpty,
      );
    },
  );
}
