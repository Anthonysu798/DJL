import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/remote_notifications/data/remote_push_native.dart';
import 'remote_push_test.dart' show cloudTap;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('djl.mobile/remote-push');
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });
  test(
    'Android uses the remote-push channel and preserves an unconfigured FCM state',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      var calls = 0;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async {
            calls++;
            return {
              'availability': 'unconfigured',
              'provider': 'fcm',
              'environment': 'production',
              'permission': 'notDetermined',
            };
          });
      final native = MethodChannelRemotePush();
      expect((await native.enable()).availability, 'unconfigured');
      await native.register();
      await native.status();
      expect(calls, 3);
      native.dispose();
    },
  );
  test(
    'actual method channel routes initial/live envelopes and ACKs event identity only',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      final tap = cloudTap('event');
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            calls.add(call);
            return call.method == 'initialTap'
                ? tap
                : {'availability': 'simulator', 'permission': 'authorized'};
          });
      final native = MethodChannelRemotePush();
      final events = <Object?>[];
      final subscription = native.events.listen(events.add);
      expect(await native.initialTap(), tap);
      final completed = Completer<void>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .handlePlatformMessage(
            channel.name,
            const StandardMethodCodec().encodeMethodCall(
              MethodCall('tap', tap),
            ),
            (_) => completed.complete(),
          );
      await completed.future;
      await Future<void>.delayed(Duration.zero);
      expect(events, [tap]);
      expect((await native.status()).availability, 'simulator');
      await native.acknowledge('event');
      expect(calls.last.method, 'ack');
      expect(calls.last.arguments, 'event');
      await native.clearToken();
      expect(calls.last.method, 'clearToken');
      expect(calls.last.arguments, {'disable': false});
      await subscription.cancel();
      native.dispose();
    },
  );
}
