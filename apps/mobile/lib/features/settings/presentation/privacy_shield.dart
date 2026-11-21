import 'package:flutter/material.dart';
import 'app_lock_controller.dart';

import '../../../core/design/djl_icons.dart';
import '../../../l10n/l10n.dart';

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
          excluding: controller.covered,
          child: ExcludeFocus(
            excluding: controller.covered,
            child: AbsorbPointer(absorbing: controller.covered, child: child),
          ),
        ),
        if (controller.covered)
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
                                      ? context.l10n.settingsLocked
                                      : 'DJL'
                                : startupError == null
                                ? context.l10n.settingsPreparing
                                : context.l10n.settingsStartFailed,
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          if (controller.ready) ...[
                            const SizedBox(height: 8),
                            Text(
                              context.l10n.settingsPrivateNote,
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
                              child: Text(context.l10n.settingsRetryStartup),
                            ),
                          ],
                          if (controller.requiresUnlock) ...[
                            const SizedBox(height: 18),
                            Semantics(
                              hint: context.l10n.settingsUnlockHint,
                              child: FilledButton(
                                onPressed: controller.authenticating
                                    ? null
                                    : controller.authenticate,
                                child: Text(
                                  controller.authenticating
                                      ? context.l10n.settingsUnlocking
                                      : context.l10n.settingsUnlock,
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
