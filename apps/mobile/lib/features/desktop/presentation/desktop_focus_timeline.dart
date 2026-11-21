import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import '../../../core/presentation/djl_glass.dart';

import '../../../core/design/djl_icons.dart';
import '../../../l10n/l10n.dart';

/// A stable center keeps old rows lazy and stationary while the tail grows.
class DesktopFocusTimeline extends StatefulWidget {
  const DesktopFocusTimeline({
    super.key,
    required this.count,
    required this.itemBuilder,
    this.target,
    this.tailAnchor,
    this.followRevision = 0,
  });
  final int count;
  final int? target;

  /// A durable row before transient response rows that may collapse on completion.
  final int? tailAnchor;
  final int followRevision;
  final IndexedWidgetBuilder itemBuilder;

  static void revealTarget(BuildContext target) {
    final timeline = target
        .findAncestorStateOfType<_DesktopFocusTimelineState>();
    if (timeline == null) {
      Scrollable.ensureVisible(target, alignment: .5);
    } else if (!timeline._focusCancelled) {
      timeline._childFocus = target;
      timeline._refresh();
      WidgetsBinding.instance.ensureVisualUpdate();
    }
  }

  @override
  State<DesktopFocusTimeline> createState() => _DesktopFocusTimelineState();
}

class _DesktopFocusTimelineState extends State<DesktopFocusTimeline> {
  final _scroll = ScrollController(keepScrollOffset: false);
  final _before = GlobalKey(), _center = GlobalKey(), _focusRow = GlobalKey();
  late int _pivot;
  int _epoch = 0;
  late bool _following, _focused;
  bool _dragging = false, _refreshQueued = false, _showLatest = false;
  bool _internalScroll = false;
  bool _focusReady = false;
  bool _focusCancelled = false;
  BuildContext? _childFocus;
  bool _short = false;
  double _anchor = 1;
  double? _anchorPixels;

  int? _target(DesktopFocusTimeline value) {
    final target = value.target;
    return target != null && target >= 0 && target < value.count
        ? target
        : null;
  }

  int get _tail {
    final anchor = widget.tailAnchor;
    return anchor != null && anchor >= 0 && anchor < widget.count
        ? anchor
        : widget.count > 0
        ? widget.count - 1
        : 0;
  }

  @override
  void initState() {
    super.initState();
    final target = _target(widget);
    _focused = target != null;
    _following = !_focused;
    _pivot = target ?? _tail;
    _refresh();
  }

  @override
  void didUpdateWidget(DesktopFocusTimeline oldWidget) {
    super.didUpdateWidget(oldWidget);
    final target = _target(widget);
    if (widget.followRevision != oldWidget.followRevision) {
      _following = true;
      _focused = false;
      _focusReady = false;
      _focusCancelled = true;
      _childFocus = null;
      _dragging = false;
      _showLatest = false;
      _pivot = _tail;
      _epoch++;
    } else if (target != _target(oldWidget)) {
      _focused = target != null;
      _focusReady = false;
      _focusCancelled = false;
      _childFocus = null;
      _following = !_focused;
      _pivot = target ?? _tail;
      _epoch++;
    } else if (oldWidget.count == 0 || _pivot >= widget.count) {
      _pivot = target ?? _tail;
      _epoch++;
    }
    _refresh();
  }

  void _scrollFromTimeline(VoidCallback action) {
    _internalScroll = true;
    try {
      action();
    } finally {
      _internalScroll = false;
    }
  }

  void _refresh() {
    if (_refreshQueued) return;
    _refreshQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _refreshQueued = false;
      if (!mounted || !_scroll.hasClients) return;
      final position = _scroll.position;
      if (!position.hasContentDimensions) return;
      final before =
          _before.currentContext?.findRenderObject() as RenderSliver?;
      final after = _center.currentContext?.findRenderObject() as RenderSliver?;
      if (before?.geometry != null && after?.geometry != null) {
        final content =
            before!.geometry!.scrollExtent + after!.geometry!.scrollExtent;
        final short = content <= position.viewportDimension + .5;
        // Match the center to the available prefix so the first row stays reachable.
        final anchor = position.viewportDimension > 0
            ? (before.geometry!.scrollExtent / position.viewportDimension)
                  .clamp(0.0, 1.0)
                  .toDouble()
            : 0.0;
        if (_short != short || (_anchor - anchor).abs() > .00001) {
          // Preserve row and disclosure state while the viewport anchor changes.
          setState(() {
            _short = short;
            _anchor = anchor;
          });
          _refresh();
          return;
        }
      }
      final previousAnchorPixels = _anchorPixels;
      _anchorPixels =
          (_focused || _short ? 0 : _anchor) * position.viewportDimension;
      if (!_following &&
          !_focused &&
          !_short &&
          !_dragging &&
          previousAnchorPixels != null &&
          (_anchorPixels! - previousAnchorPixels).abs() > .5) {
        _scrollFromTimeline(
          () => _scroll.jumpTo(
            (position.pixels + _anchorPixels! - previousAnchorPixels).clamp(
              position.minScrollExtent,
              position.maxScrollExtent,
            ),
          ),
        );
      }
      if (_focused && !_dragging) {
        if (!_focusReady) {
          // Grouped rows may reveal their own child after the first layout.
          setState(() => _focusReady = true);
          _refresh();
          return;
        }
        final row =
            (_childFocus?.mounted == true ? _childFocus : null)
                ?.findRenderObject() ??
            _focusRow.currentContext?.findRenderObject();
        if (row is RenderBox &&
            row.hasSize &&
            before?.geometry != null &&
            after?.geometry != null) {
          final anchorPixels =
              (_short ? 0 : _anchor) * position.viewportDimension;
          final minimum = (-before!.geometry!.scrollExtent + anchorPixels)
              .clamp(double.negativeInfinity, 0.0);
          final maximum =
              (after!.geometry!.scrollExtent -
                      position.viewportDimension +
                      anchorPixels)
                  .clamp(0.0, double.infinity);
          final revealed = RenderAbstractViewport.of(
            row,
          ).getOffsetToReveal(row, .5).offset;
          final offset = (revealed + anchorPixels - _anchorPixels!).clamp(
            minimum,
            maximum,
          );
          // Measure lazily at the pivot, then change anchor and offset together.
          setState(() {
            _focused = false;
            _anchorPixels = anchorPixels;
            _childFocus = null;
          });
          if ((offset - position.pixels).abs() > .5) {
            _scrollFromTimeline(() => _scroll.jumpTo(offset));
          }
        }
      } else if (!_focusCancelled && !_dragging && _childFocus != null) {
        final target = _childFocus!;
        _childFocus = null;
        if (target.mounted) {
          _scrollFromTimeline(
            () => Scrollable.ensureVisible(target, alignment: .5),
          );
        }
      }
      final destination = _short
          ? position.minScrollExtent
          : position.maxScrollExtent;
      if ((_following || _short) &&
          !_dragging &&
          (destination - position.pixels).abs() > .5) {
        _scrollFromTimeline(() => _scroll.jumpTo(destination));
      }
      final show = !_following && position.extentAfter > 12;
      if (_showLatest != show) setState(() => _showLatest = show);
    });
  }

  bool _scrollChanged(ScrollNotification notification) {
    if (notification.depth != 0) return false;
    if (notification is ScrollStartNotification && !_internalScroll) {
      _dragging = true;
      _following = false;
      _focused = false;
      _focusCancelled = true;
      _childFocus = null;
    } else if (notification is ScrollEndNotification && _dragging) {
      _dragging = false;
      _following = notification.metrics.extentAfter <= 12;
    }
    _refresh();
    return false;
  }

  void _latest() {
    setState(() {
      _following = true;
      _focused = false;
      _focusCancelled = true;
      _childFocus = null;
      _dragging = false;
      _showLatest = false;
      _pivot = _tail;
      _epoch++;
    });
    _refresh();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    Widget row(BuildContext context, int index) => Padding(
      padding: EdgeInsets.only(bottom: index == widget.count - 1 ? 0 : 14),
      child: index == _pivot
          ? KeyedSubtree(
              key: _focusRow,
              child: widget.itemBuilder(context, index),
            )
          : widget.itemBuilder(context, index),
    );
    final pivot = _pivot;
    return Stack(
      children: [
        NotificationListener<ScrollMetricsNotification>(
          onNotification: (notification) {
            if (notification.depth == 0) _refresh();
            return false;
          },
          child: NotificationListener<ScrollNotification>(
            onNotification: _scrollChanged,
            child: _TimelineScrollView(
              key: ValueKey((_epoch, pivot)),
              controller: _scroll,
              center: _center,
              semanticChildCount: widget.count,
              anchor: _focused || _short ? 0 : _anchor,
              physics: _short ? const NeverScrollableScrollPhysics() : null,
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              slivers: [
                SliverPadding(
                  key: _before,
                  padding: EdgeInsets.fromLTRB(16, pivot == 0 ? 0 : 12, 16, 0),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, offset) => row(context, pivot - offset - 1),
                      childCount: pivot,
                      semanticIndexCallback: (_, offset) => pivot - offset - 1,
                    ),
                  ),
                ),
                SliverPadding(
                  key: _center,
                  padding: EdgeInsets.fromLTRB(16, pivot == 0 ? 12 : 0, 16, 12),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, offset) => row(context, pivot + offset),
                      childCount: widget.count - pivot,
                      semanticIndexOffset: pivot,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (_showLatest)
          Positioned(
            bottom: 8,
            left: 0,
            right: 0,
            child: Center(
              child: SizedBox.square(
                dimension: 47,
                child: DjlGlassSurface(
                  radius: 24,
                  child: IconButton(
                    tooltip: context.l10n.chatUiScrollToLatest,
                    onPressed: _latest,
                    icon: const Icon(DjlIcons.arrowDown, size: 17),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _TimelineScrollView extends CustomScrollView {
  const _TimelineScrollView({
    super.key,
    super.controller,
    super.center,
    super.semanticChildCount,
    super.anchor,
    super.physics,
    super.keyboardDismissBehavior,
    super.slivers,
  });

  @override
  Widget buildViewport(
    BuildContext context,
    ViewportOffset offset,
    AxisDirection axisDirection,
    List<Widget> slivers,
  ) => _TimelineViewport(
    axisDirection: axisDirection,
    offset: offset,
    center: center,
    anchor: anchor,
    slivers: slivers,
  );
}

class _TimelineViewport extends Viewport {
  _TimelineViewport({
    required super.axisDirection,
    required super.offset,
    required super.center,
    required super.anchor,
    required super.slivers,
  });

  @override
  RenderViewport createRenderObject(BuildContext context) =>
      _TimelineRenderViewport(
        axisDirection: axisDirection,
        crossAxisDirection: Viewport.getDefaultCrossAxisDirection(
          context,
          axisDirection,
        ),
        anchor: anchor,
        offset: offset,
      );
}

class _TimelineRenderViewport extends RenderViewport {
  _TimelineRenderViewport({
    required super.axisDirection,
    required super.crossAxisDirection,
    required super.anchor,
    required super.offset,
  });

  @override
  RevealedOffset getOffsetToReveal(
    RenderObject target,
    double alignment, {
    Rect? rect,
    Axis? axis,
  }) {
    final revealed = super.getOffsetToReveal(
      target,
      alignment,
      rect: rect,
      axis: axis,
    );
    // Centered slivers paint with this displacement; reveal coordinates must too.
    final displacement = anchor * size.height;
    return RevealedOffset(
      offset: revealed.offset + displacement,
      rect: revealed.rect.translate(0, -displacement),
    );
  }
}
