import 'package:flutter/material.dart';
import '../../../core/design/djl_icons.dart';
import '../../../core/design/djl_tokens.dart';
import '../domain/group_models.dart';
import 'agent_avatar.dart';
import 'group_chat_page.dart';
import 'group_create_sheet.dart';
import 'groups_controller.dart';

/// The list of group chats on the paired Mac. Meant to sit inside a page that
/// already provides the app bar.
class GroupsList extends StatelessWidget {
  const GroupsList({super.key, required this.controller, this.padding});
  final GroupsController controller;
  final EdgeInsets? padding;

  static void open(
    BuildContext context,
    GroupsController controller,
    Group group,
  ) => Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => GroupChatPage(controller: controller, groupId: group.id),
    ),
  );

  static Future<void> create(
    BuildContext context,
    GroupsController controller,
  ) async {
    final created = await showModalBottomSheet<Group>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (_) => GroupCreateSheet(controller: controller),
    );
    if (created != null && context.mounted) open(context, controller, created);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      if (controller.needsDesktopUpdate) {
        return const _Empty(
          icon: DjlIcons.update,
          title: 'Update DJL on your Mac',
          body:
              'Group chats need the latest DJL on your Mac. Update it there, '
              'then come back.',
        );
      }
      if (!controller.available && !controller.loaded) {
        return const _Empty(
          icon: DjlIcons.laptop,
          title: 'Connect to your Mac',
          body:
              'Group chats live on your Mac. They appear here once it is '
              'connected.',
        );
      }
      if (!controller.loaded) {
        return controller.error == null
            ? const Center(
                child: SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
            : _Empty(
                icon: DjlIcons.error,
                title: "Couldn't load your groups",
                body: controller.error!,
                action: 'Try again',
                onAction: controller.refresh,
              );
      }
      if (controller.groups.isEmpty) {
        return _Empty(
          icon: DjlIcons.group,
          title: 'Put your agents in one chat',
          body:
              'Ask a question once and let Claude, Codex and the others '
              'answer together.',
          action: 'New group',
          onAction: () => create(context, controller),
        );
      }
      return ListView.builder(
        padding: padding ?? const EdgeInsets.symmetric(vertical: DjlSpace.sm),
        itemCount: controller.groups.length,
        itemBuilder: (context, index) {
          final group = controller.groups[index];
          return _GroupRow(
            key: ValueKey(group.id),
            group: group,
            preview: _preview(group),
            live: controller.running(group),
            onTap: () => open(context, controller, group),
          );
        },
      );
    },
  );

  String _preview(Group group) {
    final writing = [
      for (final member in group.members)
        if (controller.state(member.id).busy) member.handle,
    ];
    if (writing.length == 1) return '${writing.single} is writing';
    if (writing.length > 1) return '${writing.length} agents are writing';
    if (group.pendingHandoffs > 0) return 'Paused, waiting for you';
    final names = group.members.map((member) => member.handle).join(', ');
    // A group left with its suggested name would show the same line twice.
    return names == group.name ? '${group.members.length} agents' : names;
  }
}

class _GroupRow extends StatelessWidget {
  const _GroupRow({
    super.key,
    required this.group,
    required this.preview,
    required this.live,
    required this.onTap,
  });
  final Group group;
  final String preview;
  final bool live;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = DjlColors.of(context);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: DjlSpace.page,
          vertical: DjlSpace.md,
        ),
        child: Row(
          children: [
            SizedBox(
              width: 84,
              child: Align(
                alignment: Alignment.centerLeft,
                child: AgentAvatarStack(members: group.members, size: 40),
              ),
            ),
            const SizedBox(width: DjlSpace.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    group.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleMedium,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    preview,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: live ? colors.ink : colors.inkMuted,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: DjlSpace.sm),
            Icon(DjlIcons.chevronRight, size: 16, color: colors.inkFaint),
          ],
        ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({
    required this.icon,
    required this.title,
    required this.body,
    this.action,
    this.onAction,
  });
  final IconData icon;
  final String title, body;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = DjlColors.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(DjlSpace.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 34, color: colors.ink),
            const SizedBox(height: DjlSpace.lg),
            Text(
              title,
              textAlign: TextAlign.center,
              style: theme.textTheme.headlineMedium,
            ),
            const SizedBox(height: DjlSpace.sm),
            Text(
              body,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: colors.inkMuted,
                height: 1.35,
              ),
            ),
            if (action != null) ...[
              const SizedBox(height: DjlSpace.xl),
              FilledButton(
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, 48),
                  padding: const EdgeInsets.symmetric(horizontal: DjlSpace.xxl),
                ),
                onPressed: onAction,
                child: Text(action!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
