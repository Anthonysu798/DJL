import 'package:flutter/material.dart';
import 'app_lock_controller.dart';

import '../../../core/design/djl_icons.dart';

class PrivacyShield extends StatelessWidget {
  const PrivacyShield({
    super.key,
    required this.controller,
    required this.child,
    this.startupError,
    this.onRetry,
  });
  final AppLockController controller;
  final Widget child;
  final String? startupError;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) => Stack(
      fit: StackFit.expand,
      children: [
        ExcludeSemantics(
          excluding: controller.shielded,
          child: ExcludeFocus(
            excluding: controller.shielded,
            child: AbsorbPointer(absorbing: controller.shielded, child: child),
          ),
        ),
        if (controller.shielded)
          Positioned.fill(
            child: Material(
              color: Theme.of(context).colorScheme.surface,
              child: SafeArea(
                child: Center(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(32),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 360),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          ExcludeSemantics(
                            child: Icon(
                              controller.requiresUnlock
                                  ? DjlIcons.lock
                                  : DjlIcons.hidden,
                              size: 38,
                            ),
                          ),
                          const SizedBox(height: 18),
                          Text(
                            controller.ready
                                ? controller.requiresUnlock
                                      ? 'DJL is locked'
                                      : 'DJL'
                                : startupError == null
                                ? 'Preparing DJL'
                                : 'Could not start DJL',
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          if (controller.ready) ...[
                            const SizedBox(height: 8),
                            Text(
                              controller.requiresUnlock
                                  ? 'Your remote sessions stay private when you step away.'
                                  : 'Your session is hidden while DJL is inactive.',
                              textAlign: TextAlign.center,
                            ),
                          ],
                          if (startupError ?? controller.error
                              case final String message) ...[
                            const SizedBox(height: 16),
                            Text(message, textAlign: TextAlign.center),
                          ],
                          if (!controller.ready && startupError == null) ...[
                            const SizedBox(height: 18),
                            const CircularProgressIndicator(),
                          ],
                          if (startupError != null && onRetry != null) ...[
                            const SizedBox(height: 18),
                            FilledButton(
                              onPressed: onRetry,
                              child: const Text('Retry startup'),
                            ),
                          ],
                          if (controller.requiresUnlock) ...[
                            const SizedBox(height: 18),
                            Semantics(
                              hint:
                                  'Authenticates with Face ID, Touch ID, or your device passcode',
                              child: FilledButton(
                                onPressed: controller.authenticating
                                    ? null
                                    : controller.authenticate,
                                child: Text(
                                  controller.authenticating
                                      ? 'Unlocking…'
                                      : 'Unlock DJL',
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    ),
  );
}
