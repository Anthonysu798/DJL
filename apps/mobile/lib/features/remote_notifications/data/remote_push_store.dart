import 'package:shared_preferences/shared_preferences.dart';

abstract interface class RemotePushStore {
  Future<bool> read();
  Future<void> write(bool enabled);
}

class SharedRemotePushStore implements RemotePushStore {
  static const key = 'remoteNotificationsEnabled';
  @override
  Future<bool> read() async =>
      (await SharedPreferences.getInstance()).getBool(key) ?? false;
  @override
  Future<void> write(bool enabled) async {
    if (!await (await SharedPreferences.getInstance()).setBool(key, enabled)) {
      throw StateError('Could not save notification preference.');
    }
  }
}
