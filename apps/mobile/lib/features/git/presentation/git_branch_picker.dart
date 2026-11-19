import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../domain/git_branch_picker_models.dart';
import '../domain/git_creation_review.dart';
import 'git_controller.dart';
import 'git_new_branch_dialog.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

Future<GitBranchChoice?> showGitBranchPicker({
  required BuildContext context,
  required GitController controller,
  required bool Function() isCurrent,
  Listenable? scopeChanges,
}) async {
  if (!context.mounted || !isCurrent() || !controller.repository.isCurrent) {
    return null;
  }
  return showGitBranchSurface<GitBranchChoice>(
    context: context,
    child: GitBranchPicker(
      controller: controller,
      isCurrent: isCurrent,
      scopeChanges: scopeChanges,
    ),
  );
}

Future<T?> showGitBranchSurface<T>({
  required BuildContext context,
  required Widget child,
}) async {
  if (!context.mounted) return null;
  final navigator = Navigator.of(context);
  final button = context.findRenderObject();
  final overlay = navigator.overlay?.context.findRenderObject();
  if (button is! RenderBox || overlay is! RenderBox || !button.hasSize) {
    return null;
  }
  final anchor =
      button.localToGlobal(Offset.zero, ancestor: overlay) & button.size;
  final themes = InheritedTheme.capture(from: context, to: navigator.context);
  return showGeneralDialog<T>(
    context: context,
    useRootNavigator: false,
    barrierDismissible: true,
    barrierLabel: 'Dismiss branch picker',
    barrierColor: Colors.transparent,
    requestFocus: true,
    transitionDuration: const Duration(milliseconds: 180),
    transitionBuilder: (_, animation, _, child) =>
        FadeTransition(opacity: animation, child: child),
    pageBuilder: (_, _, _) =>
        themes.wrap(_BranchPositioner(anchor: anchor, child: child)),
  );
}

class _BranchPositioner extends StatelessWidget {
  const _BranchPositioner({required this.anchor, required this.child});
  final Rect anchor;
  final Widget child;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, bounds) {
      final media = MediaQuery.of(context), safe = media.padding.top + 8;
      final bottom =
          (bounds.maxHeight - media.viewInsets.bottom - media.padding.bottom)
              .clamp(safe, bounds.maxHeight)
              .toDouble();
      final start = anchor.top.clamp(safe, bottom).toDouble();
      final end = anchor.bottom.clamp(safe, bottom).toDouble();
      final above = (start - safe - 4).clamp(0.0, bounds.maxHeight).toDouble();
      final below = (bottom - end - 12).clamp(0.0, bounds.maxHeight).toDouble();
      final upward = above >= below;
      final height = (upward ? above : below).clamp(0.0, 360.0).toDouble();
      final width = (bounds.maxWidth - 16).clamp(0.0, 360.0).toDouble();
      final left = (anchor.center.dx - width / 2)
          .clamp(8.0, bounds.maxWidth - width - 8)
          .toDouble();
      return Stack(
        children: [
          Positioned(
            left: left,
            top: upward ? start - height - 4 : end + 4,
            width: width,
            height: height,
            child: child,
          ),
        ],
      );
    },
  );
}

class GitBranchPicker extends StatefulWidget {
  const GitBranchPicker({
    super.key,
    required this.controller,
    required this.isCurrent,
    this.scopeChanges,
    this.onChoice,
  });
  final GitController controller;
  final bool Function() isCurrent;
  final Listenable? scopeChanges;
  final ValueChanged<GitBranchChoice>? onChoice;
  @override
  State<GitBranchPicker> createState() => _GitBranchPickerState();
}

class _GitBranchPickerState extends State<GitBranchPicker> {
  final _search = TextEditingController();
  final _rowKeys = <String, Key>{};
  bool get _current =>
      mounted && widget.isCurrent() && widget.controller.repository.isCurrent;
  bool get _ready =>
      _current &&
      !widget.controller.loading &&
      !widget.controller.busy &&
      widget.controller.error == null;
  GitBranchSnapshot get _snapshot => GitBranchSnapshot.fromJson(
    widget.controller.branches,
    fallbackCurrent: widget.controller.status?.branch,
  );
  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _close() {
    if (mounted && ModalRoute.of(context)?.isCurrent == true) {
      Navigator.pop(context);
    }
  }

  void _finish(GitBranchChoice choice) {
    if (_ready && ModalRoute.of(context)?.isCurrent == true) {
      if (widget.onChoice case final selected?) {
        selected(choice);
      } else {
        Navigator.pop(context, choice);
      }
    }
  }

  void _select(String branch) {
    if (!_ready || !_snapshot.selectable(branch)) {
      if (mounted) setState(() {});
      return;
    }
    _finish((branch: branch, create: false));
  }

  Future<void> _newBranch() async {
    if (!_ready || ModalRoute.of(context)?.isCurrent != true) return;
    final normalized = normalizedGitCreatedBranchName(_search.text);
    final name = await showDialog<String>(
      context: context,
      builder: (_) => GitNewBranchDialog(
        initialName: normalized.isEmpty ? 'djl/' : normalized,
        isCurrent: () => _current,
        scopeChanges: widget.scopeChanges,
      ),
    );
    if (name != null && _ready) {
      _finish((branch: name, create: true));
    }
  }

  Future<void> _reload() async {
    final c = widget.controller;
    if (!_current ||
        c.loading ||
        c.busy ||
        ModalRoute.of(context)?.isCurrent != true) {
      return;
    }
    await c.refresh();
  }

  Widget _badge(String title) => DecoratedBox(
    decoration: BoxDecoration(
      color: DjlColors.of(context).surfaceRaised,
      borderRadius: BorderRadius.circular(99),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      child: Text(
        title,
        style: TextStyle(
          fontFamily: 'GeistMono',
          fontSize: 10,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    ),
  );

  Widget _row(
    GitBranchSnapshot snapshot,
    String branch, {
    required bool first,
    required bool last,
  }) {
    final selected = branch == snapshot.currentBranch;
    final badge = snapshot.badge(branch);
    final labels = [
      if (selected) 'Current',
      if (branch == snapshot.defaultBranch) 'Default',
      ?badge,
    ];
    final enabled = _ready && snapshot.selectable(branch);
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: first ? const Radius.circular(12) : Radius.zero,
          bottom: last ? const Radius.circular(12) : Radius.zero,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Semantics(
        container: true,
        button: true,
        selected: selected,
        enabled: enabled,
        label: [branch, ...labels].join(', '),
        excludeSemantics: true,
        onTap: enabled ? () => _select(branch) : null,
        child: InkWell(
          key: _rowKeys.putIfAbsent(branch, UniqueKey.new),
          onTap: enabled ? () => _select(branch) : null,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          branch,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontFamily: 'GeistMono',
                            fontSize: 15,
                            color: enabled
                                ? colors.onSurface
                                : colors.onSurfaceVariant,
                          ),
                        ),
                        if (labels.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 3),
                            child: Wrap(
                              spacing: 4,
                              runSpacing: 3,
                              children: labels.map(_badge).toList(),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (selected)
                    Icon(
                      DjlIcons.check,
                      size: 18,
                      color: enabled
                          ? colors.onSurface
                          : colors.onSurfaceVariant,
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _action(String title, VoidCallback? onTap, {IconData? icon}) =>
      Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Semantics(
          button: true,
          enabled: onTap != null,
          child: Material(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.circular(12),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: onTap,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 44),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      if (icon != null) ...[
                        Icon(icon, size: 18),
                        const SizedBox(width: 8),
                      ],
                      Expanded(
                        child: Text(
                          title,
                          style: TextStyle(
                            fontSize: 17,
                            color: Theme.of(context).colorScheme.onSurface
                                .withValues(alpha: onTap == null ? .38 : 1),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: Listenable.merge([widget.controller, widget.scopeChanges]),
    builder: (context, _) {
      final c = widget.controller, snapshot = _snapshot;
      final others = snapshot.otherBranches(_search.text);
      final branches = [
        if (snapshot.defaultBranch != null) snapshot.defaultBranch!,
        ...others,
      ];
      final suggestion = snapshot.suggestedCreation(_search.text);
      final colors = Theme.of(context).colorScheme;
      return CallbackShortcuts(
        bindings: {const SingleActivator(LogicalKeyboardKey.escape): _close},
        child: Focus(
          autofocus: true,
          child: Semantics(
            scopesRoute: true,
            namesRoute: true,
            explicitChildNodes: true,
            label: 'Current Branch',
            child: Material(
              color: colors.surfaceContainerLow,
              elevation: 12,
              shadowColor: Colors.black.withValues(alpha: .15),
              borderRadius: BorderRadius.circular(28),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsetsDirectional.only(
                      start: 16,
                      end: 4,
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Current Branch',
                            style: Theme.of(context).textTheme.titleMedium
                                ?.copyWith(
                                  fontSize: 17,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Close branch picker',
                          onPressed: _close,
                          icon: const Icon(DjlIcons.close, size: 18),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                      children: !_current
                          ? [
                              const Text(
                                'Thread or desktop changed. Close and reopen the branch picker.',
                              ),
                            ]
                          : [
                              Semantics(
                                label: 'Search branches',
                                child: TextField(
                                  controller: _search,
                                  autocorrect: false,
                                  textCapitalization: TextCapitalization.none,
                                  onChanged: (_) => setState(() {}),
                                  decoration: InputDecoration(
                                    hintText: 'Search branches',
                                    isDense: true,
                                    prefixIcon: const Icon(
                                      DjlIcons.search,
                                      size: 18,
                                    ),
                                    suffixIcon: _search.text.isEmpty
                                        ? null
                                        : IconButton(
                                            tooltip: 'Clear branch search',
                                            onPressed: () =>
                                                setState(_search.clear),
                                            icon: const Icon(
                                              DjlIcons.close,
                                              size: 18,
                                            ),
                                          ),
                                  ),
                                ),
                              ),
                              Padding(
                                padding: const EdgeInsets.only(
                                  top: 12,
                                  bottom: 6,
                                ),
                                child: Text(
                                  'Branches',
                                  style: Theme.of(context).textTheme.labelMedium
                                      ?.copyWith(
                                        color: colors.onSurfaceVariant,
                                      ),
                                ),
                              ),
                              for (var i = 0; i < branches.length; i++)
                                _row(
                                  snapshot,
                                  branches[i],
                                  first: i == 0,
                                  last: i == branches.length - 1,
                                ),
                              if (others.isEmpty)
                                Padding(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                    vertical: 16,
                                  ),
                                  child: Column(
                                    children: [
                                      SvgPicture.asset(
                                        'assets/icons/command/git-branch.svg',
                                        width: 28,
                                        height: 28,
                                        colorFilter: ColorFilter.mode(
                                          colors.onSurfaceVariant,
                                          BlendMode.srcIn,
                                        ),
                                      ),
                                      const SizedBox(height: 8),
                                      const Text(
                                        'No branches found',
                                        textAlign: TextAlign.center,
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        'Try a different search or refresh the branch list.',
                                        textAlign: TextAlign.center,
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall
                                            ?.copyWith(
                                              color: colors.onSurfaceVariant,
                                            ),
                                      ),
                                    ],
                                  ),
                                ),
                              if (suggestion != null)
                                _action(
                                  "Create and checkout '$suggestion'",
                                  !_ready
                                      ? null
                                      : () {
                                          final current = _snapshot
                                              .suggestedCreation(_search.text);
                                          if (current != null) {
                                            _finish((
                                              branch: current,
                                              create: true,
                                            ));
                                          }
                                        },
                                  icon: DjlIcons.add,
                                ),
                              _action(
                                'New branch...',
                                _ready
                                    ? () {
                                        _newBranch();
                                      }
                                    : null,
                                icon: DjlIcons.add,
                              ),
                              if (c.error != null)
                                Padding(
                                  padding: const EdgeInsets.only(top: 12),
                                  child: Text(
                                    c.error!.replaceFirst('Bad state: ', ''),
                                    style: TextStyle(color: colors.error),
                                  ),
                                ),
                              _action(
                                c.busy
                                    ? 'Switching...'
                                    : c.loading
                                    ? 'Refreshing...'
                                    : 'Reload branch list',
                                _current && !c.loading && !c.busy
                                    ? () {
                                        _reload();
                                      }
                                    : null,
                              ),
                            ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}
