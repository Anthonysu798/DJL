import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import '../domain/remote_notification.dart';

abstract interface class RemotePushNative {
  Stream<Object?> get events;
  Future<RemotePushState> status();
  Future<RemotePushState> enable();
  Future<RemotePushState> register();
  Future<Object?> initialTap();
  Future<void> acknowledge(String eventId);
  Future<void> clearToken({bool disable = false});
  void dispose();
}

class MethodChannelRemotePush implements RemotePushNative {
  MethodChannelRemotePush() {
    if (_supported) {
      _channel.setMethodCallHandler((call) async {
        if (call.method == 'tap' || call.method == 'state') {
          _events.add(call.arguments);
        }
      });
    }
  }
  static const _channel = MethodChannel('djl.mobile/remote-push');
  bool get _supported =>
      !kIsWeb &&
      {
        TargetPlatform.iOS,
        TargetPlatform.android,
      }.contains(defaultTargetPlatform);
  final _events = StreamController<Object?>.broadcast(sync: true);
  @override
  Stream<Object?> get events => _events.stream;
  Future<Object?> _call(String method, [Object? arguments]) async {
    if (!_supported) return null;
    try {
      return await _channel.invokeMethod<Object?>(method, arguments);
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  @override
  Future<RemotePushState> status() async =>
      RemotePushState.from(await _call('status'));
  @override
  Future<RemotePushState> enable() async =>
      RemotePushState.from(await _call('enable'));
  @override
  Future<RemotePushState> register() async =>
      RemotePushState.from(await _call('register'));
  @override
  Future<Object?> initialTap() => _call('initialTap');
  @override
  Future<void> acknowledge(String eventId) async {
    await _call('ack', eventId);
  }

  @override
  Future<void> clearToken({bool disable = false}) async {
    await _call('clearToken', {'disable': disable});
  }

  @override
  void dispose() {
    if (_supported) _channel.setMethodCallHandler(null);
    unawaited(_events.close());
  }
}
