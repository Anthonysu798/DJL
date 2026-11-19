import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../../core/presentation/djl_glass.dart';
import 'desktop_composer_options_menu.dart';

import '../../../core/design/djl_icons.dart';

class DesktopProjectControls extends StatefulWidget {
  const DesktopProjectControls({
    super.key,
    required this.branchLabel,
    required this.worktree,
    required this.branchEnabled,
    required this.handoffEnabled,
    required this.handoffLabel,
    required this.onExpand,
    required this.onBranch,
    required this.onHandoff,
  });
  final String? branchLabel;
  final bool worktree, branchEnabled, handoffEnabled;
  final String handoffLabel;
  final VoidCallback onExpand, onHandoff;
  final ValueChanged<BuildContext> onBranch;

  @override
  State<DesktopProjectControls> createState() => _DesktopProjectControlsState();
}

class _DesktopProjectControlsState extends State<DesktopProjectControls>
    with SingleTickerProviderStateMixin {
  final _portal = OverlayPortalController();
  final _link = LayerLink();
  final _anchor = GlobalKey();
  bool _expanded = false;
  late final AnimationController _reveal;
  late final Animation<double> _scale;
  late final Animation<double> _rotation;

  @override
  void initState() {
    super.initState();
    _reveal = AnimationController.unbounded(vsync: this)
      ..addStatusListener((status) {
        if (status == AnimationStatus.dismissed && !_expanded && mounted) {
          _portal.hide();
        }
      });
    _scale = Tween<double>(begin: .01, end: 1).animate(_reveal);
    _rotation = Tween<double>(begin: 0, end: -.25).animate(_reveal);
  }

  @override
  void dispose() {
    _reveal.dispose();
    super.dispose();
  }

  void _toggle() {
    setState(() => _expanded = !_expanded);
    if (_expanded) {
      _portal.show();
      widget.onExpand();
    }
    if (MediaQuery.disableAnimationsOf(context)) {
      _reveal.value = _expanded ? 1 : 0;
      if (!_expanded) _portal.hide();
    } else {
      final response = _expanded ? .34 : .26;
      final spring = SpringDescription.withDampingRatio(
        mass: 1,
        stiffness: math.pow(2 * math.pi / response, 2).toDouble(),
        ratio: _expanded ? .86 : 1,
      );
      final simulation = ScrollSpringSimulation(
        spring,
        _reveal.value,
        _expanded ? 1 : 0,
        _reveal.velocity,
      );
      if (_expanded) {
        _reveal.animateWith(simulation);
      } else {
        _reveal.animateBackWith(simulation);
      }
    }
  }

  Widget _icon(String name, {double size = 16, bool enabled = true}) =>
      SvgPicture.asset(
        'assets/icons/command/$name.svg',
        width: size,
        height: size,
        colorFilter: ColorFilter.mode(
          Theme.of(
            context,
          ).colorScheme.onSurfaceVariant.withValues(alpha: enabled ? 1 : .38),
          BlendMode.srcIn,
        ),
      );

  Widget _pill(String title, String icon, {bool enabled = true}) =>
      DjlGlassSurface(
        radius: 999,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _icon(icon, enabled: enabled),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontSize: 15,
                    color: Theme.of(context).colorScheme.onSurfaceVariant
                        .withValues(alpha: enabled ? 1 : .38),
                  ),
                ),
              ),
            ],
          ),
        ),
      );

  Widget _runtime() => Builder(
    builder: (anchor) => Tooltip(
      message: 'Runtime',
      child: Semantics(
        button: true,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(999),
            onTap: () async {
              final value = await showDesktopComposerMenu(
                context: anchor,
                allowBelow: true,
                items: [
                  const PopupMenuItem<String>(
                    enabled: false,
                    height: 32,
                    child: Text('Continue in', style: TextStyle(fontSize: 12)),
                  ),
                  PopupMenuItem<String>(
                    value: 'worktree',
                    enabled: widget.handoffEnabled,
                    height: 44,
                    child: Row(
                      children: [
                        _icon(
                          'central-arrow-split-right',
                          enabled: widget.handoffEnabled,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            widget.handoffLabel,
                            style: const TextStyle(fontSize: 17),
                          ),
                        ),
                      ],
                    ),
                  ),
                  PopupMenuItem<String>(
                    enabled: false,
                    height: 44,
                    child: Row(
                      children: [
                        _icon('central-macbook-air', enabled: false),
                        const SizedBox(width: 12),
                        const Text('Local', style: TextStyle(fontSize: 17)),
                      ],
                    ),
                  ),
                ],
              );
              if (mounted && value == 'worktree' && widget.handoffEnabled) {
                widget.onHandoff();
              }
            },
            child: _pill(
              widget.worktree ? 'Worktree' : 'Local',
              widget.worktree
                  ? 'central-arrow-split-right'
                  : 'central-macbook-air',
            ),
          ),
        ),
      ),
    ),
  );

  Widget _floating(BuildContext context) {
    final target = _anchor.currentContext?.findRenderObject();
    final overlay = Overlay.of(context).context.findRenderObject();
    if (target is! RenderBox || overlay is! RenderBox || !target.hasSize) {
      return const SizedBox.shrink();
    }
    final top = target.localToGlobal(Offset.zero, ancestor: overlay).dy;
    final media = MediaQuery.of(context);
    final view = View.of(context);
    final available = math.max(
      0.0,
      top - view.viewPadding.top / view.devicePixelRatio - 18,
    );
    return Positioned.fill(
      child: Stack(
        children: [
          CompositedTransformFollower(
            link: _link,
            showWhenUnlinked: false,
            targetAnchor: Alignment.topLeft,
            followerAnchor: Alignment.bottomLeft,
            offset: const Offset(0, -10),
            child: IgnorePointer(
              ignoring: !_expanded,
              child: AnimatedBuilder(
                animation: _reveal,
                builder: (_, child) =>
                    Opacity(opacity: _reveal.value.clamp(0, 1), child: child),
                child: ScaleTransition(
                  alignment: Alignment.bottomLeft,
                  scale: _scale,
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      maxHeight: available,
                      maxWidth: math.min(
                        260,
                        math.max(0, media.size.width - 24),
                      ),
                    ),
                    child: SingleChildScrollView(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (widget.branchLabel case final branch?) ...[
                            Builder(
                              builder: (anchor) => Tooltip(
                                message: 'Current Branch',
                                child: Semantics(
                                  button: true,
                                  enabled: widget.branchEnabled,
                                  child: Material(
                                    color: Colors.transparent,
                                    child: InkWell(
                                      borderRadius: BorderRadius.circular(999),
                                      onTap: widget.branchEnabled
                                          ? () => widget.onBranch(anchor)
                                          : null,
                                      child: _pill(
                                        branch,
                                        'git-branch',
                                        enabled: widget.branchEnabled,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 10),
                          ],
                          _runtime(),
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

  @override
  Widget build(BuildContext context) => OverlayPortal(
    controller: _portal,
    overlayChildBuilder: _floating,
    child: CompositedTransformTarget(
      key: _anchor,
      link: _link,
      child: DjlGlassSurface(
        radius: 999,
        child: SizedBox.square(
          dimension: 34,
          child: IconButton(
            tooltip: _expanded
                ? 'Collapse project controls'
                : 'Expand project controls',
            onPressed: _toggle,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints.tightFor(width: 34, height: 34),
            style: IconButton.styleFrom(
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            icon: RotationTransition(
              turns: _rotation,
              child: Icon(
                DjlIcons.chevronRight,
                size: 14,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
