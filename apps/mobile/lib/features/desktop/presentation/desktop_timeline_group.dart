import 'package:flutter/cupertino.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../domain/desktop_timeline_projection.dart';
import 'desktop_focus_timeline.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

class DesktopTimelineGroup extends StatefulWidget {
  const DesktopTimelineGroup({
    super.key,
    required this.item,
    required this.itemBuilder,
    this.footer,
    this.focusedRawIndex,
  });
  final DesktopTimelineItem item;
  final IndexedWidgetBuilder itemBuilder;
  final Widget? footer;
  final int? focusedRawIndex;

  @override
  State<DesktopTimelineGroup> createState() => _DesktopTimelineGroupState();
}

class _DesktopTimelineGroupState extends State<DesktopTimelineGroup> {
  final _focus = GlobalKey();
  bool _expanded = false, _focusPending = false, _focusAfterAnimation = false;
  int _focusRevision = 0;

  bool get _hasFocus =>
      widget.focusedRawIndex != null &&
      widget.item.indices.contains(widget.focusedRawIndex);
  void _revealFocus() {
    _focusRevision++;
    _focusPending = _hasFocus;
    final reveal =
        _hasFocus &&
        !widget.item.collapsedIndices.contains(widget.focusedRawIndex);
    _focusAfterAnimation = reveal && !_expanded;
    if (reveal) _expanded = true;
  }

  @override
  void initState() {
    super.initState();
    _revealFocus();
    _focusAfterAnimation = false;
  }

  @override
  void didUpdateWidget(DesktopTimelineGroup oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.focusedRawIndex != oldWidget.focusedRawIndex) _revealFocus();
  }

  String get _title {
    final item = widget.item;
    if (item.kind == DesktopTimelineKind.previous) {
      return item.indices.length == 1
          ? '1 previous message'
          : '${item.indices.length} previous messages';
    }
    if (item.kind == DesktopTimelineKind.toolBurst) {
      return '+${item.indices.length - 1} tool calls';
    }
    final count = item.commandIndices.length;
    return [
      count == 1 ? 'Ran 1 command' : 'Ran $count commands',
      if (item.failedCommandCount > 0) '${item.failedCommandCount} failed',
      if (item.stoppedCommandCount > 0) '${item.stoppedCommandCount} stopped',
    ].join(' · ');
  }

  void _toggle() => setState(() {
    _focusRevision++;
    _focusPending = false;
    _focusAfterAnimation = false;
    _expanded = !_expanded;
  });

  void _scrollFocusAfterLayout() {
    final revision = _focusRevision;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || revision != _focusRevision) return;
      final target = _focus.currentContext;
      if (target != null) DesktopFocusTimeline.revealTarget(target);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_focusPending) {
      _focusPending = false;
      _scrollFocusAfterLayout();
    }
    final commands = widget.item.kind == DesktopTimelineKind.commands;
    final previous = widget.item.kind == DesktopTimelineKind.previous;
    final leadingDisclosure = commands || previous;
    final color = DjlColors.of(context).inkMuted;
    final scaler = MediaQuery.textScalerOf(context);
    final disclosure = Semantics(
      container: true,
      button: true,
      expanded: _expanded,
      label: _title,
      hint:
          '${_expanded ? 'Collapse' : 'Expand'} ${previous
              ? 'previous messages'
              : commands
              ? 'commands'
              : 'tool calls'}',
      onTap: _toggle,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _toggle,
        child: ConstrainedBox(
          constraints: BoxConstraints(
            minWidth: 44,
            minHeight: previous ? 0 : 44,
          ),
          child: Row(
            children: [
              if (commands) ...[
                SvgPicture.asset(
                  'assets/icons/command/central-console.svg',
                  width: scaler.scale(17),
                  height: scaler.scale(17),
                  colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
                  excludeFromSemantics: true,
                ),
                const SizedBox(width: 8),
              ],
              if (leadingDisclosure)
                Flexible(
                  child: Text(
                    _title,
                    style: TextStyle(
                      fontSize: previous ? 15 : 17,
                      height: previous ? 1.2 : null,
                      color: color,
                    ),
                  ),
                ),
              if (leadingDisclosure) const SizedBox(width: 8),
              AnimatedRotation(
                turns: _expanded ? .25 : 0,
                duration: const Duration(milliseconds: 180),
                child: Icon(
                  DjlIcons.chevronRight,
                  size: scaler.scale(previous ? 14 : 13),
                  color: color,
                ),
              ),
              if (!leadingDisclosure) ...[
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    _title,
                    style: TextStyle(fontSize: 17, color: color),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
    final children = <Widget>[];
    void append(Widget child, {double? gap}) {
      if (children.isNotEmpty) {
        children.add(SizedBox(height: gap ?? (leadingDisclosure ? 10 : 14)));
      }
      children.add(child);
    }

    if (leadingDisclosure) append(disclosure);
    final visible = _expanded
        ? widget.item.indices
        : widget.item.collapsedIndices;
    for (final index in visible) {
      append(
        KeyedSubtree(
          key: index == widget.focusedRawIndex ? _focus : ValueKey(index),
          child: widget.itemBuilder(context, index),
        ),
      );
    }
    if (!leadingDisclosure) append(disclosure);
    if (previous) {
      append(Container(height: 1, color: color.withValues(alpha: .18)));
    }
    if (widget.footer case final Widget footer) {
      // The existing Copy widget contributes its own four-point top inset.
      append(footer, gap: commands ? 6 : 10);
    }
    return AnimatedSize(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeInOut,
      alignment: Alignment.topLeft,
      onEnd: () {
        if (!_focusAfterAnimation || !_expanded) return;
        _focusAfterAnimation = false;
        _scrollFocusAfterLayout();
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    );
  }
}
