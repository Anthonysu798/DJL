/// Validation shared with the original Swift CloudAuthFormState.
abstract final class AuthFormRules {
  static String normalizedEmail(String value) => value.trim().toLowerCase();
  static bool validCode(String value) => RegExp(r'^[0-9]{6}$').hasMatch(value);
  // Dart String.length, like Swift's utf16.count, counts UTF-16 code units.
  static bool validPassword(String value) =>
      value.length >= 10 && value.length <= 256;
  static bool validEmail(String value) => normalizedEmail(value).contains('@');
}
