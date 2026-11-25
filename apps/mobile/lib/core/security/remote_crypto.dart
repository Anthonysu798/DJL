import 'dart:convert';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';
import '../../l10n/l10n.dart';

const remoteProtocolVersion = 2;
const remoteHandshakeTag = 'djl-e2ee-v1';
const maxSafeCounter = 9007199254740991;

class RemoteSecurityException implements Exception {
  const RemoteSecurityException(this.message);
  final String message;
  @override
  String toString() => message;
}

List<int> lengthPrefixed(List<int> bytes) {
  final length = ByteData(4)..setUint32(0, bytes.length, Endian.big);
  return [...length.buffer.asUint8List(), ...bytes];
}

List<int> _text(Object value) => lengthPrefixed(utf8.encode(value.toString()));
List<int> handshakeTranscript(Map<String, dynamic> input) => [
  ..._text(remoteHandshakeTag),
  for (final key in [
    'sessionId',
    'protocolVersion',
    'handshakeMode',
    'keyEpoch',
    'macDeviceId',
    'phoneDeviceId',
  ])
    ..._text(input[key] as Object),
  for (final key in [
    'macIdentityPublicKey',
    'phoneIdentityPublicKey',
    'macEphemeralPublicKey',
    'phoneEphemeralPublicKey',
    'clientNonce',
    'serverNonce',
  ])
    ...lengthPrefixed(base64Decode(input[key] as String)),
  ..._text(input['expiresAtForTranscript'] as Object),
];
List<int> clientAuthTranscript(List<int> transcript) => [
  ...transcript,
  ..._text('client-auth'),
];
const pairingProofMacLabel = 'pairing-proof-mac';
const pairingProofPhoneLabel = 'pairing-proof-phone';

/// Proof that the sender holds the pairing secret, which the relay never sees.
Future<String> pairingProof(
  List<int> pairingSecret,
  List<int> transcript,
  String label,
) async => base64Encode(
  (await Hmac.sha256().calculateMac([
    ...transcript,
    ..._text(label),
  ], secretKey: SecretKey(pairingSecret))).bytes,
);

/// Splits a typed pairing code into the code the relay looks up and the
/// pairing secret, so the relay never learns the typed code.
Future<({String lookupCode, List<int> pairingSecret})> derivePairingCodeKeys(
  String code,
) async {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  final bytes =
      await (await Pbkdf2(
            macAlgorithm: Hmac.sha256(),
            iterations: 100000,
            bits: 512,
          ).deriveKey(
            secretKey: SecretKey(utf8.encode(code)),
            nonce: utf8.encode('djl-pairing-code-v1'),
          ))
          .extractBytes();
  return (
    lookupCode: [for (var i = 0; i < 10; i++) alphabet[bytes[i] % 32]].join(),
    pairingSecret: bytes.sublist(32),
  );
}

List<int> trustedResolveTranscript(Map<String, dynamic> input) => [
  ..._text('djl-trusted-session-resolve-v1'),
  ..._text(input['macDeviceId'] as Object),
  ..._text(input['phoneDeviceId'] as Object),
  ...lengthPrefixed(base64Decode(input['phoneIdentityPublicKey'] as String)),
  ..._text(input['nonce'] as Object),
  ..._text(input['timestamp'] as Object),
];

/// What the phone signs on every relay connect so the relay knows who it is.
List<int> relayPhoneConnectTranscript(
  String sessionId,
  String phoneDeviceId,
  String phoneIdentityPublicKey,
) => [
  ..._text('djl-relay-phone-connect-v1'),
  ..._text(sessionId),
  ..._text(phoneDeviceId),
  ...lengthPrefixed(base64Decode(phoneIdentityPublicKey)),
];
Future<bool> verifyMacHello(
  Map<String, dynamic> input,
  String signature,
) async {
  try {
    return await Ed25519().verify(
      handshakeTranscript(input),
      signature: Signature(
        base64Decode(signature),
        publicKey: SimplePublicKey(
          base64Decode(input['macIdentityPublicKey'] as String),
          type: KeyPairType.ed25519,
        ),
      ),
    );
  } catch (_) {
    return false;
  }
}

class RemoteKeys {
  const RemoteKeys(this.phoneToMac, this.macToPhone);
  final SecretKey phoneToMac, macToPhone;
}

Future<RemoteKeys> deriveRemoteKeys(
  Map<String, dynamic> input,
  List<int> ephemeralSeed,
) async {
  final agreement = X25519();
  final pair = await agreement.newKeyPairFromSeed(ephemeralSeed);
  final shared = await agreement.sharedSecretKey(
    keyPair: pair,
    remotePublicKey: SimplePublicKey(
      base64Decode(input['macEphemeralPublicKey'] as String),
      type: KeyPairType.x25519,
    ),
  );
  final salt = (await Sha256().hash(handshakeTranscript(input))).bytes;
  final prefix =
      '$remoteHandshakeTag|${input['sessionId']}|${input['macDeviceId']}|${input['phoneDeviceId']}|${input['keyEpoch']}';
  final hkdf = Hkdf(hmac: Hmac.sha256(), outputLength: 32);
  return RemoteKeys(
    await hkdf.deriveKey(
      secretKey: shared,
      nonce: salt,
      info: utf8.encode('$prefix|phoneToMac'),
    ),
    await hkdf.deriveKey(
      secretKey: shared,
      nonce: salt,
      info: utf8.encode('$prefix|macToPhone'),
    ),
  );
}

List<int> secureNonce(String sender, int counter) {
  if (!{'mac', 'iphone'}.contains(sender) ||
      counter < 0 ||
      counter > maxSafeCounter) {
    throw ArgumentError('Invalid secure nonce input');
  }
  final bytes = List<int>.filled(12, 0);
  bytes[0] = sender == 'mac' ? 1 : 2;
  var remaining = counter;
  for (var i = 11; i >= 1; i--) {
    bytes[i] = remaining & 255;
    remaining >>= 8;
  }
  return bytes;
}

class RemoteCipher {
  RemoteCipher({
    required this.sessionId,
    required this.keyEpoch,
    required this.keys,
  });
  final String sessionId;
  final int keyEpoch;
  final RemoteKeys keys;
  final _aes = AesGcm.with256bits();
  int lastInboundCounter = -1, _nextOutboundCounter = 0;
  Future<Map<String, dynamic>> encrypt(String payloadText) async {
    // Reserve before awaiting crypto so concurrent RPCs never reuse a nonce.
    final counter = _nextOutboundCounter++;
    final box = await _aes.encrypt(
      utf8.encode(jsonEncode({'payloadText': payloadText})),
      secretKey: keys.phoneToMac,
      nonce: secureNonce('iphone', counter),
    );
    return {
      'kind': 'encryptedEnvelope',
      'v': remoteProtocolVersion,
      'sessionId': sessionId,
      'keyEpoch': keyEpoch,
      'sender': 'iphone',
      'counter': counter,
      'ciphertext': base64Encode(box.cipherText),
      'tag': base64Encode(box.mac.bytes),
    };
  }

  Future<Map<String, dynamic>> decrypt(Map<String, dynamic> envelope) async {
    final counter = envelope['counter'];
    if (envelope['kind'] != 'encryptedEnvelope' ||
        envelope['v'] != remoteProtocolVersion ||
        envelope['sessionId'] != sessionId ||
        envelope['keyEpoch'] != keyEpoch ||
        envelope['sender'] != 'mac' ||
        counter is! int ||
        counter <= lastInboundCounter ||
        counter > maxSafeCounter) {
      throw RemoteSecurityException(appStrings.coreInvalidDesktopEnvelope);
    }
    try {
      final plaintext = await _aes.decrypt(
        SecretBox(
          base64Decode(envelope['ciphertext'] as String),
          nonce: secureNonce('mac', counter),
          mac: Mac(base64Decode(envelope['tag'] as String)),
        ),
        secretKey: keys.macToPhone,
      );
      final payload =
          jsonDecode(utf8.decode(plaintext)) as Map<String, dynamic>;
      lastInboundCounter = counter;
      return payload;
    } catch (_) {
      throw RemoteSecurityException(
        appStrings.coreDesktopMessageUnauthenticated,
      );
    }
  }
}
