import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:cryptography/cryptography.dart';
import 'package:djl_mobile/core/security/remote_crypto.dart';

void main() {
  final fixture =
      jsonDecode(File('test/fixtures/remote-v2.json').readAsStringSync())
          as Map<String, dynamic>;
  final input = fixture['input'] as Map<String, dynamic>;
  test(
    'transcript and phone auth signature match TypeScript and Node byte-for-byte',
    () async {
      final transcript = handshakeTranscript(input);
      expect(base64Encode(transcript), fixture['transcript']);
      final key = await Ed25519().newKeyPairFromSeed(
        base64Decode(fixture['phoneSeed'] as String),
      );
      expect(
        base64Encode(
          (await Ed25519().sign(
            clientAuthTranscript(transcript),
            keyPair: key,
          )).bytes,
        ),
        fixture['phoneSignature'],
      );
      expect(
        await verifyMacHello(input, fixture['macSignature'] as String),
        isTrue,
      );
      expect(
        await verifyMacHello({
          ...input,
          'sessionId': 'tampered',
        }, fixture['macSignature'] as String),
        isFalse,
      );
    },
  );
  test('relay connect transcript and signature match the relay', () async {
    final vectors = fixture['relayAuth'] as Map<String, dynamic>;
    final publicKey = input['phoneIdentityPublicKey'] as String;
    final transcript = relayPhoneConnectTranscript(
      'fixture-session',
      'fixture-phone',
      publicKey,
    );
    expect(base64Encode(transcript), vectors['phoneConnectTranscript']);
    final signature = await Ed25519().sign(
      transcript,
      keyPair: await Ed25519().newKeyPairFromSeed(
        base64Decode(fixture['phoneSeed'] as String),
      ),
    );
    expect(base64Encode(signature.bytes), vectors['phoneConnectSignature']);
    expect(
      await Ed25519().verify(
        transcript,
        signature: Signature(
          signature.bytes,
          publicKey: SimplePublicKey(
            base64Decode(publicKey),
            type: KeyPairType.ed25519,
          ),
        ),
      ),
      isTrue,
    );
  });
  test('typed code derives the relay lookup code and pairing secret', () async {
    final pairing = fixture['pairing'] as Map<String, dynamic>;
    final keys = await derivePairingCodeKeys(pairing['code'] as String);
    expect(keys.lookupCode, pairing['lookupCode']);
    expect(base64Encode(keys.pairingSecret), pairing['pairingSecret']);
  });
  test(
    'pairing proofs match the gateway over the fixture transcript',
    () async {
      final pairing = fixture['pairing'] as Map<String, dynamic>;
      final secret = base64Decode(pairing['pairingSecret'] as String);
      final transcript = base64Decode(fixture['transcript'] as String);
      expect(
        await pairingProof(secret, transcript, pairingProofMacLabel),
        pairing['macPairingProof'],
      );
      expect(
        await pairingProof(secret, transcript, pairingProofPhoneLabel),
        pairing['phonePairingProof'],
      );
    },
  );
  test('X25519 and directional HKDF keys match gateway test vectors', () async {
    final keys = await deriveRemoteKeys(
      input,
      base64Decode(fixture['phoneEphemeralSeed'] as String),
    );
    expect(
      base64Encode(await keys.phoneToMac.extractBytes()),
      fixture['phoneToMacKey'],
    );
    expect(
      base64Encode(await keys.macToPhone.extractBytes()),
      fixture['macToPhoneKey'],
    );
  });
  test('gateway envelope decrypts, tampering and replay fail closed', () async {
    final keys = await deriveRemoteKeys(
      input,
      base64Decode(fixture['phoneEphemeralSeed'] as String),
    );
    final session = RemoteCipher(
      sessionId: 'fixture-session',
      keyEpoch: 7,
      keys: keys,
    );
    final envelope = fixture['envelope'] as Map<String, dynamic>;
    expect(await session.decrypt(envelope), fixture['payload']);
    await expectLater(
      session.decrypt(envelope),
      throwsA(isA<RemoteSecurityException>()),
    );
    final fresh = RemoteCipher(
      sessionId: 'fixture-session',
      keyEpoch: 7,
      keys: keys,
    );
    await expectLater(
      fresh.decrypt({...envelope, 'tag': base64Encode(List.filled(16, 0))}),
      throwsA(isA<RemoteSecurityException>()),
    );
    expect(fresh.lastInboundCounter, -1);
  });
  test('nonce encoding retains sender domain and 53-bit counter', () {
    expect(secureNonce('mac', 0), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(secureNonce('iphone', 256), [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
    expect(() => secureNonce('iphone', -1), throwsArgumentError);
  });
}
