import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../l10n/l10n.dart';

/// The drawer owns the leading edge on these routes; ordinary route Back is
/// still handled by the Navigator and the page's draft/subagent PopScope.
class DesktopPhoneRoute<T> extends MaterialPageRoute<T> {
  DesktopPhoneRoute({required super.builder});
  @override
  bool get popGestureEnabled => false;
}

class DesktopPhoneDrawer extends StatefulWidget {
  const DesktopPhoneDrawer({
    super.key,
    required this.menu,
    required this.child,
    this.onChanged,
    this.handlesBack = true,
  });
  final Widget menu, child;
  final ValueChanged<bool>? onChanged;
  final bool handlesBack;
  @override
  State<DesktopPhoneDrawer> createState() => DesktopPhoneDrawerState();
}

class DesktopPhoneDrawerState extends State<DesktopPhoneDrawer>
    with SingleTickerProviderStateMixin {
  late final _animation = AnimationController(vsync: this);
  static final _spring = SpringDescription.withDurationAndBounce(
    duration: const Duration(milliseconds: 480),
  );
  final _focus = FocusScopeNode();
  bool _open = false;
  bool get isOpen => _open;
  double _dragStart = 0;
  bool get _reduced => MediaQuery.disableAnimationsOf(context);

  void toggle() => _setOpen(!_open);
  void close() => _setOpen(false);
  void _setOpen(bool value, {double? velocity}) {
    FocusManager.instance.primaryFocus?.unfocus();
    if (value) _focus.requestFocus();
    if (_open != value) {
      setState(() => _open = value);
      widget.onChanged?.call(value);
      HapticFeedback.selectionClick();
    }
    final target = value ? 1.0 : 0.0;
    if (_reduced) {
      _animation.value = target;
    } else {
      _animation.animateWith(
        ScrollSpringSimulation(
          _spring,
          _animation.value,
          target,
          velocity ?? _animation.velocity,
        ),
      );
    }
  }

  @override
  void dispose() {
    _focus.dispose();
    _animation.dispose();
    super.dispose();
  }

  Widget _dragSurface(Widget child, double width, {bool enabled = true}) =>
      RawGestureDetector(
        behavior: HitTestBehavior.translucent,
        gestures: {
          if (enabled)
            _DrawerDrag: GestureRecognizerFactoryWithHandlers<_DrawerDrag>(
              () => _DrawerDrag(),
              (drag) => drag
                ..onStart = () {
                  _animation.stop();
                  _dragStart = _animation.value;
                  FocusManager.instance.primaryFocus?.unfocus();
                }
                ..onCancel = () {
                  _setOpen(_open);
                }
                ..onUpdate = (dx) {
                  _animation.value = (_dragStart + dx / width).clamp(0, 1);
                }
                ..onEnd = (velocity) => _setOpen(
                  _animation.value * width + velocity * .2 > width * .45,
                  velocity: velocity / width,
                ),
            ),
        },
        child: child,
      );

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Widget panel = LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth * .7;
        return AnimatedBuilder(
          animation: _animation,
          builder: (context, _) {
            final progress = _animation.value;
            final radius = BorderRadius.circular(56 * progress);
            final shape = _DrawerPanelShape(borderRadius: radius);
            return _dragSurface(
              ClipRect(
                child: Stack(
                  children: [
                    Positioned.fill(child: ColoredBox(color: scheme.surface)),
                    Positioned(
                      left: _reduced ? 0 : -18 * (1 - progress),
                      top: 0,
                      bottom: 0,
                      width: width,
                      child: Offstage(
                        offstage: progress == 0,
                        child: ExcludeSemantics(
                          excluding: !_open,
                          child: IgnorePointer(
                            ignoring: !_open,
                            child: widget.menu,
                          ),
                        ),
                      ),
                    ),
                    Transform.translate(
                      offset: Offset(width * progress, 0),
                      child: DecoratedBox(
                        // The shadow uses RRect blur; clipping and its border stay continuous.
                        decoration: BoxDecoration(
                          borderRadius: radius,
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(
                                alpha: .16 * progress,
                              ),
                              blurRadius: 47.63,
                              offset: const Offset(-10, 0),
                            ),
                          ],
                        ),
                        child: ClipPath(
                          clipper: ShapeBorderClipper(shape: shape),
                          child: Stack(
                            children: [
                              ExcludeSemantics(
                                excluding: _open,
                                child: IgnorePointer(
                                  ignoring: _open,
                                  child: widget.child,
                                ),
                              ),
                              if (progress > 0)
                                Positioned.fill(
                                  child: Semantics(
                                    label: context.l10n.chatUiCloseNavigation,
                                    button: true,
                                    onTap: close,
                                    child: GestureDetector(
                                      onTap: close,
                                      child: Container(
                                        key: const Key('navigation.scrim'),
                                        decoration: ShapeDecoration(
                                          color: Colors.black.withValues(
                                            alpha: .06 * progress,
                                          ),
                                          shape: shape.copyWith(
                                            side: BorderSide(
                                              width: .5,
                                              color: scheme.onSurface
                                                  .withValues(
                                                    alpha: .04 * progress,
                                                  ),
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    if (!_open)
                      Positioned(
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 24,
                        child: _dragSurface(const SizedBox.expand(), width),
                      ),
                  ],
                ),
              ),
              width,
              enabled: _open,
            );
          },
        );
      },
    );
    return PopScope(
      canPop: !widget.handlesBack || !_open,
      onPopInvokedWithResult: (didPop, result) {
        if (widget.handlesBack && !didPop && _open) close();
      },
      child: FocusScope(
        node: _focus,
        onKeyEvent: (node, event) {
          if (_open &&
              event is KeyDownEvent &&
              event.logicalKey == LogicalKeyboardKey.escape) {
            close();
            return KeyEventResult.handled;
          }
          return KeyEventResult.ignored;
        },
        autofocus: true,
        child: panel,
      ),
    );
  }
}

// Skia substitutes circular corners for direct superellipse draws and clips.
// The framework's generated paths preserve the continuous outline on both renderers.
class _DrawerPanelShape extends RoundedSuperellipseBorder {
  const _DrawerPanelShape({super.borderRadius, super.side});

  @override
  bool get preferPaintInterior => false;

  @override
  _DrawerPanelShape copyWith({
    BorderSide? side,
    BorderRadiusGeometry? borderRadius,
  }) => _DrawerPanelShape(
    side: side ?? this.side,
    borderRadius: borderRadius ?? this.borderRadius,
  );

  @override
  void paint(Canvas canvas, Rect rect, {TextDirection? textDirection}) {
    if (side.style == BorderStyle.none || side.width == 0) return;
    final border = Path()
      ..fillType = PathFillType.evenOdd
      ..addPath(getOuterPath(rect, textDirection: textDirection), Offset.zero)
      ..addPath(getInnerPath(rect, textDirection: textDirection), Offset.zero);
    canvas.drawPath(border, Paint()..color = side.color);
  }
}

class _DrawerDrag extends OneSequenceGestureRecognizer {
  Offset? _start;
  Offset _delta = Offset.zero;
  VelocityTracker? _velocity;
  bool _accepted = false;
  VoidCallback? onStart, onCancel;
  ValueChanged<double>? onUpdate, onEnd;
  @override
  void addAllowedPointer(PointerDownEvent event) {
    if (_start != null) return;
    startTrackingPointer(event.pointer);
    _start = event.position;
    _velocity = VelocityTracker.withKind(event.kind)
      ..addPosition(event.timeStamp, event.position);
  }

  @override
  void handleEvent(PointerEvent event) {
    if (_start == null) return;
    if (event is PointerMoveEvent) {
      _velocity!.addPosition(event.timeStamp, event.position);
      final delta = _delta = event.position - _start!;
      if (!_accepted && delta.distance > 12) {
        if (delta.dx.abs() > 12 && delta.dx.abs() > delta.dy.abs() * 1.25) {
          resolve(GestureDisposition.accepted);
          _accepted = true;
          onStart?.call();
        } else {
          resolve(GestureDisposition.rejected);
          stopTrackingPointer(event.pointer);
          _start = null;
        }
      }
      if (_accepted && delta.dx.abs() > delta.dy.abs() * 1.25) {
        onUpdate?.call(delta.dx);
      }
    } else if (event is PointerUpEvent || event is PointerCancelEvent) {
      if (_accepted) {
        if (event is PointerCancelEvent ||
            _delta.dx.abs() <= _delta.dy.abs() * 1.25) {
          onCancel?.call();
        } else {
          onEnd?.call(_velocity!.getVelocity().pixelsPerSecond.dx);
        }
      }
      resolve(GestureDisposition.rejected);
      stopTrackingPointer(event.pointer);
      _start = null;
      _accepted = false;
    }
  }

  @override
  void rejectGesture(int pointer) {
    stopTrackingPointer(pointer);
    _start = null;
    _accepted = false;
  }

  @override
  void didStopTrackingLastPointer(int pointer) {}
  @override
  String get debugDescription => 'desktop phone navigation';
}
