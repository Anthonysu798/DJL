import 'package:flutter/material.dart';
import '../domain/cloud_notification.dart';

import '../../../core/design/djl_icons.dart';
import '../../../l10n/l10n.dart';

class CloudNotificationBanner extends StatelessWidget {
  const CloudNotificationBanner({
    super.key,
    required this.item,
    required this.onOpen,
    required this.onDismiss,
  });
  final CloudNotification item;
  final VoidCallback onOpen, onDismiss;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final failed = item.status == 'failed';
    return Semantics(
      container: true,
      liveRegion: true,
      child: Material(
        color: colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(24),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            Expanded(
              child: InkWell(
                onTap: onOpen,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 0, 16),
                  child: Row(
                    children: [
                      Icon(
                        failed ? DjlIcons.feedback : DjlIcons.chatText,
                        size: 24,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              failed
                                  ? context.l10n.notificationsTaskStopped
                                  : context.l10n.notificationsTaskFinished,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              item.title ??
                                  context.l10n.notificationsOpenResult,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 13,
                                color: colors.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            IconButton(
              tooltip: context.l10n.notificationsDismiss,
              onPressed: onDismiss,
              icon: const Icon(DjlIcons.close, size: 18),
            ),
            const SizedBox(width: 4),
          ],
        ),
      ),
    );
  }
}
