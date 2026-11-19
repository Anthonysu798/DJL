import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controls.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'runtime_defaults_test.dart' show catalog;
import 'settings_controller_test.dart' show MemorySettingsStore;

void main() {
  testWidgets('Settings hides defaults and retains saved model preferences', (
    tester,
  ) async {
    final store = MemorySettingsStore()
      ..values.addAll({
        'codex.selectedModelId': 'codex::gpt-5.5',
        'codex.selectedReasoningEffort': 'medium',
      });
    final settings = SettingsController(store);
    addTearDown(settings.dispose);
    await settings.load();
    final saved = Map.of(store.values);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: SettingsControls(controller: settings)),
      ),
    );

    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Composer Defaults'), findsNothing);
    expect(
      find.text('Connect a Mac to load its available models.'),
      findsNothing,
    );
    await settings.setRuntimeCatalog(catalog);
    await tester.pumpAndSettle();
    expect(find.text('Composer Defaults'), findsNothing);
    expect(find.text('Git Writer'), findsNothing);
    expect(settings.resolvedRuntime.modelName, 'gpt-5.5');
    expect(settings.resolvedRuntime.effort, 'medium');
    expect(store.values, saved);
  });

  testWidgets('Settings keeps its read recovery without the defaults section', (
    tester,
  ) async {
    final store = MemorySettingsStore()..failRead = true;
    final settings = SettingsController(store);
    addTearDown(settings.dispose);
    await settings.load();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: SettingsControls(controller: settings)),
      ),
    );

    expect(find.text('Composer Defaults'), findsNothing);
    expect(
      find.textContaining('Could not read saved settings'),
      findsOneWidget,
    );
    store.failRead = false;
    await tester.tap(find.text('Retry reading settings'));
    await tester.pumpAndSettle();
    expect(settings.ready, isTrue);
    expect(find.text('Retry reading settings'), findsNothing);
  });
}
