import 'dart:async';
import 'package:flutter/cupertino.dart' show CupertinoIcons;
import '../../../core/presentation/cloud_chrome.dart';
import 'package:flutter/material.dart';
import '../domain/cloud_notification.dart';
import 'notification_controller.dart';

class NotificationPage extends StatefulWidget {
  const NotificationPage({
    super.key,
    required this.controller,
    required this.onOpen,
    this.ownsController = true,
    this.onOpenNavigation,
  });
  final NotificationController controller;
  final void Function(String id) onOpen;
  final bool ownsController;
  final VoidCallback? onOpenNavigation;
  @override
  State<NotificationPage> createState() => _NotificationPageState();
}

class _NotificationPageState extends State<NotificationPage> {
  @override
  void initState() {
    super.initState();
    // The inbox is shared with the root banner; refresh after mounting so its
    // listener cannot dirty the root while this destination is being built.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(widget.controller.refresh());
    });
  }

  @override
  void dispose() {
    if (widget.ownsController) widget.controller.dispose();
    super.dispose();
  }

  Future<void> _open(CloudNotification item) async {
    await widget.controller.markRead(item);
    if (mounted) widget.onOpen(item.conversationId);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final c = widget.controller;
      return Scaffold(
        appBar: AppBar(
          leadingWidth: widget.onOpenNavigation == null ? null : 60,
          leading: widget.onOpenNavigation == null
              ? null
              : Padding(
                  padding: const EdgeInsets.only(left: 16, top: 6, bottom: 6),
                  child: CloudNavigationButton(
                    icon: CupertinoIcons.line_horizontal_3,
                    label: 'Open navigation',
                    onPressed: widget.onOpenNavigation!,
                  ),
                ),
          title: const Text('Notifications'),
          actions: [
            TextButton(
              onPressed: c.unreadCount == 0 ? null : () => c.markRead(null),
              child: const Text('Mark all read'),
            ),
          ],
        ),
        body: SafeArea(
          child: RefreshIndicator(
            onRefresh: c.refresh,
            child: ListView(
              children: [
                if (c.loading) const LinearProgressIndicator(),
                if (c.error != null)
                  ListTile(
                    title: Text(c.error!),
                    trailing: TextButton(
                      onPressed: c.refresh,
                      child: const Text('Retry'),
                    ),
                  ),
                if (c.items.isEmpty && !c.loading)
                  const Padding(
                    padding: EdgeInsets.all(40),
                    child: Column(
                      children: [
                        Icon(Icons.notifications_none, size: 40),
                        SizedBox(height: 16),
                        Text('You’re all caught up'),
                        SizedBox(height: 8),
                        Text(
                          'Completed tasks will appear here.',
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                for (final item in c.items)
                  ListTile(
                    leading: Icon(
                      item.unread
                          ? Icons.notifications_active_outlined
                          : Icons.task_alt,
                    ),
                    title: Text(
                      item.title ?? 'Task complete',
                      style: TextStyle(
                        fontWeight: item.unread ? FontWeight.w600 : null,
                      ),
                    ),
                    subtitle: Text(
                      '${item.status} · ${MaterialLocalizations.of(context).formatMediumDate(item.finishedAt.toLocal())}',
                    ),
                    onTap: () => _open(item),
                  ),
                if (c.cursor != null)
                  TextButton(
                    onPressed: c.loading ? null : () => c.refresh(more: true),
                    child: const Text('Load more'),
                  ),
              ],
            ),
          ),
        ),
      );
    },
  );
}
