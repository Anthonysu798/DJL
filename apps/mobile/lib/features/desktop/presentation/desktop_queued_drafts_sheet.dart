import 'dart:math' as math;
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../../../core/presentation/djl_glass.dart';
import '../domain/desktop_queued_draft.dart';
import 'desktop_composer_controller.dart';
import 'desktop_controller.dart';

class DesktopQueuedStatus extends StatelessWidget {
  const DesktopQueuedStatus({
    super.key,
    required this.count,
    required this.onTap,
  });
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: 'Queued messages',
    excludeFromSemantics: true,
    child: Semantics(
      button: true,
      label: 'Queued messages',
      value: '$count',
      hint: 'Shows the queued follow-ups in a sheet',
      child: DjlGlassSurface(
        radius: 999,
        child: InkWell(
          borderRadius: BorderRadius.circular(999),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: ExcludeSemantics(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      'Queued',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    '$count',
                    style: TextStyle(
                      fontSize: 12,
                      color: Theme.of(
                        context,
                      ).colorScheme.onSurface.withValues(alpha: .78),
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
}

class DesktopQueuedDraftsSheet extends StatefulWidget {
  const DesktopQueuedDraftsSheet({
    super.key,
    required this.controller,
    required this.composer,
    required this.isCurrent,
    this.onVisible,
  });
  final DesktopController controller;
  final DesktopComposerController composer;
  final bool Function() isCurrent;
  final VoidCallback? onVisible;
  @override
  State<DesktopQueuedDraftsSheet> createState() =>
      _DesktopQueuedDraftsSheetState();
}

class _DesktopQueuedDraftsSheetState extends State<DesktopQueuedDraftsSheet> {
  ModalRoute<dynamic>? _route;
  bool _closing = false;
  String? _notice;
  bool get _canAct =>
      !_closing && widget.isCurrent() && _route?.isCurrent == true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _route = ModalRoute.of(context);
    if (_route?.isCurrent == true) widget.onVisible?.call();
  }

  void _closeOwned() {
    if (_closing) return;
    _closing = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final route = _route;
      if (mounted && route != null && route.isActive) {
        route.navigator?.removeRoute(route);
      }
    });
  }

  void _restore(DesktopQueuedDraft draft) {
    if (!_canAct) return;
    widget.controller.restoreQueuedDraft(draft.id, (row) {
      if (!_canAct || !widget.composer.canRestoreDraft) return false;
      if (row.plan && !widget.controller.supportsPlan) {
        setState(
          () => _notice =
              'Choose a model that supports Plan mode before moving this draft into the input.',
        );
        return false;
      }
      if (!widget.composer.restoreDraft(row.draft)) return false;
      widget.controller.setPlan(row.plan);
      return true;
    });
  }

  Future<void> _steer(DesktopQueuedDraft draft) async {
    if (!_canAct) return;
    final accepted = await widget.controller.steerQueuedDraft(draft.id);
    if (mounted && _canAct && !accepted && widget.controller.error != null) {
      setState(() => _notice = widget.controller.error);
    }
  }

  Widget _row(DesktopQueuedDraft draft) {
    final desktop = widget.controller, colors = Theme.of(context).colorScheme;
    final height = math.max(
      44.0,
      MediaQuery.textScalerOf(context).scale(12) * 1.4 + 12,
    );
    final restore =
        _canAct &&
        !desktop.busy &&
        !desktop.queuedActionInProgress &&
        widget.composer.canRestoreDraft;
    return SizedBox(
      key: ValueKey('queued-row-${draft.id}'),
      height: height,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10),
        child: Row(
          children: [
            Icon(
              CupertinoIcons.arrow_turn_down_right,
              size: 10,
              color: colors.onSurface.withValues(alpha: .3),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                draft.draft.text.trim().isNotEmpty
                    ? draft.draft.text
                    : draft.draft.images.isNotEmpty
                    ? '${draft.draft.images.length} image${draft.draft.images.length == 1 ? '' : 's'}'
                    : 'Attached context',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: colors.onSurfaceVariant,
                ),
              ),
            ),
            const SizedBox(width: 4),
            IconButton(
              tooltip: 'Move draft into input',
              onPressed: restore ? () => _restore(draft) : null,
              constraints: const BoxConstraints.tightFor(width: 44, height: 44),
              padding: EdgeInsets.zero,
              icon: Container(
                width: 24,
                height: 24,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: colors.onSurface.withValues(alpha: .06),
                ),
                child: Icon(
                  CupertinoIcons.arrow_down,
                  size: 12,
                  color: colors.onSurface.withValues(alpha: restore ? 1 : .3),
                ),
              ),
            ),
            if (desktop.turnId != null)
              Tooltip(
                message: 'Steer queued message',
                excludeFromSemantics: true,
                child: TextButton(
                  onPressed: _canAct && desktop.canSteerQueuedDrafts
                      ? () => _steer(draft)
                      : null,
                  style: TextButton.styleFrom(
                    minimumSize: const Size(44, 44),
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    foregroundColor: colors.onSurface,
                  ),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(999),
                      color: colors.onSurface.withValues(alpha: .06),
                    ),
                    child: const Text(
                      'Steer',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ),
              ),
            IconButton(
              tooltip: 'Delete queued message',
              onPressed: _canAct && desktop.steeringQueuedDraftId != draft.id
                  ? () => desktop.removeQueuedDraft(draft.id)
                  : null,
              constraints: const BoxConstraints.tightFor(width: 44, height: 44),
              padding: EdgeInsets.zero,
              icon: Icon(
                CupertinoIcons.trash,
                size: 13,
                color: colors.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([widget.controller, widget.composer]),
      builder: (context, _) {
        final current = widget.isCurrent();
        final drafts = current
            ? widget.controller.queuedDrafts
            : const <DesktopQueuedDraft>[];
        if (!current || drafts.isEmpty) _closeOwned();
        final colors = Theme.of(context).colorScheme;
        return DraggableScrollableSheet(
          initialChildSize: .5,
          minChildSize: .5,
          maxChildSize: 1,
          expand: false,
          snap: true,
          snapSizes: const [.5, 1],
          builder: (context, scroll) => Material(
            color: colors.surface,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
            clipBehavior: Clip.antiAlias,
            child: CustomScrollView(
              controller: scroll,
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverToBoxAdapter(
                  child: SizedBox(
                    height: 20,
                    child: Center(
                      child: Container(
                        width: 36,
                        height: 5,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(3),
                          color: colors.onSurface.withValues(alpha: .25),
                        ),
                      ),
                    ),
                  ),
                ),
                SliverAppBar(
                  primary: false,
                  pinned: true,
                  automaticallyImplyLeading: false,
                  toolbarHeight: math.max(
                    44,
                    MediaQuery.textScalerOf(context).scale(17) * 1.3 + 12,
                  ),
                  backgroundColor: colors.surface,
                  surfaceTintColor: Colors.transparent,
                  elevation: 0,
                  scrolledUnderElevation: 0,
                  centerTitle: true,
                  leading: const SizedBox(width: 48),
                  leadingWidth: 48,
                  title: const Text(
                    'Queued',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
                  ),
                  actions: [
                    TextButton(
                      onPressed: _canAct
                          ? () => Navigator.of(context).pop()
                          : null,
                      child: const Text('Done', style: TextStyle(fontSize: 17)),
                    ),
                  ],
                ),
                if (_notice != null)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        _notice!,
                        style: TextStyle(color: colors.error, fontSize: 12),
                      ),
                    ),
                  ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(8, 8, 8, 16),
                  sliver: SliverList.separated(
                    itemCount: drafts.length,
                    itemBuilder: (_, i) => _row(drafts[i]),
                    separatorBuilder: (_, _) => const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 16),
                      child: Divider(height: 1),
                    ),
                  ),
                ),
                SliverToBoxAdapter(
                  child: SizedBox(height: MediaQuery.paddingOf(context).bottom),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
