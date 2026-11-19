import '../../pairing/data/pairing_repository.dart';

String desktopModelName(String identifier, {String? fallback}) {
  final name = identifier.trim();
  const titles = {
    'gpt-5.5': 'GPT-5.5',
    'gpt-5.4': 'GPT-5.4',
    'gpt-5.4-mini': 'GPT-5.4-Mini',
    'gpt-5.3-codex': 'GPT-5.3-Codex',
    'gpt-5.2-codex': 'GPT-5.2-Codex',
    'gpt-5.1-codex-max': 'GPT-5.1-Codex-Max',
    'gpt-5.2': 'GPT-5.2',
    'gpt-5.1-codex-mini': 'GPT-5.1-Codex-Mini',
  };
  if (titles[name.toLowerCase()] case final title?) return title;
  if (fallback?.trim().isNotEmpty == true) return fallback!.trim();
  return name.toLowerCase().startsWith('gpt-')
      ? 'GPT-${name.substring(4)}'
      : name;
}

String desktopModelTitle(RemoteJson model) => desktopModelName(
  '${model['model'] ?? model['id'] ?? ''}',
  fallback: (model['displayName'] ?? model['display_name']) as String?,
);

String? desktopModelProvider(RemoteJson model) {
  final value =
      (model['providerDisplayName'] ?? model['provider_display_name'])
          as String?;
  return value?.trim().isNotEmpty == true ? value!.trim() : null;
}

List<RemoteJson> orderedDesktopModels(List<RemoteJson> models) {
  const preferred = [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.1-codex-max',
    'gpt-5.2',
    'gpt-5.1-codex-mini',
  ];
  int rank(RemoteJson model) {
    final index = preferred.indexOf(
      '${model['model'] ?? model['id']}'.toLowerCase(),
    );
    return index < 0 ? preferred.length : index;
  }

  return List<RemoteJson>.of(models)..sort((a, b) {
    final order = rank(a).compareTo(rank(b));
    return order == 0
        ? desktopModelTitle(b).compareTo(desktopModelTitle(a))
        : order;
  });
}

String desktopReasoningTitle(String effort) {
  final normalized = effort.trim().toLowerCase();
  return switch (normalized) {
    'minimal' || 'low' => 'Low',
    'medium' => 'Medium',
    'high' => 'High',
    'xhigh' ||
    'extra_high' ||
    'extra-high' ||
    'very_high' ||
    'very-high' => 'Extra High',
    _ =>
      normalized
          .split('_')
          .map(
            (word) => word.isEmpty
                ? word
                : '${word[0].toUpperCase()}${word.substring(1)}',
          )
          .join(' '),
  };
}

List<String> orderedDesktopEfforts(List<String> efforts) {
  const rank = {'Low': 0, 'Medium': 1, 'High': 2, 'Exceptional': 3};
  return List<String>.of(efforts)..sort((a, b) {
    final left = desktopReasoningTitle(a), right = desktopReasoningTitle(b);
    final order = (rank[left] ?? 4).compareTo(rank[right] ?? 4);
    return order == 0 ? left.compareTo(right) : order;
  });
}
