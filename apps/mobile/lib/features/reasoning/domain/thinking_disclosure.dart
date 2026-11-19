class ThinkingDisclosureSection {
  const ThinkingDisclosureSection(this.id, this.title, this.detail);
  final String id, title, detail;
}

class ThinkingDisclosureContent {
  const ThinkingDisclosureContent(this.sections, this.fallbackText);
  final List<ThinkingDisclosureSection> sections;
  final String fallbackText;
}

abstract final class ThinkingDisclosureParser {
  static String normalized(String text) {
    var value = text.trim().replaceAll(
      RegExp(r'<!--\s*-->\s*(?=\*\*)'),
      '<!-- -->\n\n',
    );
    if (value.toLowerCase().startsWith('thinking...')) {
      value = value.substring(11).trim();
    }
    return value.toLowerCase() == 'thinking' ? '' : value;
  }

  static String _detail(List<String> lines) => lines
      .where((line) {
        final trimmed = line.trim();
        return !(trimmed.startsWith('<!--') && trimmed.endsWith('-->'));
      })
      .join('\n')
      .trim();
  static ThinkingDisclosureContent parse(String raw) {
    final text = normalized(raw);
    final sections = <ThinkingDisclosureSection>[];
    final preamble = <String>[], detail = <String>[];
    String? title;
    void flush() {
      if (title != null) {
        sections.add(
          ThinkingDisclosureSection(
            '${sections.length}-$title',
            title,
            _detail(detail),
          ),
        );
      }
      detail.clear();
    }

    for (final line in text.split('\n')) {
      final heading = RegExp(
        r'^\s*\*\*(.+?)\*\*\s*$',
      ).firstMatch(line)?.group(1)?.trim();
      if (heading != null && heading.isNotEmpty) {
        flush();
        title = heading;
      } else {
        (title == null ? preamble : detail).add(line);
      }
    }
    flush();
    final merged = <ThinkingDisclosureSection>[];
    for (final section in sections) {
      if (merged.isEmpty || merged.last.title != section.title) {
        merged.add(section);
        continue;
      }
      final previous = merged.removeLast();
      final String detail;
      if (previous.detail == section.detail || section.detail.isEmpty) {
        detail = previous.detail;
      } else if (previous.detail.isEmpty ||
          section.detail.contains(previous.detail)) {
        detail = section.detail;
      } else if (previous.detail.contains(section.detail)) {
        detail = previous.detail;
      } else {
        detail = '${previous.detail}\n\n${section.detail}';
      }
      merged.add(
        ThinkingDisclosureSection(previous.id, previous.title, detail),
      );
    }
    // Coalesce before prepending the preamble: matches the supplied Swift test.
    if (merged.isNotEmpty && _detail(preamble).isNotEmpty) {
      final first = merged.first;
      merged[0] = ThinkingDisclosureSection(
        first.id,
        first.title,
        [
          _detail(preamble),
          first.detail,
        ].where((s) => s.isNotEmpty).join('\n\n'),
      );
    }
    return ThinkingDisclosureContent(merged, text);
  }
}
