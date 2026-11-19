import 'package:flutter/cupertino.dart' show CupertinoThemeData;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../core/design/djl_tokens.dart';
import '../features/settings/domain/appearance.dart';

ThemeData djlTheme(
  Brightness brightness, {
  AppFontStyle font = AppFontStyle.system,
  bool liquidGlass = true,
}) {
  final dark = brightness == Brightness.dark;
  final colors = dark ? DjlColors.dark : DjlColors.light;
  // Every Material role is pinned to a token so no tinted default leaks in.
  final scheme = ColorScheme(
    brightness: brightness,
    primary: colors.ink,
    onPrimary: colors.onInk,
    primaryContainer: colors.surfaceSunken,
    onPrimaryContainer: colors.ink,
    secondary: colors.ink,
    onSecondary: colors.onInk,
    secondaryContainer: colors.surfaceSunken,
    onSecondaryContainer: colors.ink,
    tertiary: colors.ink,
    onTertiary: colors.onInk,
    tertiaryContainer: colors.surfaceSunken,
    onTertiaryContainer: colors.ink,
    error: colors.danger,
    onError: colors.onInk,
    errorContainer: colors.surfaceRaised,
    onErrorContainer: colors.danger,
    surface: colors.surface,
    onSurface: colors.ink,
    onSurfaceVariant: colors.inkMuted,
    surfaceDim: colors.surfaceSunken,
    surfaceBright: colors.surface,
    surfaceContainerLowest: colors.surface,
    surfaceContainerLow: colors.surfaceRaised,
    surfaceContainer: colors.surfaceRaised,
    surfaceContainerHigh: colors.surfaceSunken,
    surfaceContainerHighest: colors.surfaceSunken,
    outline: colors.inkFaint,
    outlineVariant: colors.hairline,
    inverseSurface: colors.ink,
    onInverseSurface: colors.onInk,
    inversePrimary: colors.onInk,
    surfaceTint: Colors.transparent,
    shadow: const Color(0xff000000),
    scrim: const Color(0xff000000),
  );
  // Android gets the bundled grotesk; iOS keeps the system face.
  final family =
      font.family ??
      (defaultTargetPlatform == TargetPlatform.android ? 'Geist' : null);
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: family,
    splashFactory: NoSplash.splashFactory,
    highlightColor: Colors.transparent,
  );
  TextStyle? style(TextStyle? from, double size, FontWeight weight) =>
      from?.copyWith(
        fontSize: size,
        fontWeight: weight,
        letterSpacing: size >= 20 ? -.2 : 0,
        color: colors.ink,
      );
  final text = base.textTheme;
  return base.copyWith(
    textTheme: text.copyWith(
      headlineLarge: style(text.headlineLarge, 30, FontWeight.w700),
      headlineMedium: style(text.headlineMedium, 22, FontWeight.w700),
      headlineSmall: style(text.headlineSmall, 18, FontWeight.w600),
      titleLarge: style(text.titleLarge, 20, FontWeight.w600),
      titleMedium: style(text.titleMedium, 16, FontWeight.w600),
      titleSmall: style(text.titleSmall, 14, FontWeight.w600),
      bodyLarge: style(text.bodyLarge, 16, FontWeight.w400),
      bodyMedium: style(text.bodyMedium, 15, FontWeight.w400),
      bodySmall: style(
        text.bodySmall,
        13,
        FontWeight.w400,
      )?.copyWith(color: colors.inkMuted),
      labelLarge: style(text.labelLarge, 15, FontWeight.w600),
      labelMedium: style(
        text.labelMedium,
        12,
        FontWeight.w500,
      )?.copyWith(color: colors.inkMuted),
      labelSmall: style(
        text.labelSmall,
        11,
        FontWeight.w500,
      )?.copyWith(color: colors.inkMuted),
    ),
    extensions: [
      colors,
      DjlAppearance(font: font, liquidGlass: liquidGlass),
    ],
    cupertinoOverrideTheme: CupertinoThemeData(
      brightness: brightness,
      primaryColor: colors.ink,
      scaffoldBackgroundColor: colors.surface,
      barBackgroundColor: colors.surface,
    ),
    scaffoldBackgroundColor: colors.surface,
    iconTheme: IconThemeData(color: colors.ink, size: 22),
    appBarTheme: AppBarTheme(
      backgroundColor: colors.surface,
      foregroundColor: colors.ink,
      scrolledUnderElevation: 0,
      elevation: 0,
      centerTitle: false,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.surfaceRaised,
      hintStyle: TextStyle(color: colors.inkMuted),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(DjlRadius.md),
        borderSide: BorderSide.none,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 52),
        shape: const StadiumBorder(),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: colors.ink),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: colors.ink,
      foregroundColor: colors.onInk,
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: colors.ink),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: colors.ink,
      selectionColor: colors.ink.withValues(alpha: .18),
      selectionHandleColor: colors.ink,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
      // The hairline keeps a sheet's edge visible on a black page.
      shape: RoundedRectangleBorder(
        side: BorderSide(color: colors.hairline),
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(DjlRadius.lg),
        ),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: colors.hairline),
        borderRadius: BorderRadius.circular(DjlRadius.lg),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: colors.ink,
      contentTextStyle: TextStyle(color: colors.onInk, fontSize: 14),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(DjlRadius.md),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) return null;
        return states.contains(WidgetState.selected)
            ? colors.onInk
            : colors.surface;
      }),
      trackColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) return null;
        return states.contains(WidgetState.selected)
            ? colors.ink
            : colors.inkFaint;
      }),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
      trackOutlineWidth: const WidgetStatePropertyAll(0),
    ),
    dividerTheme: DividerThemeData(color: colors.hairline, space: 1),
  );
}
