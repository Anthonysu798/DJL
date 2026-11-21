import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../core/presentation/cloud_chrome.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../../l10n/l10n.dart';

Future<bool> showCloudUsageResetConfirmation(
  BuildContext context,
  Rect banner,
) async {
  final result = await showGeneralDialog<bool>(
    context: context,
    barrierDismissible: true,
    barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
    barrierColor: Colors.transparent,
    transitionDuration: MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 150),
    pageBuilder: (context, _, _) {
      final colors = Theme.of(context).colorScheme;
      final fill = colors.surfaceContainerLow;
      final outline = colors.onSurface.withValues(alpha: .14);
      return CustomSingleChildLayout(
        delegate: _UsageReviewLayout(banner, MediaQuery.of(context)),
        child: CustomPaint(
          painter: _UsageReviewPointer(fill, outline),
          child: Semantics(
            scopesRoute: true,
            explicitChildNodes: true,
            child: DjlGlassSurface(
              radius: 40,
              useNativeView: false,
              child: Material(
                key: const ValueKey('cloud-usage-reset-confirmation'),
                color: fill,
                clipBehavior: Clip.antiAlias,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(40),
                  side: BorderSide(color: outline),
                ),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 22, 16, 16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Flexible(
                        child: SingleChildScrollView(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 14),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Semantics(
                                  namesRoute: true,
                                  header: true,
                                  child: Text(
                                    context.l10n.cloudChatUseBankedResetTitle,
                                    textAlign: TextAlign.center,
                                    style: cloudBodyStyle.copyWith(
                                      letterSpacing: 0,
                                      fontWeight: FontWeight.w600,
                                      color: colors.onSurface,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  context.l10n.cloudChatUseBankedResetBody,
                                  style: cloudBodyStyle.copyWith(
                                    fontSize: 15,
                                    height: 1.3,
                                    letterSpacing: 0,
                                    color: colors.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),
                      TextButton(
                        onPressed: () => Navigator.pop(context, true),
                        style: TextButton.styleFrom(
                          minimumSize: const Size(0, 48),
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
                          context.l10n.cloudChatUseReset,
                          textAlign: TextAlign.center,
                          style: cloudBodyStyle.copyWith(
                            letterSpacing: 0,
                            fontWeight: FontWeight.w600,
                            color: colors.onSurface,
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
  );
  return result == true;
}

class _UsageReviewLayout extends SingleChildLayoutDelegate {
  _UsageReviewLayout(this.banner, this.media);
  final Rect banner;
  final MediaQueryData media;
  Rect viewport(Size size) => Rect.fromLTRB(
    math.max(media.viewPadding.left, media.viewInsets.left) + 16,
    math.max(media.viewPadding.top, media.viewInsets.top) + 10,
    size.width - math.max(media.viewPadding.right, media.viewInsets.right) - 16,
    size.height -
        math.max(media.viewPadding.bottom, media.viewInsets.bottom) -
        10,
  );
  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) {
    final visible = viewport(constraints.biggest),
        width = math.min(240.0, math.max(0.0, visible.width));
    return BoxConstraints(
      minWidth: width,
      maxWidth: width,
      maxHeight: math.max(0, visible.height),
    );
  }

  @override
  Offset getPositionForChild(Size size, Size childSize) {
    final visible = viewport(size);
    return Offset(
      (banner.center.dx - childSize.width / 2).clamp(
        visible.left,
        math.max(visible.left, visible.right - childSize.width),
      ),
      (banner.top - childSize.height - 14).clamp(
        visible.top,
        math.max(visible.top, visible.bottom - childSize.height),
      ),
    );
  }

  @override
  bool shouldRelayout(_UsageReviewLayout old) =>
      banner != old.banner || media != old.media;
}

class _UsageReviewPointer extends CustomPainter {
  _UsageReviewPointer(this.fill, this.outline);
  final Color fill, outline;
  @override
  void paint(Canvas canvas, Size size) {
    final x = size.width / 2, y = size.height - 1;
    final path = Path()
      ..moveTo(x - 12, y)
      ..lineTo(x - 3, y + 10)
      ..quadraticBezierTo(x, y + 13, x + 3, y + 10)
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
  bool shouldRepaint(_UsageReviewPointer old) =>
      fill != old.fill || outline != old.outline;
}
