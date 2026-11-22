import 'package:flutter/material.dart';

/// The whole palette: black, white and neutral grays, plus one red for
/// destructive and failed states. Agent avatars are the only other colour.
@immutable
class DjlColors extends ThemeExtension<DjlColors> {
  const DjlColors({
    required this.ink,
    required this.inkMuted,
    required this.inkFaint,
    required this.onInk,
    required this.surface,
    required this.surfaceRaised,
    required this.surfaceSunken,
    required this.hairline,
    required this.danger,
  });

  /// Primary text and filled controls.
  final Color ink;

  /// Secondary text. Passes AA on [surface] and [surfaceRaised].
  final Color inkMuted;

  /// Placeholder glyphs and disabled controls. Not for body text.
  final Color inkFaint;

  /// Text and icons on an [ink] fill.
  final Color onInk;
  final Color surface;

  /// Grouped rows, inputs and quiet buttons.
  final Color surfaceRaised;

  /// Pressed and selected fills.
  final Color surfaceSunken;
  final Color hairline;
  final Color danger;

  static const light = DjlColors(
    ink: Color(0xff0a0a0a),
    inkMuted: Color(0xff5c5c5c),
    inkFaint: Color(0xff8f8f8f),
    onInk: Color(0xffffffff),
    surface: Color(0xffffffff),
    surfaceRaised: Color(0xfff4f4f4),
    surfaceSunken: Color(0xffe8e8e8),
    hairline: Color(0xffe0e0e0),
    danger: Color(0xffc4261c),
  );

  static const dark = DjlColors(
    ink: Color(0xfff5f5f5),
    inkMuted: Color(0xffa6a6a6),
    inkFaint: Color(0xff6b6b6b),
    onInk: Color(0xff000000),
    surface: Color(0xff000000),
    surfaceRaised: Color(0xff161616),
    surfaceSunken: Color(0xff242424),
    hairline: Color(0xff2b2b2b),
    danger: Color(0xffff6b5e),
  );

  static DjlColors of(BuildContext context) =>
      Theme.of(context).extension<DjlColors>() ??
      (Theme.of(context).brightness == Brightness.dark ? dark : light);

  @override
  DjlColors copyWith() => this;

  @override
  DjlColors lerp(covariant DjlColors? other, double t) =>
      t < .5 ? this : other ?? this;
}

/// 4-point spacing scale.
abstract final class DjlSpace {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;

  /// Side gutter for page content.
  static const double page = 20;
}

/// One corner scale for the whole app.
abstract final class DjlRadius {
  /// Chips, thumbnails, code blocks.
  static const double sm = 10;

  /// Rows, inputs, cards.
  static const double md = 16;

  /// Sheets, bubbles, floating glass.
  static const double lg = 24;

  /// Buttons and anything fully rounded.
  static const double pill = 999;
}

/// Motion conveys state only. Callers skip it when animations are disabled.
abstract final class DjlMotion {
  static const fast = Duration(milliseconds: 150);
  static const base = Duration(milliseconds: 220);
  static const curve = Cubic(.22, 1, .36, 1);

  static Duration of(BuildContext context, [Duration duration = base]) =>
      MediaQuery.disableAnimationsOf(context) ? Duration.zero : duration;
}
