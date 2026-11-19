import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final binding = LiveTestWidgetsFlutterBinding();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.onlyPumps;

  testWidgets('native adapter device input requires propagation opt-in', (
    tester,
  ) async {
    var presses = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => presses++,
              child: const Text('System settings'),
            ),
          ),
        ),
      ),
    );
    final position = tester.getCenter(find.byType(TextButton));
    void deviceTap(int pointer) {
      binding.handlePointerEventForSource(
        PointerDownEvent(pointer: pointer, position: position),
        source: TestBindingEventSource.device,
      );
      binding.handlePointerEventForSource(
        PointerUpEvent(pointer: pointer, position: position),
        source: TestBindingEventSource.device,
      );
    }

    binding.shouldPropagateDevicePointerEvents = false;
    deviceTap(1);
    await tester.pump();
    expect(presses, 0);

    binding.shouldPropagateDevicePointerEvents = true;
    deviceTap(2);
    await tester.pump();
    binding.shouldPropagateDevicePointerEvents = false;
    expect(presses, 1);
  });
}
