import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

/// Auth's capsule picker, with a presentation-only thumb until drag release.
class AuthMethodSelector<T extends Object> extends StatefulWidget {
  const AuthMethodSelector({
    super.key,
    required this.value,
    required this.children,
    this.onChanged,
  });
  final T value;
  final Map<T, Widget> children;
  final ValueChanged<T>? onChanged;

  @override
  State<AuthMethodSelector<T>> createState() => _AuthMethodSelectorState<T>();
}

class _AuthMethodSelectorState<T extends Object>
    extends State<AuthMethodSelector<T>> {
  final _bounds = GlobalKey();
  T? _preview;
  int? _pointer;
  bool _dragAllowed = false, _dragging = false;
  bool get _enabled => widget.onChanged != null;

  void _clearGesture() {
    _preview = null;
    _dragAllowed = false;
    _dragging = false;
  }

  @override
  void didUpdateWidget(covariant AuthMethodSelector<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.value != widget.value || !_enabled) _clearGesture();
  }

  T _at(Offset globalPosition) {
    final box = _bounds.currentContext!.findRenderObject()! as RenderBox;
    var x = box.globalToLocal(globalPosition).dx / box.size.width;
    if (Directionality.of(context) == TextDirection.rtl) x = 1 - x;
    final index = (x * widget.children.length).floor().clamp(
      0,
      widget.children.length - 1,
    );
    return widget.children.keys.elementAt(index);
  }

  void _cancel() {
    if (_preview != null) {
      setState(_clearGesture);
    } else {
      _clearGesture();
    }
  }

  void _activate(T value) {
    if (_enabled && value != widget.value) widget.onChanged!(value);
  }

  @override
  Widget build(BuildContext context) {
    final keys = widget.children.keys.toList();
    final index = keys.indexOf(_preview ?? widget.value);
    final duration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 200);
    return Listener(
      onPointerDown: (event) {
        if (_pointer != null) return;
        _pointer = event.pointer;
        _dragAllowed = _enabled;
      },
      onPointerUp: (event) {
        if (event.pointer == _pointer) _pointer = null;
      },
      onPointerCancel: (event) {
        if (event.pointer != _pointer) return;
        _pointer = null;
        // Drag recognizers may report an end after a pointer cancellation.
        _cancel();
      },
      child: DecoratedBox(
        decoration: ShapeDecoration(
          shape: const StadiumBorder(),
          color: CupertinoColors.tertiarySystemFill.resolveFrom(context),
        ),
        child: Padding(
          padding: const EdgeInsets.all(2),
          child: Stack(
            key: _bounds,
            children: [
              Positioned.fill(
                child: IgnorePointer(
                  child: AnimatedAlign(
                    alignment: AlignmentDirectional(
                      index * 2 / (keys.length - 1) - 1,
                      0,
                    ),
                    duration: duration,
                    curve: Curves.easeInOut,
                    child: FractionallySizedBox(
                      widthFactor: 1 / keys.length,
                      heightFactor: 1,
                      child: DecoratedBox(
                        key: const Key('auth_method_thumb'),
                        decoration: ShapeDecoration(
                          shape: const StadiumBorder(),
                          color: CupertinoDynamicColor.resolve(
                            const CupertinoDynamicColor.withBrightness(
                              color: Colors.white,
                              darkColor: Color(0xff636366),
                            ),
                            context,
                          ),
                          shadows: const [
                            BoxShadow(
                              color: Color(0x0a000000),
                              blurRadius: 2,
                              offset: Offset(0, 1),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              Row(
                children: [
                  for (final item in widget.children.entries)
                    Expanded(
                      child: MergeSemantics(
                        child: Semantics(
                          selected: item.key == widget.value,
                          inMutuallyExclusiveGroup: true,
                          child: GestureDetector(
                            onHorizontalDragStart:
                                _enabled && item.key == widget.value
                                ? (_) {
                                    if (!_dragAllowed) return;
                                    _dragging = true;
                                  }
                                : null,
                            onHorizontalDragUpdate:
                                _enabled && item.key == widget.value
                                ? (details) {
                                    if (!_dragAllowed || !_dragging) return;
                                    setState(
                                      () => _preview = _at(
                                        details.globalPosition,
                                      ),
                                    );
                                  }
                                : null,
                            onHorizontalDragEnd:
                                _enabled && item.key == widget.value
                                ? (_) {
                                    final next = _preview;
                                    final commit = _dragAllowed && _dragging;
                                    _cancel();
                                    if (commit && next != null) _activate(next);
                                  }
                                : null,
                            onHorizontalDragCancel:
                                _enabled && item.key == widget.value
                                ? _cancel
                                : null,
                            child: TextButton(
                              onPressed: _enabled
                                  ? () => _activate(item.key)
                                  : null,
                              style: TextButton.styleFrom(
                                foregroundColor: CupertinoColors.label
                                    .resolveFrom(context),
                                disabledForegroundColor: CupertinoColors
                                    .tertiaryLabel
                                    .resolveFrom(context),
                                minimumSize: const Size(0, 28),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 4,
                                ),
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                shape: const StadiumBorder(),
                                splashFactory: NoSplash.splashFactory,
                                animationDuration: duration,
                                textStyle: DefaultTextStyle.of(context).style,
                              ),
                              child: item.value,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
