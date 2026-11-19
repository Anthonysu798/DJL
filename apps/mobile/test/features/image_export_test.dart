import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/images/data/native_image_actions.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'gallery names omit image extensions without losing other dots',
    () async {
      final names = <String>[];
      const channel = MethodChannel('gal');
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'putImageBytes') {
          names.add((call.arguments as Map)['name'] as String);
        }
        return true;
      });
      addTearDown(() => messenger.setMockMethodCallHandler(channel, null));
      for (final name in [
        'djl-preview.png',
        'portrait.JPG',
        'photo.jpeg',
        'draft.v2.webp',
        'draft.v2',
        'qa-image',
        '.png',
      ]) {
        await NativeImageActions().save(Uint8List.fromList([1, 2, 3]), name);
      }
      expect(names, [
        'djl-preview',
        'portrait',
        'photo',
        'draft.v2',
        'draft.v2',
        'qa-image',
        '.png',
      ]);
    },
  );
  test(
    'saving passes bytes to native gallery and returns permission failures',
    () async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(const MethodChannel('gal'), (call) async {
            calls.add(call);
            if (call.method == 'putImageBytes') return null;
            return true;
          });
      await NativeImageActions().save(
        Uint8List.fromList([1, 2, 3]),
        'qa-image',
      );
      expect(calls.any((c) => c.method == 'putImageBytes'), isTrue);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            const MethodChannel('gal'),
            (call) async => throw PlatformException(code: 'ACCESS_DENIED'),
          );
      await expectLater(
        NativeImageActions().save(Uint8List.fromList([1]), 'qa-image'),
        throwsA(isA<Exception>()),
      );
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(const MethodChannel('gal'), null);
    },
  );
}
