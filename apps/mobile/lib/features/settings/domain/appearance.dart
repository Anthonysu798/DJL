import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

enum AppFontStyle {
  system('System', null),
  geist('Geist', 'Geist'),
  geistMono('Geist Mono', 'GeistMono'),
  jetBrainsMono('JetBrains Mono', 'JetBrainsMono');

  const AppFontStyle(this.title, this.family);
  final String title;
  final String? family;
  String get codeFamily => this == geistMono ? 'GeistMono' : 'JetBrainsMono';
}

enum UserBubbleColor {
  defaultColor('default', 'Default'),
  red('red', 'Red'),
  orange('orange', 'Orange'),
  yellow('yellow', 'Yellow'),
  green('green', 'Green'),
  mint('mint', 'Mint'),
  blue('blue', 'Blue'),
  indigo('indigo', 'Indigo'),
  teal('teal', 'Teal'),
  cyan('cyan', 'Cyan'),
  pink('pink', 'Pink'),
  purple('purple', 'Purple'),
  brown('brown', 'Brown'),
  black('black', 'Primary');

  const UserBubbleColor(this.storedValue, this.title);
  final String storedValue, title;

  Color swatch(ColorScheme scheme) {
    final dark = scheme.brightness == Brightness.dark;
    return switch (this) {
      defaultColor => dark ? const Color(0xff48484a) : const Color(0xffc7c7cc),
      red => Color(dark ? 0xffff453a : 0xffff3b30),
      orange => Color(dark ? 0xffff9f0a : 0xffff9500),
      yellow => Color(dark ? 0xffffd60a : 0xffffcc00),
      green => Color(dark ? 0xff30d158 : 0xff34c759),
      mint => Color(dark ? 0xff63e6e2 : 0xff00c7be),
      blue => Color(dark ? 0xff0a84ff : 0xff007aff),
      indigo => Color(dark ? 0xff5e5ce6 : 0xff5856d6),
      teal => Color(dark ? 0xff40c8e0 : 0xff30b0c7),
      cyan => Color(dark ? 0xff64d2ff : 0xff32ade6),
      pink => Color(dark ? 0xffff52b3 : 0xffff2e9e),
      purple => Color(dark ? 0xffbf5af2 : 0xffaf52de),
      brown => Color(dark ? 0xffac8e68 : 0xffa2845e),
      black => scheme.onSurface,
    };
  }

  Color background(ColorScheme scheme) => this == defaultColor
      ? scheme.surfaceContainerHigh
      : swatch(
          scheme,
        ).withValues(alpha: scheme.brightness == Brightness.dark ? .9 : 1);
  Color foreground(ColorScheme scheme) => switch (this) {
    defaultColor => scheme.onSurface,
    black => scheme.surface,
    _ => Colors.white,
  };
}

@immutable
class DjlAppearance extends ThemeExtension<DjlAppearance> {
  const DjlAppearance({
    this.font = AppFontStyle.system,
    this.bubble = UserBubbleColor.defaultColor,
    this.liquidGlass = true,
  });
  final AppFontStyle font;
  final UserBubbleColor bubble;
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
  DjlAppearance copyWith({
    AppFontStyle? font,
    UserBubbleColor? bubble,
    bool? liquidGlass,
  }) => DjlAppearance(
    font: font ?? this.font,
    bubble: bubble ?? this.bubble,
    liquidGlass: liquidGlass ?? this.liquidGlass,
  );
  @override
  DjlAppearance lerp(covariant DjlAppearance? other, double t) =>
      t < .5 ? this : other ?? this;
}
