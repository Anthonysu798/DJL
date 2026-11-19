import 'package:flutter/material.dart';
import '../features/settings/domain/appearance.dart';

ThemeData djlTheme(
  Brightness brightness, {
  AppFontStyle font = AppFontStyle.system,
  UserBubbleColor bubble = UserBubbleColor.defaultColor,
  bool liquidGlass = true,
}) {
  final dark = brightness == Brightness.dark;
  final scheme =
      ColorScheme.fromSeed(
        seedColor: Colors.black,
        brightness: brightness,
        dynamicSchemeVariant: DynamicSchemeVariant.monochrome,
      ).copyWith(
        primary: dark ? Colors.white : Colors.black,
        onPrimary: dark ? Colors.black : Colors.white,
        secondary: dark ? Colors.white : Colors.black,
        onSecondary: dark ? Colors.black : Colors.white,
        surface: dark ? Colors.black : Colors.white,
        onSurface: dark ? Colors.white : Colors.black,
        onSurfaceVariant: Color(dark ? 0xffb3b3b3 : 0xff626262),
        surfaceContainerLow: Color(dark ? 0xff1c1c1c : 0xfff2f2f2),
        surfaceContainerHigh: Color(dark ? 0xff2c2c2c : 0xffe5e5e5),
        outlineVariant: Color(dark ? 0xff3a3a3a : 0xffd4d4d4),
      );
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: font.family,
  );
  return base.copyWith(
    textTheme: base.textTheme.copyWith(
      headlineLarge: base.textTheme.headlineLarge?.copyWith(
        fontSize: 30,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      ),
      headlineMedium: base.textTheme.headlineMedium?.copyWith(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      ),
      headlineSmall: base.textTheme.headlineSmall?.copyWith(
        fontSize: 18,
        fontWeight: FontWeight.w500,
        letterSpacing: 0,
      ),
      titleLarge: base.textTheme.titleLarge?.copyWith(
        fontSize: 20,
        letterSpacing: 0,
      ),
      titleMedium: base.textTheme.titleMedium?.copyWith(
        fontSize: 15.5,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      ),
      titleSmall: base.textTheme.titleSmall?.copyWith(
        fontSize: 14,
        letterSpacing: 0,
      ),
      bodyLarge: base.textTheme.bodyLarge?.copyWith(
        fontSize: 15,
        letterSpacing: 0,
      ),
      bodyMedium: base.textTheme.bodyMedium?.copyWith(
        fontSize: 15,
        letterSpacing: 0,
      ),
      bodySmall: base.textTheme.bodySmall?.copyWith(
        fontSize: 12,
        letterSpacing: 0,
      ),
      labelLarge: base.textTheme.labelLarge?.copyWith(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
      ),
      labelMedium: base.textTheme.labelMedium?.copyWith(
        fontSize: 11,
        letterSpacing: 0,
      ),
      labelSmall: base.textTheme.labelSmall?.copyWith(
        fontSize: 10,
        letterSpacing: 0,
      ),
    ),
    extensions: [
      DjlAppearance(font: font, bubble: bubble, liquidGlass: liquidGlass),
    ],
    scaffoldBackgroundColor: scheme.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: scheme.surfaceContainerLow,
      hintStyle: TextStyle(color: scheme.onSurfaceVariant),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide.none,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
      ),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: scheme.primary,
      foregroundColor: scheme.onPrimary,
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) return null;
        return states.contains(WidgetState.selected)
            ? scheme.onPrimary
            : Colors.white;
      }),
      trackColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) return null;
        return states.contains(WidgetState.selected)
            ? scheme.primary
            : scheme.outline;
      }),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
      trackOutlineWidth: const WidgetStatePropertyAll(0),
    ),
    dividerTheme: DividerThemeData(
      color: scheme.outlineVariant.withValues(alpha: .5),
      space: 1,
    ),
  );
}
