import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../../../l10n/l10n.dart';

enum AppFontStyle {
  system('System', null),
  geist('Geist', 'Geist'),
  geistMono('Geist Mono', 'GeistMono'),
  jetBrainsMono('JetBrains Mono', 'JetBrainsMono');

  const AppFontStyle(this.title, this.family);
  final String title;
  final String? family;
  String get codeFamily => this == geistMono ? 'GeistMono' : 'JetBrainsMono';
  String label(AppLocalizations l10n) =>
      this == system ? l10n.settingsFontSystem : title;
}

@immutable
class DjlAppearance extends ThemeExtension<DjlAppearance> {
  const DjlAppearance({
    this.font = AppFontStyle.system,
    this.liquidGlass = true,
  });
  final AppFontStyle font;
  final bool liquidGlass;

  static DjlAppearance of(BuildContext context) =>
      Theme.of(context).extension<DjlAppearance>() ?? const DjlAppearance();

  MarkdownStyleSheet markdown(BuildContext context, {Color? foreground}) {
    final theme = Theme.of(context);
    return MarkdownStyleSheet.fromTheme(
      theme.copyWith(
        textTheme: theme.textTheme.apply(
          bodyColor: foreground,
          displayColor: foreground,
        ),
      ),
    ).copyWith(
      code: TextStyle(
        fontFamily: font.codeFamily,
        fontSize: 13,
        color: foreground,
      ),
    );
  }

  @override
  DjlAppearance copyWith({AppFontStyle? font, bool? liquidGlass}) =>
      DjlAppearance(
        font: font ?? this.font,
        liquidGlass: liquidGlass ?? this.liquidGlass,
      );
  @override
  DjlAppearance lerp(covariant DjlAppearance? other, double t) =>
      t < .5 ? this : other ?? this;
}
