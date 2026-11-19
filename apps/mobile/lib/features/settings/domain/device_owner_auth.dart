import 'package:local_auth/local_auth.dart';

abstract interface class DeviceOwnerAuth {
  Future<bool> isSupported();
  Future<bool> authenticate();
  Future<void> stop();
}

class NativeDeviceOwnerAuth implements DeviceOwnerAuth {
  final _auth = LocalAuthentication();
  @override
  Future<bool> isSupported() => _auth.isDeviceSupported();
  @override
  Future<bool> authenticate() => _auth.authenticate(
    localizedReason: 'Unlock DJL and your remote coding sessions.',
    biometricOnly: false,
    persistAcrossBackgrounding: false,
  );
  @override
  Future<void> stop() async {
    await _auth.stopAuthentication();
  }
}
