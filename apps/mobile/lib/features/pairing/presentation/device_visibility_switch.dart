import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class DeviceVisibilitySwitch extends StatefulWidget {
  const DeviceVisibilitySwitch({
    super.key,
    required this.value,
    required this.onChanged,
    this.focusNode,
  });

  final bool value;
  final ValueChanged<bool>? onChanged;
  final FocusNode? focusNode;

  @override
  State<DeviceVisibilitySwitch> createState() => _DeviceVisibilitySwitchState();
}

class _DeviceVisibilitySwitchState extends State<DeviceVisibilitySwitch>
    with TickerProviderStateMixin, ToggleableStateMixin {
  bool _dragging = false;

  @override
  bool get value => widget.value;
  @override
  bool get tristate => false;
  @override
  ValueChanged<bool?>? get onChanged =>
      widget.onChanged == null ? null : (next) => _propose(next!);

  void _propose(bool next) {
    if (!isInteractive || next == widget.value) return;
    unawaited(HapticFeedback.lightImpact());
    widget.onChanged!(next);
  }

  void _settle() {
    position
      ..curve = Curves.easeInOut
      ..reverseCurve = Curves.easeInOut;
    if (MediaQuery.disableAnimationsOf(context)) {
      positionController.value = widget.value ? 1 : 0;
    } else {
      animateToValue();
    }
  }

  @override
  void didUpdateWidget(DeviceVisibilitySwitch oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.value != widget.value ||
        (oldWidget.onChanged != null && widget.onChanged == null)) {
      _dragging = false;
      _settle();
    }
  }

  void _dragStart(DragStartDetails details) {
    positionController.stop();
    position
      ..curve = Curves.linear
      ..reverseCurve = Curves.linear;
    _dragging = true;
  }

  void _dragUpdate(DragUpdateDetails details) {
    if (!_dragging || !isInteractive) return;
    final direction = Directionality.of(context) == TextDirection.rtl ? -1 : 1;
    positionController.value =
        (positionController.value + direction * details.delta.dx / 22).clamp(
          0,
          1,
        );
  }

  void _dragEnd(DragEndDetails details) {
    if (!_dragging) return;
    _dragging = false;
    _propose(positionController.value >= .5);
    _settle();
  }

  void _dragCancel() {
    if (!_dragging) return;
    _dragging = false;
    _settle();
  }

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context) && !_dragging) {
      positionController.value = widget.value ? 1 : 0;
    }
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      toggled: widget.value,
      child: GestureDetector(
        excludeFromSemantics: true,
        onHorizontalDragStart: isInteractive ? _dragStart : null,
        onHorizontalDragUpdate: isInteractive ? _dragUpdate : null,
        onHorizontalDragEnd: isInteractive ? _dragEnd : null,
        onHorizontalDragCancel: isInteractive ? _dragCancel : null,
        child: Opacity(
          opacity: isInteractive ? 1 : .5,
          child: buildToggleable(
            focusNode: widget.focusNode,
            size: const Size(63, 48),
            painter: _VisibilitySwitchPainter(
              position: position,
              rtl: Directionality.of(context) == TextDirection.rtl,
              focused: isInteractive && states.contains(WidgetState.focused),
              focusColor: colors.onSurface.withValues(alpha: .5),
              onColor: colors.primary,
              offColor: colors.outline,
              onThumbColor: colors.onPrimary,
            ),
          ),
        ),
      ),
    );
  }
}

class _VisibilitySwitchPainter extends CustomPainter {
  _VisibilitySwitchPainter({
    required this.position,
    required this.rtl,
    required this.focused,
    required this.focusColor,
    required this.onColor,
    required this.offColor,
    required this.onThumbColor,
  }) : super(repaint: position);

  final Animation<double> position;
  final bool rtl, focused;
  final Color focusColor, onColor, offColor, onThumbColor;

  @override
  void paint(Canvas canvas, Size size) {
    final track = RRect.fromRectAndRadius(
      Rect.fromLTWH(0, (size.height - 28) / 2, 63, 28),
      const Radius.circular(14),
    );
    canvas.drawRRect(
      track,
      Paint()..color = Color.lerp(offColor, onColor, position.value)!,
    );
    if (focused) {
      canvas.drawRRect(
        track.deflate(1),
        Paint()
          ..color = focusColor
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
    }
    final fraction = rtl ? 1 - position.value : position.value;
    final thumb = RRect.fromRectAndRadius(
      Rect.fromLTWH(2 + 22 * fraction, (size.height - 24) / 2, 37, 24),
      const Radius.circular(12),
    );
    canvas.save();
    canvas.clipRRect(track);
    canvas.drawShadow(
      Path()..addRRect(thumb),
      Colors.black.withValues(alpha: .12),
      1,
      true,
    );
    canvas.drawRRect(
      thumb,
      Paint()..color = Color.lerp(Colors.white, onThumbColor, position.value)!,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(_VisibilitySwitchPainter oldDelegate) =>
      oldDelegate.position != position ||
      oldDelegate.rtl != rtl ||
      oldDelegate.focused != focused ||
      oldDelegate.focusColor != focusColor ||
      oldDelegate.onColor != onColor ||
      oldDelegate.offColor != offColor ||
      oldDelegate.onThumbColor != onThumbColor;
}
