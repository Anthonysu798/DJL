import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:flutter/services.dart';

const nativeCredentialSentinel = 'qa.native_storage.sentinel.v1';
const nativeCredentialControl = 'qa.native_storage.control.v1';
const nativeCredentialSentinelValue = 'DJL public native storage sentinel v1';
const nativeCredentialControlValue = 'DJL public native storage control v1';

// QA only. Neither stored values nor native exception descriptions reach test
// failure output. The actual integration target supplies PlatformCredentialStore.
Future<void> runNativeCredentialPhase(
  CredentialStore store,
  String phase, {
  required bool android,
  bool cleanupApproved = false,
}) async {
  void require(bool allowed) {
    if (!allowed) throw StateError('Native credential QA phase refused.');
  }

  Future<void> verify() async {
    final sentinel = await store.read(nativeCredentialSentinel);
    final control = await store.read(nativeCredentialControl);
    require(
      sentinel == nativeCredentialSentinelValue &&
          control == nativeCredentialControlValue,
    );
  }

  try {
    switch (phase) {
      case 'prepare':
        // Complete both preflight reads before the first write. A partial or
        // unknown prior run needs explicit review, never replacement/recovery.
        final sentinel = await store.read(nativeCredentialSentinel);
        final control = await store.read(nativeCredentialControl);
        if (sentinel == null && control == null) {
          await store.write(
            nativeCredentialSentinel,
            nativeCredentialSentinelValue,
          );
          await store.write(
            nativeCredentialControl,
            nativeCredentialControlValue,
          );
        } else {
          require(
            sentinel == nativeCredentialSentinelValue &&
                control == nativeCredentialControlValue,
          );
        }
        await verify();
      case 'verify':
        // Root proves a distinct OS process; this function only proves reads.
        await verify();
      case 'fault-verify':
        require(android);
        var failed = false;
        try {
          await store.read(nativeCredentialSentinel);
        } on PlatformException {
          failed = true;
        }
        require(failed);
        final control = await store.read(nativeCredentialControl);
        require(control == nativeCredentialControlValue);
      // No write/delete/recovery. Host must independently prove the retained
      // bad ciphertext and every other preference byte before restoration.
      case 'cleanup':
        require(cleanupApproved);
        await verify();
        await store.write(nativeCredentialSentinel, null);
        await store.write(nativeCredentialControl, null);
        require(await store.read(nativeCredentialSentinel) == null);
        require(await store.read(nativeCredentialControl) == null);
      default:
        require(false);
    }
  } catch (_) {
    throw StateError('Native credential QA phase refused.');
  }
}
