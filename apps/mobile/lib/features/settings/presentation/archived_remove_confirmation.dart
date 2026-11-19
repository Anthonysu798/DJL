import 'dart:math' as math;
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../../../core/presentation/djl_glass.dart';
import 'settings_group.dart';

Future<bool> showArchivedRemoveConfirmation(
  BuildContext context, {
  required String title,
  required Offset anchor,
}) async {
  final overlay =
      Navigator.of(
            context,
            rootNavigator: true,
          ).overlay!.context.findRenderObject()
          as RenderBox;
  final point = overlay.globalToLocal(anchor);
  final result = await showGeneralDialog<bool>(
    context: context,
    barrierDismissible: true,
    barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
    barrierColor: Colors.black.withValues(alpha: .24),
    transitionDuration: MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 150),
    pageBuilder: (context, _, _) => Builder(
      builder: (context) {
        final colors = Theme.of(context).colorScheme;
        final fill = colors.brightness == Brightness.dark
            ? const Color(0xff161618)
            : Colors.white.withValues(alpha: .97);
        final outline = colors.onSurface.withValues(alpha: .14);
        final layout = _RemovalLayout(point, MediaQuery.paddingOf(context));
        return CustomSingleChildLayout(
          delegate: layout,
          child: CustomPaint(
            painter: _RemovalPointer(layout, fill, outline),
            child: Semantics(
              scopesRoute: true,
              explicitChildNodes: true,
              child: DjlGlassSurface(
                radius: 32,
                useNativeView: false,
                child: Material(
                  color: fill,
                  clipBehavior: Clip.antiAlias,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(32),
                    side: BorderSide(color: outline),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(28, 24, 28, 16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Flexible(
                          child: SingleChildScrollView(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Semantics(
                                  namesRoute: true,
                                  header: true,
                                  child: Text(
                                    'Remove "$title" from this phone?',
                                    style: settingsTextStyle(
                                      context,
                                      17,
                                      weight: FontWeight.w600,
                                      color: colors.onSurface,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  'This only removes the chat from DJL on this phone. Nothing is removed from your paired desktop.',
                                  style: settingsTextStyle(
                                    context,
                                    15,
                                    color: colors.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 20),
                        TextButton(
                          onPressed: () => Navigator.pop(context, true),
                          style: TextButton.styleFrom(
                            backgroundColor: colors.onSurface.withValues(
                              alpha: .10,
                            ),
                            shape: const StadiumBorder(),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 12,
                            ),
                          ),
                          child: Text(
                            'Remove from Phone',
                            textAlign: TextAlign.center,
                            style: settingsTextStyle(
                              context,
                              17,
                              weight: FontWeight.w600,
                              color: CupertinoColors.systemRed.resolveFrom(
                                context,
                              ),
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
      },
    ),
  );
  return result == true;
}

class _RemovalLayout extends SingleChildLayoutDelegate {
  _RemovalLayout(this.anchor, this.padding);
  final Offset anchor;
  final EdgeInsets padding;
  bool above = true;
  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) =>
      BoxConstraints(
        minWidth: math.min(240, math.max(0, constraints.maxWidth - 32)),
        maxWidth: math.min(240, math.max(0, constraints.maxWidth - 32)),
        maxHeight: math.max(0, constraints.maxHeight - padding.vertical - 40),
      );
  @override
  Offset getPositionForChild(Size size, Size childSize) {
    final top = padding.top + 16, bottom = size.height - padding.bottom - 16;
    final target = anchor.dy.clamp(top, bottom);
    above = target - top >= childSize.height + 12;
    final y = above ? target - childSize.height - 12 : target + 12;
    return Offset(
      (size.width - childSize.width) / 2,
      y.clamp(top, math.max(top, bottom - childSize.height)),
    );
  }

  @override
  bool shouldRelayout(_RemovalLayout oldDelegate) =>
      oldDelegate.anchor != anchor || oldDelegate.padding != padding;
}

class _RemovalPointer extends CustomPainter {
  _RemovalPointer(this.layout, this.fill, this.outline);
  final _RemovalLayout layout;
  final Color fill, outline;
  @override
  void paint(Canvas canvas, Size size) {
    final x = size.width / 2, y = layout.above ? size.height - 1 : 1.0;
    final direction = layout.above ? 1.0 : -1.0;
    final path = Path()
      ..moveTo(x - 12, y)
      ..lineTo(x - 3, y + 10 * direction)
      ..quadraticBezierTo(x, y + 13 * direction, x + 3, y + 10 * direction)
      ..lineTo(x + 12, y)
      ..close();
    canvas.drawPath(path, Paint()..color = fill);
    canvas.drawPath(
      path,
      Paint()
        ..color = outline
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
  }

  @override
  bool shouldRepaint(_RemovalPointer oldDelegate) =>
      oldDelegate.layout != layout ||
      oldDelegate.fill != fill ||
      oldDelegate.outline != outline;
}
