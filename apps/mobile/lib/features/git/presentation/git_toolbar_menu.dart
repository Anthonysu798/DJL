import 'package:flutter/material.dart';
import '../data/git_repository.dart';
import '../domain/git_models.dart';
import 'git_page.dart';
import '../../../l10n/l10n.dart';

Future<void> showGitToolbarMenu({
  required BuildContext context,
  required GitRepository repository,
  required bool Function() isCurrent,
  List<String> writerModels = const [],
  String? initialWriter,
  Listenable? scopeChanges,
  ValueChanged<GitStatus>? onStatus,
  ValueChanged<bool>? onBusy,
}) async {
  if (!context.mounted || !isCurrent() || !repository.isCurrent) return;
  final button = context.findRenderObject();
  final navigator = Navigator.of(context);
  final overlay = navigator.overlay?.context.findRenderObject();
  if (button is! RenderBox || overlay is! RenderBox || !button.hasSize) return;
  final anchor =
      button.localToGlobal(Offset.zero, ancestor: overlay) & button.size;
  final themes = InheritedTheme.capture(from: context, to: navigator.context);
  final scoped = GitRepository(
    repository.transport,
    cwd: repository.cwd,
    isCurrent: () => repository.isCurrent && isCurrent(),
  );
  await showGeneralDialog<void>(
    context: context,
    useRootNavigator: false,
    barrierDismissible: true,
    barrierLabel: context.l10n.gitDismissMenu,
    barrierColor: Colors.transparent,
    requestFocus: true,
    transitionDuration: const Duration(milliseconds: 180),
    transitionBuilder: (_, animation, _, child) => FadeTransition(
      opacity: CurvedAnimation(parent: animation, curve: Curves.easeOutCubic),
      child: child,
    ),
    pageBuilder: (_, _, _) => themes.wrap(
      _GitMenuPositioner(
        anchor: anchor,
        child: GitPage(
          repository: scoped,
          toolbarMenu: true,
          scopeChanges: scopeChanges,
          onStatus: onStatus,
          onBusy: onBusy,
          writerModels: writerModels,
          initialWriter: initialWriter,
          onOpenWorktree: (_) {},
        ),
      ),
    ),
  );
}

class _GitMenuPositioner extends StatelessWidget {
  const _GitMenuPositioner({required this.anchor, required this.child});
  final Rect anchor;
  final Widget child;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, bounds) {
      final media = MediaQuery.of(context);
      final bottom =
          bounds.maxHeight - media.viewInsets.bottom - media.padding.bottom;
      final top = (anchor.bottom + 4)
          .clamp(
            media.padding.top + 8,
            (bottom - 52).clamp(media.padding.top + 8, bounds.maxHeight),
          )
          .toDouble();
      final right = (bounds.maxWidth - anchor.right)
          .clamp(8.0, bounds.maxWidth - 256)
          .toDouble();
      final width = (bounds.maxWidth - right - 8)
          .clamp(248.0, 328.0)
          .toDouble();
      final height = (bottom - top - 8)
          .clamp(44.0, bounds.maxHeight)
          .toDouble();
      return Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            top: top,
            right: right,
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minWidth: 248,
                maxWidth: width,
                maxHeight: height,
              ),
              child: IntrinsicWidth(stepWidth: 56, child: child),
            ),
          ),
        ],
      );
    },
  );
}
