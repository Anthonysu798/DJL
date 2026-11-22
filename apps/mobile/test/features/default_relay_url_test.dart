import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';

void main() {
  test('a build-time relay wins', () {
    expect(
      defaultRelayUrl(configured: 'wss://relay.example/relay'),
      'wss://relay.example/relay',
    );
  });
  test('falls back to the DJL Cloud relay like the desktop does', () {
    expect(
      defaultRelayUrl(configured: '', cloud: 'https://api.slcor.com'),
      'wss://api.slcor.com/relay',
    );
    expect(
      defaultRelayUrl(configured: '', cloud: 'http://127.0.0.1:8851'),
      'ws://127.0.0.1:8851/relay',
    );
  });
  test('an unusable cloud address leaves the relay unset', () {
    expect(defaultRelayUrl(configured: '', cloud: 'not a url'), '');
  });
}
