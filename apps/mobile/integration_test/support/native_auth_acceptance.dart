import 'package:local_auth/local_auth.dart';
import 'package:djl_mobile/features/settings/domain/device_owner_auth.dart';

// Observes real native results without changing them. No credentials or result
// descriptions are retained; unknown service failures never count as refusal.
class ObservedDeviceOwnerAuth implements DeviceOwnerAuth {
  ObservedDeviceOwnerAuth(this.delegate);
  final DeviceOwnerAuth delegate;
  bool? lastResult;
  int attempts = 0;
  int supportChecks = 0;
  LocalAuthExceptionCode? lastError;
  bool get refused =>
      lastResult == false || lastError == LocalAuthExceptionCode.userCanceled;
  @override
  Future<bool> isSupported() {
    supportChecks++;
    return delegate.isSupported();
  }

  @override
  Future<void> stop() => delegate.stop();
  @override
  Future<bool> authenticate() async {
    attempts++;
    lastResult = null;
    lastError = null;
    try {
      final result = await delegate.authenticate();
      lastResult = result;
      return result;
    } on LocalAuthException catch (error) {
      lastError = error.code;
      rethrow;
    }
  }
}
