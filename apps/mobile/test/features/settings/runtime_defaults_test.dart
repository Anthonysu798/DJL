import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/settings/data/settings_store.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'settings_controller_test.dart' show MemorySettingsStore;

const catalog = <Map<String, dynamic>>[
  {
    'id': 'codex::other',
    'model': 'other',
    'djlProvider': 'codex',
    'isDefault': true,
    'supportedReasoningEfforts': ['low'],
    'supportsFastMode': false,
  },
  {
    'id': 'codex::gpt-5.5',
    'model': 'gpt-5.5',
    'djlProvider': 'codex',
    'supportedReasoningEfforts': ['low', 'medium', 'high'],
    'defaultReasoningEffort': 'high',
  },
  {
    'id': 'codex::gpt-5.4-mini',
    'model': 'gpt-5.4-mini',
    'djlProvider': 'codex',
    'supportedReasoningEfforts': [],
  },
  {
    'id': 'claudeAgent::other',
    'model': 'other',
    'djlProvider': 'claudeAgent',
    'supportedReasoningEfforts': [
      {'reasoningEffort': 'high'},
    ],
    'supportsFastMode': false,
  },
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'runtime selections persist logical keys independently and recreate with raw provider identity',
    () async {
      SharedPreferences.setMockInitialValues({});
      final first = SettingsController(SharedSettingsStore());
      await first.load();
      await first.setRuntimeCatalog(catalog);
      await first.setRuntimeModel('claudeAgent::other');
      await first.setRuntimeAccess('auto-review');
      await first.setGitWriterModel('codex::gpt-5.4-mini');
      final second = SettingsController(SharedSettingsStore());
      await second.load();
      await second.setRuntimeCatalog(catalog);
      expect(second.runtimeDefaults.modelId, 'claudeAgent::other');
      expect(second.resolvedRuntime.modelName, 'other');
      expect(second.resolvedRuntime.model?['djlProvider'], 'claudeAgent');
      expect(second.resolvedRuntime.effort, 'high');
      expect(second.resolvedRuntime.access, 'auto-review');
      expect(second.gitWriterModel?['model'], 'gpt-5.4-mini');
      final saved = await SharedSettingsStore().read();
      expect(saved['codex.selectedModelId'], 'claudeAgent::other');
      expect(saved['codex.selectedReasoningEffort'], 'high');
      expect(saved['codex.selectedAccessMode'], 'auto-review');
      expect(saved['codex.selectedGitWriterModelId'], 'codex::gpt-5.4-mini');
      expect(saved.containsKey('codex.selectedServiceTier'), false);
    },
  );
  test(
    'Auto resolves GPT55 medium while model changes retain valid reasoning and Fast',
    () async {
      final settings = SettingsController(MemorySettingsStore());
      await settings.load();
      await settings.setRuntimeCatalog(catalog);
      expect(settings.resolvedRuntime.modelName, 'gpt-5.5');
      // Initial catalog resolution uses the model default; explicit Auto resets to medium.
      expect(settings.resolvedRuntime.effort, 'high');
      await settings.setRuntimeTier('fast');
      await settings.setRuntimeModel(null);
      expect(settings.resolvedRuntime.effort, 'medium');
      expect(settings.resolvedRuntime.serviceTier, 'fast');
      await settings.setRuntimeModel('codex::other');
      expect(settings.resolvedRuntime.effort, 'low');
      expect(settings.resolvedRuntime.serviceTier, 'default');
      await settings.setRuntimeEffort('unsupported');
      expect(settings.resolvedRuntime.effort, 'low');
      await settings.setRuntimeModel('codex::gpt-5.4-mini');
      expect(settings.resolvedRuntime.effort, isNull);
    },
  );
  test(
    'corrupt preferences parse safely without overwriting until real catalog normalization',
    () async {
      final store = MemorySettingsStore()
        ..values.addAll({
          'codex.selectedModelId': '  ',
          'codex.selectedReasoningEffort': 'high',
          'codex.selectedServiceTier': 'flex',
          'codex.selectedAccessMode': 'Full access',
          'codex.selectedGitWriterModelId': 12,
        });
      final before = Map.of(store.values), settings = SettingsController(store);
      await settings.load();
      expect(settings.runtimeDefaults.modelId, isNull);
      expect(settings.runtimeDefaults.effort, isNull);
      expect(settings.runtimeDefaults.access, 'on-request');
      expect(settings.runtimeDefaults.serviceTier, 'default');
      expect(store.values, before);
      await settings.setRuntimeCatalog([catalog.first]);
      expect(settings.resolvedRuntime.modelName, 'other');
      expect(settings.resolvedRuntime.effort, 'low');
      expect(settings.resolvedRuntime.serviceTier, 'default');
      expect(store.values.values, isNot(contains('__AUTO__')));
      expect(store.values.values, isNot(contains('__NORMAL__')));
    },
  );
  test(
    'writer fallback stays on supported Codex runner when runtime uses another provider',
    () async {
      final settings = SettingsController(MemorySettingsStore());
      await settings.load();
      await settings.setRuntimeCatalog(catalog);
      await settings.setRuntimeModel('claudeAgent::other');
      expect(settings.gitWriterModel?['model'], 'gpt-5.4-mini');
      await settings.setRuntimeCatalog([catalog[0], catalog[3]]);
      expect(settings.gitWriterModel?['id'], 'codex::other');
      await settings.setRuntimeCatalog([catalog[3]]);
      expect(settings.gitWriterModel, isNull);
    },
  );
  test(
    'failed preference reads block runtime writes and partial writes reload actual persisted state for retry',
    () async {
      final store = FailingRuntimeStore()..failRead = true;
      final settings = SettingsController(store);
      await settings.load();
      await settings.setRuntimeCatalog(catalog);
      expect(await settings.setRuntimeModel('codex::other'), false);
      expect(store.values, isEmpty);
      store.failRead = false;
      await settings.load();
      await settings.setRuntimeCatalog(catalog);
      store.failKey = 'codex.selectedReasoningEffort';
      expect(await settings.setRuntimeModel('codex::other'), false);
      expect(settings.error, contains('part'));
      // The model write succeeded before reasoning failed; UI reloads the actual stored record.
      expect(store.values['codex.selectedModelId'], 'codex::other');
      expect(settings.runtimeDefaults.modelId, 'codex::other');
      expect(settings.resolvedRuntime.effort, 'low');
      store.failKey = null;
      expect(await settings.retryRuntimeSave(), true);
      expect(settings.error, isNull);
      expect(store.values['codex.selectedReasoningEffort'], 'low');
    },
  );
  test(
    'catalog changes during preference writes persist the final supported normalization',
    () async {
      final store = DelayedRuntimeStore();
      final controller = SettingsController(store);
      await controller.load();
      await controller.setRuntimeCatalog(catalog);
      store.gate = Completer<void>();
      final saving = controller.setRuntimeModel(null);
      await Future<void>.delayed(Duration.zero);
      await controller.setRuntimeCatalog([catalog.first]);
      store.gate!.complete();
      expect(await saving, true);
      expect(controller.resolvedRuntime.modelName, 'other');
      expect(store.values['codex.selectedModelId'], 'codex::other');
      expect(store.values['codex.selectedReasoningEffort'], 'low');
      controller.dispose();
    },
  );
  test(
    'catalog normalization matches raw aliases and reasoning fallback order without unsupported Fast',
    () async {
      final store = MemorySettingsStore()
        ..values.addAll({
          'codex.selectedModelId': 'gpt-5.5',
          'codex.selectedReasoningEffort': 'invalid',
          'codex.selectedServiceTier': 'fast',
        });
      final settings = SettingsController(store);
      await settings.load();
      await settings.setRuntimeCatalog([
        {
          'id': 'codex::gpt-5.5',
          'model': 'gpt-5.5',
          'djlProvider': 'codex',
          'defaultReasoningEffort': 'invalid',
          'supportedReasoningEfforts': [
            {'value': 'low'},
            {'value': 'medium'},
          ],
          'supportsFastMode': false,
        },
      ]);
      expect(settings.runtimeDefaults.modelId, 'codex::gpt-5.5');
      expect(settings.resolvedRuntime.effort, 'medium');
      expect(settings.resolvedRuntime.serviceTier, 'default');
      await settings.setRuntimeCatalog([
        {
          'id': 'first',
          'supportedReasoningEfforts': ['low'],
        },
        {
          'id': 'advertised',
          'isDefault': true,
          'supportedReasoningEfforts': ['high'],
        },
      ]);
      expect(settings.runtimeDefaults.modelId, 'advertised');
      expect(settings.resolvedRuntime.effort, 'high');
      await settings.setRuntimeCatalog([
        {
          'id': 'first',
          'supportedReasoningEfforts': ['low'],
        },
        {'id': 'second'},
      ]);
      expect(settings.runtimeDefaults.modelId, 'first');
      expect(settings.resolvedRuntime.effort, 'low');
    },
  );
}

class FailingRuntimeStore extends MemorySettingsStore {
  String? failKey;
  @override
  Future<void> write(String key, Object? value) async {
    if (key == failKey) throw StateError('disk full');
    return super.write(key, value);
  }
}

class DelayedRuntimeStore extends MemorySettingsStore {
  Completer<void>? gate;
  @override
  Future<void> write(String key, Object? value) async {
    await gate?.future;
    return super.write(key, value);
  }
}
