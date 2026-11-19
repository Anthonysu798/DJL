import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const _channel = MethodChannel('djl.mobile/app-info');

// Existing ASCII widget journeys do not run an iOS/Android platform engine.
void useAsciiNativeSearch() {
  TestWidgetsFlutterBinding.ensureInitialized();
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(_channel, (call) async {
        if (call.method != 'searchMatches') throw MissingPluginException();
        final arguments = call.arguments as Map;
        final query = arguments['query'] as String;
        expect(query.codeUnits.every((unit) => unit < 128), isTrue);
        final titles = (arguments['titles'] as List).cast<String>();
        return titles.indexed
            .where(
              (entry) => entry.$2.toLowerCase().contains(query.toLowerCase()),
            )
            .map((entry) => entry.$1)
            .toList();
      });
}

void clearNativeSearchFixture() => TestDefaultBinaryMessengerBinding
    .instance
    .defaultBinaryMessenger
    .setMockMethodCallHandler(_channel, null);
