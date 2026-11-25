import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';

void main() {
  Map<String, dynamic> payload() => {
    'v': 2,
    'relay': 'wss://relay.example/proxy/relay',
    'sessionId': 'session',
    'macDeviceId': 'mac',
    'macIdentityPublicKey': base64Encode(List.filled(32, 1)),
    'pairingSecret': base64Encode(List.filled(32, 5)),
    'expiresAt': DateTime.now()
        .add(const Duration(minutes: 2))
        .millisecondsSinceEpoch,
  };
  test(
    'pairing validates expiry, protocol and identity without accepting secrets',
    () {
      expect(Pairing.parse(jsonEncode(payload())).sessionId, 'session');
      for (final patch in [
        {'v': 1},
        {'expiresAt': 1},
        {'macIdentityPublicKey': 'bad'},
        {'relay': 'ws://public.example/relay'},
        {'relay': 'wss://user:pass@relay.example/relay'},
        {'sessionId': '../other'},
      ]) {
        expect(
          () => Pairing.parse(jsonEncode({...payload(), ...patch})),
          throwsFormatException,
        );
      }
    },
  );
  test('QR without a valid pairing secret asks for a desktop update', () {
    final pair = Pairing.parse(jsonEncode(payload()));
    expect(pair.pairingSecret, List.filled(32, 5));
    expect(pair.data.containsKey('pairingSecret'), isFalse);
    for (final qr in [
      payload()..remove('pairingSecret'),
      {...payload(), 'pairingSecret': 7},
      {...payload(), 'pairingSecret': 'bad'},
      {...payload(), 'pairingSecret': base64Encode(List.filled(31, 5))},
    ]) {
      expect(
        () => Pairing.parse(jsonEncode(qr)),
        throwsA(
          isA<FormatException>().having(
            (e) => e.message,
            'message',
            'Update DJL on your desktop: this pairing uses a different protocol.',
          ),
        ),
      );
    }
  });
  test('relay resolution preserves proxy prefix and falls back to root', () {
    expect(
      resolveCandidates(
        Uri.parse('wss://host/prefix/relay'),
        'pairing/code/resolve',
        preservePath: true,
      ).map((u) => u.toString()),
      [
        'https://host/prefix/relay/v1/pairing/code/resolve',
        'https://host/prefix/v1/pairing/code/resolve',
        'https://host/v1/pairing/code/resolve',
      ],
    );
    expect(normalizePairingCode(' abcd-ef2345 '), 'ABCDEF2345');
  });
}
