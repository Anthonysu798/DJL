import '../../desktop/domain/desktop_contract.dart';
import '../../pairing/data/pairing_repository.dart';

const runtimeModelKey = 'codex.selectedModelId';
const gitWriterModelKey = 'codex.selectedGitWriterModelId';
const runtimeEffortKey = 'codex.selectedReasoningEffort';
const runtimeTierKey = 'codex.selectedServiceTier';
const runtimeAccessKey = 'codex.selectedAccessMode';
const runtimeAccessModes = ['on-request', 'auto-review', 'full-access'];

String? _selection(Object? value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;

RemoteJson? runtimeModel(List<RemoteJson> models, String? id) => id == null
    ? null
    : models.where((m) => m['id'] == id || m['model'] == id).firstOrNull;

RemoteJson? fallbackRuntimeModel(List<RemoteJson> models) =>
    models
        .where(
          (m) =>
              '${m['id']}'.toLowerCase() == 'gpt-5.5' ||
              '${m['model']}'.toLowerCase() == 'gpt-5.5',
        )
        .firstOrNull ??
    models
        .where((m) => m['isDefault'] == true || m['is_default'] == true)
        .firstOrNull ??
    models.firstOrNull;

List<String> modelReasoningEfforts(RemoteJson? model) =>
    ((model?['supportedReasoningEfforts'] ??
                    model?['supported_reasoning_efforts'])
                as List? ??
            [])
        .map(
          (e) => _selection(
            e is Map
                ? e['reasoningEffort'] ??
                      e['reasoning_effort'] ??
                      e['effort'] ??
                      e['value']
                : e,
          ),
        )
        .whereType<String>()
        .toSet()
        .toList();

bool modelSupportsFast(RemoteJson? model) {
  if (model == null) return false;
  for (final key in [
    'supportsFastMode',
    'supports_fast_mode',
    'fastMode',
    'fast_mode',
    'fastServiceTier',
    'fast_service_tier',
  ]) {
    if (model[key] is bool) return model[key] as bool;
  }
  final tiers = [
    ...(model['additionalSpeedTiers'] as List? ?? []),
    ...(model['additional_speed_tiers'] as List? ?? []),
  ];
  return tiers.any((t) => '$t'.trim().toLowerCase() == 'fast') ||
      {
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.2-codex',
        'gpt-5.2',
      }.contains('${model['model'] ?? model['id']}'.trim().toLowerCase());
}

// Git draft RPCs run through the Codex runner and accept only a raw model.
List<RemoteJson> gitWriterModels(List<RemoteJson> models) => models
    .where((m) => m['djlProvider'] == null || m['djlProvider'] == 'codex')
    .toList();

class RuntimeDefaults {
  const RuntimeDefaults({
    this.modelId,
    this.effort,
    this.gitWriterId,
    this.serviceTier = 'default',
    this.access = 'on-request',
  });
  factory RuntimeDefaults.fromPreferences(Map<String, Object> values) {
    final model = _selection(values[runtimeModelKey]);
    return RuntimeDefaults(
      modelId: model,
      effort: model == null ? null : _selection(values[runtimeEffortKey]),
      gitWriterId: _selection(values[gitWriterModelKey]),
      serviceTier: _selection(values[runtimeTierKey]) == 'fast'
          ? 'fast'
          : 'default',
      access: runtimeAccessModes.contains(values[runtimeAccessKey])
          ? values[runtimeAccessKey] as String
          : 'on-request',
    );
  }
  final String? modelId, effort, gitWriterId;
  final String serviceTier, access;
  Map<String, Object?> get preferences => {
    runtimeModelKey: modelId,
    runtimeEffortKey: effort,
    runtimeTierKey: serviceTier == 'fast' ? 'fast' : null,
    runtimeAccessKey: access,
    gitWriterModelKey: gitWriterId,
  };
  RuntimeDefaults normalize(List<RemoteJson> models) {
    if (models.isEmpty) return this;
    final selected =
        runtimeModel(models, modelId) ?? fallbackRuntimeModel(models);
    final supported = modelReasoningEfforts(selected);
    final modelDefault =
        selected?['defaultReasoningEffort'] ??
        selected?['default_reasoning_effort'];
    return RuntimeDefaults(
      modelId: selected?['id'] as String?,
      effort: supported.contains(effort)
          ? effort
          : supported.contains(modelDefault)
          ? modelDefault as String
          : supported.contains('medium')
          ? 'medium'
          : supported.firstOrNull,
      serviceTier: serviceTier == 'fast' && modelSupportsFast(selected)
          ? 'fast'
          : 'default',
      access: access,
      gitWriterId: runtimeModel(gitWriterModels(models), gitWriterId) == null
          ? null
          : gitWriterId,
    );
  }

  DesktopRuntime resolve(List<RemoteJson> models) {
    final normalized = normalize(models);
    return DesktopRuntime(
      model: runtimeModel(models, normalized.modelId),
      effort: normalized.effort,
      access: normalized.access,
      serviceTier: normalized.serviceTier,
    );
  }

  RemoteJson? resolveGitWriter(List<RemoteJson> models, {String? explicitId}) {
    final writers = gitWriterModels(models);
    return runtimeModel(writers, explicitId ?? gitWriterId) ??
        runtimeModel(writers, 'gpt-5.4-mini') ??
        runtimeModel(writers, modelId) ??
        fallbackRuntimeModel(writers);
  }
}
