import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:cryptography/cryptography.dart';
import '../../../core/security/remote_crypto.dart';
import '../../pairing/data/pairing_repository.dart';
import 'rpc_payload.dart';

class RemoteRpcException implements Exception {
  const RemoteRpcException(this.code, this.message, this.data);
  final Object? code, data;
  final String message;
  @override
  String toString() => message;
}

/// A single encrypted RPC connection. Caller owns retry policy; mutations are never resent here.
class RemoteTransport {
  RemoteTransport(this.pairings);
  final PairingRepository pairings;
  WebSocket? _socket;
  StreamIterator<dynamic>? _iterator;
  RemoteCipher? _cipher;
  final _messages = StreamController<RemoteJson>.broadcast(sync: true);
  final _pending = <String, Completer<RemoteJson>>{};
  Stream<RemoteJson> get messages => _messages.stream;
  bool get connected =>
      _cipher != null && _socket?.readyState == WebSocket.open;
  void Function(Object? error, int? closeCode)? onDisconnected;
  void Function(String message)? onProtocolWarning;
  Pairing? _pairing;
  String? get macDeviceId => _pairing?.macDeviceId;
  String? get sessionId => _pairing?.sessionId;
  int get connectionRevision => _generation;
  // Desktop mutation receipts outlive this transport and the phone process.
  final String _rpcNamespace = base64UrlEncode(secureRandomBytes(16));
  int _seq = 0, _rpc = 0, _generation = 0;
  String? _replayEpoch;
  String get _cursorKey => 'desktop.cursor.${_pairing!.macDeviceId}';

  TrustedDeviceEntry? _savedSelection;
  Future<void> connectSaved(Pairing pair, TrustedDeviceEntry target) {
    _savedSelection = target;
    return connect(pair, bootstrap: false);
  }

  Future<void> connect(Pairing pair, {required bool bootstrap}) async {
    final expected = _savedSelection;
    _savedSelection = null;
    final closing = disconnect();
    final generation = _generation;
    void checkCurrent() {
      if (generation != _generation) throw StateError('Connection cancelled.');
    }

    await closing;
    checkCurrent();
    _pairing = pair;
    final identity = await pairings.identity();
    checkCurrent();
    final saved = await pairings.credentials.read(
      'desktop.cursor.${pair.macDeviceId}',
    );
    checkCurrent();
    final cursor = saved == null
        ? <String, dynamic>{}
        : jsonDecode(saved) as RemoteJson;
    _seq = !bootstrap && cursor['sessionId'] == pair.sessionId
        ? (cursor['seq'] as int? ?? 0)
        : 0;
    _replayEpoch = !bootstrap && cursor['sessionId'] == pair.sessionId
        ? cursor['epoch'] as String?
        : null;
    final ephemeral = await X25519().newKeyPair();
    checkCurrent();
    final clientNonce = base64Encode(secureRandomBytes(32));
    final mode = bootstrap ? 'qr_bootstrap' : 'trusted_reconnect';
    final hello = <String, dynamic>{
      'kind': 'clientHello',
      'protocolVersion': 2,
      'sessionId': pair.sessionId,
      'handshakeMode': mode,
      'phoneDeviceId': identity.deviceId,
      'phoneIdentityPublicKey': identity.publicKey,
      'phoneEphemeralPublicKey': base64Encode(
        (await ephemeral.extractPublicKey()).bytes,
      ),
      'clientNonce': clientNonce,
    };
    checkCurrent();
    try {
      final socket = await WebSocket.connect(
        '${pair.relay.toString().replaceFirst(RegExp(r'/$'), '')}/${Uri.encodeComponent(pair.sessionId)}',
        headers: {'x-role': 'iphone'},
      ).timeout(const Duration(seconds: 12));
      if (generation != _generation) {
        await socket.close();
        throw StateError('Connection cancelled.');
      }
      _socket = socket;
      socket.pingInterval = const Duration(seconds: 20);
      _iterator = StreamIterator<dynamic>(socket);
      _sendControl(hello);
      final deadline = DateTime.now().add(const Duration(seconds: 12));
      RemoteJson server;
      RemoteJson transcript;
      while (true) {
        server = await _control('serverHello', deadline);
        checkCurrent();
        if (server['clientNonce'] != null &&
            server['clientNonce'] != clientNonce) {
          continue;
        }
        if (server['protocolVersion'] != 2 ||
            server['sessionId'] != pair.sessionId ||
            server['handshakeMode'] != mode ||
            server['macDeviceId'] != pair.macDeviceId ||
            server['macIdentityPublicKey'] != pair.publicKey) {
          throw const RemoteSecurityException(
            'The desktop identity or secure protocol does not match the pairing.',
          );
        }
        transcript = {...hello, ...server, 'clientNonce': clientNonce};
        if (!await verifyMacHello(
          transcript,
          server['macSignature'] as String,
        )) {
          if (server['clientNonce'] == null) continue;
          throw const RemoteSecurityException(
            'The desktop handshake signature could not be verified.',
          );
        }
        checkCurrent();
        break;
      }
      final epoch = server['bridgeReplayEpoch'] as String?;
      if (epoch != null && epoch != _replayEpoch) {
        _seq = 0;
        _replayEpoch = epoch;
      }
      final phoneKey = await Ed25519().newKeyPairFromSeed(identity.seed);
      final signature = await Ed25519().sign(
        clientAuthTranscript(handshakeTranscript(transcript)),
        keyPair: phoneKey,
      );
      checkCurrent();
      _sendControl({
        'kind': 'clientAuth',
        'sessionId': pair.sessionId,
        'phoneDeviceId': identity.deviceId,
        'keyEpoch': server['keyEpoch'],
        'phoneSignature': base64Encode(signature.bytes),
      });
      while (true) {
        final ready = await _control(
          'secureReady',
          DateTime.now().add(const Duration(seconds: 12)),
        );
        checkCurrent();
        if (ready['sessionId'] == pair.sessionId &&
            ready['keyEpoch'] == server['keyEpoch'] &&
            ready['macDeviceId'] == pair.macDeviceId) {
          break;
        }
      }
      final keys = await deriveRemoteKeys(
        transcript,
        await ephemeral.extractPrivateKeyBytes(),
      );
      if (generation != _generation) throw StateError('Connection cancelled.');
      _cipher = RemoteCipher(
        sessionId: pair.sessionId,
        keyEpoch: server['keyEpoch'] as int,
        keys: keys,
      );
      // Trust only the authenticated identity, after secureReady and key agreement succeed.
      await pairings.trust(
        pair,
        isCurrent: () => generation == _generation,
        expected: expected,
      );
      checkCurrent();
      _sendControl({
        'kind': 'resumeState',
        'sessionId': pair.sessionId,
        'keyEpoch': server['keyEpoch'],
        'lastAppliedBridgeOutboundSeq': _seq,
        if (_replayEpoch != null) 'bridgeReplayEpoch': _replayEpoch,
      });
      unawaited(_read(generation));
    } catch (error) {
      if (generation == _generation) await disconnect();
      rethrow;
    }
  }

  Future<RemoteJson> _control(String kind, DateTime deadline) async {
    final iterator = _iterator!;
    final generation = _generation;
    while (true) {
      final remaining = deadline.difference(DateTime.now());
      if (remaining.isNegative) {
        throw TimeoutException('Desktop secure handshake timed out.');
      }
      if (!await iterator.moveNext().timeout(remaining)) {
        if ({4001, 4005, 4009}.contains(_socket?.closeCode)) {
          throw const RemoteSecurityException(
            'Desktop refused the secure connection.',
          );
        }
        throw const SocketException(
          'Desktop connection interrupted during secure handshake.',
        );
      }
      if (generation != _generation) throw StateError('Connection cancelled.');
      final frame = _decode(iterator.current);
      if (frame['kind'] == 'secureError') {
        throw RemoteSecurityException(
          frame['message'] as String? ?? 'Secure desktop connection refused.',
        );
      }
      if (frame['kind'] == kind) return frame;
      // Host presence and stale encrypted frames cannot advance handshake state.
    }
  }

  RemoteJson _decode(dynamic value) {
    if (value is! String || value.length > 16000000) {
      throw const RemoteSecurityException('Invalid desktop frame.');
    }
    return jsonDecode(value) as RemoteJson;
  }

  void _sendControl(RemoteJson value) => _socket!.add(jsonEncode(value));
  Future<void> _saveCursor() => pairings.credentials.write(
    _cursorKey,
    jsonEncode({
      'sessionId': _pairing!.sessionId,
      'seq': _seq,
      'epoch': _replayEpoch,
    }),
  );
  // The cursor only decides how much the desktop replays after a cold start,
  // and replays are applied idempotently. Writing it to the Keychain after
  // every frame held up the next frame, so it trails the stream instead.
  Timer? _cursorSave;
  void _saveCursorSoon() =>
      _cursorSave ??= Timer(const Duration(milliseconds: 500), () {
        _cursorSave = null;
        if (_pairing != null) unawaited(_saveCursor().catchError((_) {}));
      });

  Future<void> _read(int generation) async {
    Object? failure;
    final iterator = _iterator!;
    try {
      while (generation == _generation && await iterator.moveNext()) {
        if (generation != _generation) return;
        final envelope = _decode(iterator.current);
        if (envelope['kind'] == 'hostPresence') {
          _messages.add({'method': 'djl/hostPresence', 'params': envelope});
          continue;
        }
        if (envelope['kind'] == 'secureError') {
          throw RemoteSecurityException(
            envelope['message'] as String? ??
                'Desktop secure transport failed.',
          );
        }
        if (envelope['kind'] != 'encryptedEnvelope') {
          throw const RemoteSecurityException(
            'Unencrypted desktop application traffic was rejected.',
          );
        }
        final value = await _cipher!.decrypt(envelope);
        if (generation != _generation) return;
        final seq = value['bridgeOutboundSeq'] as int?;
        if (seq != null && seq <= _seq) continue;
        final payload = decodeRpcPayload(value['payloadText'] as String);
        if (payload.malformed) {
          onProtocolWarning?.call(
            'Unable to decode part of the desktop payload.',
          );
        }
        for (final rpc in payload.messages) {
          if (generation != _generation) return;
          await _applyRpc(rpc, generation);
        }
        if (generation != _generation) return;
        if (seq != null) {
          _seq = seq;
          _saveCursorSoon();
        }
      }
    } catch (error) {
      failure = error;
    } finally {
      if (generation == _generation) {
        final closeCode = _socket?.closeCode;
        final closing = disconnect();
        final completionGeneration = _generation;
        await closing;
        if (completionGeneration == _generation) {
          onDisconnected?.call(failure, closeCode);
        }
      }
    }
  }

  Future<void> _applyRpc(RemoteJson rpc, int generation) async {
    final params = rpc['params'] is Map
        ? Map<String, dynamic>.from(rpc['params'] as Map)
        : null;
    if (rpc['method'] == 'djl/bufferedReplay/reset') {
      _seq = params?['resetBridgeOutboundSeqTo'] as int? ?? 0;
      _replayEpoch = params?['bridgeReplayEpoch'] as String?;
      await _saveCursor();
    } else if (rpc['method'] == 'djl/bufferedReplay/gap') {
      _seq = params?['lastDiscardedBridgeOutboundSeq'] as int? ?? _seq;
      await _saveCursor();
    }
    if (generation != _generation) return;
    final id = rpc['id']?.toString();
    if (id != null && rpc['method'] == null && _pending.containsKey(id)) {
      final waiter = _pending.remove(id)!;
      if (rpc['error'] != null) {
        final error = rpc['error'] as RemoteJson;
        waiter.completeError(
          RemoteRpcException(
            error['code'],
            error['message'] as String? ?? 'Desktop request failed.',
            error['data'],
          ),
        );
      } else {
        final result = rpc['result'];
        waiter.complete(
          result is Map ? Map<String, dynamic>.from(result) : {'value': result},
        );
      }
    } else {
      _messages.add(rpc);
    }
  }

  Future<void> send(RemoteJson message) async {
    final cipher = _cipher;
    if (cipher == null || !connected) {
      throw StateError('Desktop is disconnected.');
    }
    final generation = _generation;
    final encrypted = await cipher.encrypt(jsonEncode(message));
    if (generation != _generation) {
      throw StateError('Desktop connection changed.');
    }
    _socket!.add(jsonEncode(encrypted));
  }

  Future<RemoteJson> requestNull(
    String method, {
    Duration timeout = const Duration(seconds: 30),
  }) => _request(method, null, timeout: timeout);

  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) => _request(method, params, timeout: timeout);

  Future<RemoteJson> _request(
    String method,
    RemoteJson? params, {
    required Duration timeout,
  }) async {
    if (!connected) throw StateError('Desktop is disconnected.');
    final id = 'flutter-$_rpcNamespace-${++_rpc}';
    final waiter = Completer<RemoteJson>();
    _pending[id] = waiter;
    // Observe both operations while encryption is in flight: disconnect can
    // reject the response before send completes.
    final result = waiter.future.timeout(
      timeout,
      onTimeout: () => throw TimeoutException(
        'Desktop request timed out. Its result is unknown; refresh before retrying.',
      ),
    );
    try {
      final values = await Future.wait<Object?>([
        send({
          'id': id,
          'method': method,
          'params': params,
        }).then<Object?>((_) => null),
        result,
      ], eagerError: true);
      return values[1] as RemoteJson;
    } catch (error, stack) {
      if (!waiter.isCompleted) waiter.completeError(error, stack);
      rethrow;
    } finally {
      _pending.remove(id);
    }
  }

  Future<void> disconnect() async {
    _generation++;
    if (_cursorSave != null) {
      _cursorSave!.cancel();
      _cursorSave = null;
      if (_pairing != null) await _saveCursor().catchError((_) {});
    }
    _cipher = null;
    final iterator = _iterator;
    _iterator = null;
    final socket = _socket;
    _socket = null;
    for (final waiter in _pending.values) {
      if (!waiter.isCompleted) {
        waiter.completeError(
          StateError(
            'Desktop disconnected; refresh before retrying an action.',
          ),
        );
      }
    }
    _pending.clear();
    await iterator?.cancel();
    await socket?.close();
  }

  Future<void> dispose() async {
    onDisconnected = null;
    onProtocolWarning = null;
    await disconnect();
    await _messages.close();
  }
}
