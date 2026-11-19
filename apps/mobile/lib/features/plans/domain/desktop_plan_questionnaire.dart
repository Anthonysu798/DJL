import '../../pairing/data/pairing_repository.dart';

class DesktopPlanQuestionnaire {
  const DesktopPlanQuestionnaire({
    required this.questions,
    this.intro,
    this.outro,
  });
  final List<RemoteJson> questions;
  final String? intro, outro;

  static DesktopPlanQuestionnaire? parse(String text, {bool assistant = true}) {
    final lines = text.trim().split(RegExp(r'\r\n|\r|\n'));
    if (text.trim().isEmpty) return null;
    if (assistant && !_questionnaireCues.any(text.toLowerCase().contains)) {
      final choice = lines.indexWhere(
        (line) => [
          'one of these',
          'turn this into',
          'choose one',
          'pick one',
        ].any(line.trim().toLowerCase().contains),
      );
      if (choice >= 0) {
        final blocks = _blocks(lines.skip(choice + 1));
        final options = <RemoteJson>[];
        for (final block in blocks) {
          final parts = block.$2.where((s) => s.isNotEmpty).toList();
          if (parts.isNotEmpty) {
            options.add({
              'label': parts.first,
              'description': parts.skip(1).join('\n'),
            });
          }
        }
        if (options.length >= 2) {
          return DesktopPlanQuestionnaire(
            intro: _normalize(lines.take(choice)),
            questions: [
              _question(
                'inferred_plan_next_step',
                'What should Codex produce next?',
                options,
                header: 'Next step',
              ),
            ],
          );
        }
      }
      final numbered = lines.where((line) => _numbered(line) != null).length;
      final bullets = lines
          .where((line) => _bullet(line.trim()) != null)
          .length;
      if (!(numbered >= 2 && text.contains('?') ||
          numbered >= 1 && bullets > 0)) {
        return null;
      }
    }
    final first = lines.indexWhere((line) => _numbered(line) != null);
    if (first < 0) return null;
    final parsed = <(RemoteJson?, List<String>)>[];
    for (final block in _blocks(lines.skip(first))) {
      final prompts = <String>[], options = <String>[], outro = <String>[];
      var reachedOutro = false;
      for (final line in block.$2) {
        if (line.isEmpty) {
          if (reachedOutro) {
            outro.add(line);
          } else if (options.isEmpty) {
            prompts.add(line);
          }
          continue;
        }
        if (_outroCues.any(line.toLowerCase().startsWith)) reachedOutro = true;
        if (reachedOutro) {
          outro.add(line);
        } else if (_bullet(line) case final bullet?) {
          options.add(bullet);
        } else if (options.isNotEmpty) {
          options[options.length - 1] = '${options.last} $line'.trim();
        } else {
          prompts.add(line);
        }
      }
      var prompt = _normalize(prompts) ?? '';
      if (prompt.isEmpty) {
        parsed.add((null, outro));
        continue;
      }
      if (options.isEmpty && prompt.endsWith('?') && prompt.contains(':')) {
        final colon = prompt.indexOf(':');
        final labels = prompt
            .substring(colon + 1, prompt.length - 1)
            .replaceAll(
              RegExp(r', or | or |, and | and ', caseSensitive: false),
              ', ',
            )
            .split(',')
            .map((s) => s.trim())
            .where((s) => s.isNotEmpty)
            .toList();
        if (labels.length >= 2 && labels.length <= 6) {
          prompt = '${prompt.substring(0, colon).trim()}?';
          options.addAll(labels);
        }
      }
      final lower = prompt.toLowerCase();
      final limit = ['up to two', 'choose two', 'pick two'].any(lower.contains)
          ? 2
          : ['up to three', 'choose three', 'pick three'].any(lower.contains)
          ? 3
          : null;
      parsed.add((
        _question('inferred_plan_q_${block.$1}', prompt, [
          for (final label in options) {'label': label, 'description': ''},
        ], limit: limit),
        outro,
      ));
    }
    bool questionLike(RemoteJson? q) =>
        q != null &&
        ((q['question'] as String).contains('?') ||
            (q['options'] as List).isNotEmpty);
    while (parsed.isNotEmpty && !questionLike(parsed.last.$1)) {
      parsed.removeLast();
    }
    if (parsed.isEmpty || parsed.any((q) => !questionLike(q.$1))) return null;
    final questions = parsed.map((q) => q.$1!).toList();
    if (questions.length < 2 && (questions.single['options'] as List).isEmpty) {
      return null;
    }
    return DesktopPlanQuestionnaire(
      intro: _normalize(lines.take(first)),
      questions: questions,
      outro: _normalize(parsed.expand((q) => q.$2)),
    );
  }
}

const _questionnaireCues = [
  'questions for you',
  'question for you',
  'quick questions',
  'a few questions',
  'need your input',
  'need your answer',
  'need your answers',
  'answer these',
  'once you answer',
  'if you answer',
  'when you answer',
  'after you answer',
];
const _outroCues = [
  'once you answer',
  'if you answer',
  'when you answer',
  'after you answer',
  'i’ll turn this into',
  "i'll turn this into",
  'then i’ll',
  "then i'll",
];

RemoteJson _question(
  String id,
  String prompt,
  List<RemoteJson> options, {
  String header = '',
  int? limit,
}) => {
  'id': id,
  'header': header,
  'question': prompt,
  'isOther': false,
  'isSecret': false,
  'selectionLimit': ?limit,
  'options': options,
};

(int, String)? _numbered(String line) {
  final normalized = line.trim().replaceAll(RegExp(r'^\**\s*|\s*\**$'), '');
  final match = RegExp(r'^(\d+)[.)]\s+').firstMatch(normalized);
  final number = int.tryParse(match?.group(1) ?? '');
  return number == null
      ? null
      : (number, normalized.substring(match!.end).trim());
}

List<(int, List<String>)> _blocks(Iterable<String> lines) {
  final blocks = <(int, List<String>)>[];
  for (final raw in lines) {
    if (_numbered(raw) case final next?) {
      blocks.add((next.$1, [next.$2]));
    } else if (blocks.isNotEmpty) {
      blocks.last.$2.add(raw.trim());
    }
  }
  return blocks;
}

String? _bullet(String line) {
  for (final prefix in ['• ', '- ', '* ', '+ ', '•', '-', '*', '+']) {
    if (line.startsWith(prefix)) return line.substring(prefix.length).trim();
  }
  return null;
}

String? _normalize(Iterable<String> lines) {
  final result = <String>[];
  for (final raw in lines) {
    final line = raw.trim();
    if (line.isNotEmpty || result.isEmpty || result.last.isNotEmpty) {
      result.add(line);
    }
  }
  final text = result.join('\n').trim();
  return text.isEmpty ? null : text;
}

String? desktopLegacyProposedPlan(String text) {
  final body = text.trim();
  if (body.isEmpty ||
      RegExp(
        r'<proposed_plan>[\s\S]*?</proposed_plan>',
        caseSensitive: false,
      ).hasMatch(body)) {
    return null;
  }
  if (RegExp(r'^\s*\d+[.)]\s+.+$', multiLine: true).allMatches(body).length <
      2) {
    return null;
  }
  final first = body.split(RegExp(r'\r\n|\r|\n')).first.trim().toLowerCase();
  return [
        'plan',
        'roadmap',
        'proposal',
        'approach',
        'implementation',
      ].any(first.contains)
      ? body
      : null;
}
