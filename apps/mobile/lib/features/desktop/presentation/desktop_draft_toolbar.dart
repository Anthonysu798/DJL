import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../git/domain/git_models.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

class DesktopDraftActions extends StatelessWidget {
  const DesktopDraftActions({
    super.key,
    required this.showGit,
    required this.onGit,
    required this.onGitTools,
    this.gitStatus,
    this.gitBusy = false,
  });

  final bool showGit;
  final ValueChanged<BuildContext>? onGit;
  final VoidCallback? onGitTools;
  final GitStatus? gitStatus;
  final bool gitBusy;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.onSurface;
    return DesktopToolbarActions(
      showGit: showGit,
      onGit: onGit,
      gitStatus: gitStatus,
      gitBusy: gitBusy,
      threadActions: PopupMenuButton<String>(
        tooltip: 'Thread actions',
        enabled: onGitTools != null,
        onSelected: (_) => onGitTools?.call(),
        itemBuilder: (_) => [
          PopupMenuItem(
            value: 'git-tools',
            enabled: onGitTools != null,
            child: const Row(
              children: [
                Icon(DjlIcons.branch, size: 24),
                SizedBox(width: 12),
                Flexible(child: Text('Branches & worktrees')),
              ],
            ),
          ),
        ],
        icon: Icon(
          DjlIcons.more,
          size: 24,
          color: onGitTools == null ? color.withValues(alpha: .45) : color,
        ),
      ),
    );
  }
}

class DesktopToolbarActions extends StatelessWidget {
  const DesktopToolbarActions({
    super.key,
    required this.showGit,
    required this.onGit,
    required this.threadActions,
    this.gitStatus,
    this.gitBusy = false,
  });

  final bool showGit;
  final ValueChanged<BuildContext>? onGit;
  final GitStatus? gitStatus;
  final bool gitBusy;
  final Widget threadActions;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.onSurface;
    final enabled = onGit != null && !gitBusy;
    final statusColor = switch (gitStatus?.state) {
      'not_initialized' => DjlColors.of(context).ink,
      'behind_only' ||
      'diverged' ||
      'dirty_and_behind' => DjlColors.of(context).inkFaint,
      _ => null,
    };
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 16),
      child: PopupMenuTheme(
        data: PopupMenuTheme.of(context).copyWith(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(28),
          ),
          color: Theme.of(context).colorScheme.surface.withValues(alpha: .97),
          surfaceTintColor: Colors.transparent,
          shadowColor: Colors.black.withValues(alpha: .15),
          elevation: 12,
          menuPadding: const EdgeInsets.symmetric(vertical: 8),
        ),
        child: DjlGlassSurface(
          radius: 22,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (showGit)
                SizedBox(
                  width: 48,
                  height: 44,
                  child: Builder(
                    builder: (buttonContext) => Stack(
                      clipBehavior: Clip.none,
                      children: [
                        IconButton(
                          tooltip: 'Git actions',
                          onPressed: enabled
                              ? () => onGit!(buttonContext)
                              : null,
                          icon: Semantics(
                            label: 'Git actions',
                            value: gitBusy
                                ? 'Working…'
                                : gitToolbarStatusLabel(gitStatus),
                            child: SvgPicture.asset(
                              'assets/icons/command/${gitStatus?.state == 'not_initialized' ? 'central-circle-plus' : 'git-commit'}.svg',
                              width: 24,
                              height: 24,
                              colorFilter: ColorFilter.mode(
                                enabled ? color : color.withValues(alpha: .45),
                                BlendMode.srcIn,
                              ),
                            ),
                          ),
                        ),
                        if (!gitBusy && statusColor != null)
                          Positioned(
                            top: 8,
                            right: 10,
                            child: Container(
                              key: const Key('git.toolbar.status-dot'),
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: statusColor,
                                border: Border.all(
                                  width: 1.5,
                                  color: Theme.of(context).colorScheme.surface,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              SizedBox(width: 48, height: 44, child: threadActions),
            ],
          ),
        ),
      ),
    );
  }
}
