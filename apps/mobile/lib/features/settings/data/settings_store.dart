import 'package:shared_preferences/shared_preferences.dart';

abstract interface class SettingsStore {
  Future<Map<String, Object>> read();
  Future<void> write(String key, Object? value);
}

class SharedSettingsStore implements SettingsStore {
  @override
  Future<Map<String, Object>> read() async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.reload();
    return {
      for (final key in preferences.getKeys())
        if (preferences.get(key) case final Object value) key: value,
    };
  }

  @override
  Future<void> write(String key, Object? value) async {
    final preferences = await SharedPreferences.getInstance();
    final saved = switch (value) {
      null => await preferences.remove(key),
      final bool value => await preferences.setBool(key, value),
      final String value => await preferences.setString(key, value),
      _ => throw ArgumentError.value(value),
    };
    if (!saved) throw StateError('Could not save settings.');
  }
}
