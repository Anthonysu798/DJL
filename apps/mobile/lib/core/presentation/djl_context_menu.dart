import 'dart:math' as math;
import 'dart:ui' show SemanticsRole;
import 'package:flutter/material.dart';
import 'djl_glass.dart';

Future<T?> showDjlContextMenu<T>(
  BuildContext context,
  Rect row, {
  required WidgetBuilder actions,
  required Widget preview,
  double initialScale = 1,
  bool useRootNavigator = false,
  Listenable? dismissOnChange,
}) async {
  final navigator = Navigator.of(context, rootNavigator: useRootNavigator);
  CurvedAnimation? backdropFade;
  final route = RawDialogRoute<T>(
    barrierDismissible: true,
    barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
    barrierColor: Colors.transparent,
    transitionDuration: MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 220),
    transitionBuilder: (_, _, _, child) => child,
    pageBuilder: (context, animation, _) {
      final progress = animation.drive(CurveTween(curve: Curves.easeOutQuad));
      final backdrop = backdropFade ??= CurvedAnimation(
        parent: animation,
        curve: Curves.easeOutQuad,
        reverseCurve: Curves.easeInQuad,
      );
      return Stack(
        children: [
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: backdrop,
                builder: (_, _) => BackdropFilter(
                  // Measured native context-menu dimming in sRGB.
                  filter: ColorFilter.matrix([
                    1 - 54 / 255 * backdrop.value,
                    0,
                    0,
                    0,
                    5 * backdrop.value,
                    0,
                    1 - 53 / 255 * backdrop.value,
                    0,
                    0,
                    4 * backdrop.value,
                    0,
                    0,
                    1 - 54 / 255 * backdrop.value,
                    0,
                    9 * backdrop.value,
                    0,
                    0,
                    0,
                    1,
                    0,
                  ]),
                  child: const SizedBox.expand(),
                ),
              ),
            ),
          ),
          CustomMultiChildLayout(
            delegate: _ContextMenuLayout(
              row,
              MediaQuery.of(context),
              animation,
              initialScale,
            ),
            children: [
              LayoutId(
                id: _ContextMenuPart.preview,
                child: ExcludeSemantics(
                  child: IgnorePointer(
                    child: FittedBox(
                      key: const Key('navigation.context-preview'),
                      child: SizedBox(
                        width: row.width,
                        height: row.height,
                        child: preview,
                      ),
                    ),
                  ),
                ),
              ),
              LayoutId(
                id: _ContextMenuPart.actions,
                child: FadeTransition(
                  opacity: progress,
                  child: Semantics(
                    role: SemanticsRole.menu,
                    scopesRoute: true,
                    explicitChildNodes: true,
                    label: 'Chat actions',
                    child: actions(context),
                  ),
                ),
              ),
            ],
          ),
        ],
      );
    },
  );
  final overlays = djlNativeGlassOverlays(navigator);
  overlays.value++;
  void dismiss() {
    if (navigator.mounted && route.isActive) navigator.removeRoute(route);
  }

  dismissOnChange?.addListener(dismiss);
  try {
    final result = await navigator.push(route);
    await route.completed;
    return result;
  } finally {
    dismissOnChange?.removeListener(dismiss);
    backdropFade?.dispose();
    overlays.value--;
  }
}

enum _ContextMenuPart { preview, actions }

class _ContextMenuLayout extends MultiChildLayoutDelegate {
  _ContextMenuLayout(this.row, this.media, this.animation, this.initialScale)
    : super(relayout: animation);
  final Rect row;
  final MediaQueryData media;
  final Animation<double> animation;
  final double initialScale;
  Rect? _previewRect, _exitRect;
  double _exitValue = 1;

  Rect _viewport(Size size) => Rect.fromLTRB(
    math.max(media.viewPadding.left, media.viewInsets.left) + 10,
    math.max(media.viewPadding.top, media.viewInsets.top) + 10,
    size.width - math.max(media.viewPadding.right, media.viewInsets.right) - 10,
    size.height -
        math.max(media.viewPadding.bottom, media.viewInsets.bottom) -
        10,
  );

  @override
  void performLayout(Size size) {
    final visible = _viewport(size);
    const gap = 16.0;
    final scale = math.min(
      1.1,
      math.min(
        math.max(0, visible.width) / row.width,
        math.max(0, visible.height - 62 - gap) / row.height,
      ),
    );
    final preview = row.size * scale;
    final menuWidth = math.min(250.0, math.max(0.0, visible.width));
    final menu = layoutChild(
      _ContextMenuPart.actions,
      BoxConstraints(
        minWidth: menuWidth,
        maxWidth: menuWidth,
        maxHeight: math.max(0.0, visible.height - preview.height - gap),
      ),
    );
    final below = row.center.dy <= visible.center.dy;
    final minimum = below ? visible.top : visible.top + menu.height + gap;
    final maximum = below
        ? visible.bottom - preview.height - menu.height - gap
        : visible.bottom - preview.height;
    final top = (row.center.dy - preview.height / 2)
        .clamp(minimum, math.max(minimum, maximum))
        .toDouble();
    double left(double width) => (row.left + 6).clamp(
      visible.left,
      math.max(visible.left, visible.right - width),
    );
    final target = Offset(left(preview.width), top) & preview;
    if (animation.status == AnimationStatus.reverse || _exitRect != null) {
      if (_exitRect == null) {
        _exitRect = _previewRect ?? target;
        _exitValue = animation.value;
      }
      final t = _exitValue == 0 ? 1.0 : 1 - animation.value / _exitValue;
      _previewRect = Rect.lerp(_exitRect, row, Curves.easeInOut.transform(t));
    } else {
      final held = Rect.fromCenter(
        center: row.center,
        width: row.width * initialScale,
        height: row.height * initialScale,
      );
      _previewRect = Rect.lerp(
        held,
        target,
        Curves.easeOutQuad.transform(animation.value),
      );
    }
    layoutChild(
      _ContextMenuPart.preview,
      BoxConstraints.tight(_previewRect!.size),
    );
    positionChild(_ContextMenuPart.preview, _previewRect!.topLeft);
    positionChild(
      _ContextMenuPart.actions,
      Offset(
        left(menu.width),
        below ? top + preview.height + gap : top - menu.height - gap,
      ),
    );
  }

  @override
  bool shouldRelayout(_ContextMenuLayout oldDelegate) =>
      oldDelegate.row != row ||
      oldDelegate.media != media ||
      oldDelegate.animation != animation ||
      oldDelegate.initialScale != initialScale;
}
