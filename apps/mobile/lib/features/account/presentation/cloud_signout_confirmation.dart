import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../core/presentation/cloud_chrome.dart';
import '../../../core/presentation/djl_glass.dart';

import '../../../core/design/djl_tokens.dart';
import '../../../l10n/l10n.dart';

Future<bool> showCloudSignOutConfirmation(BuildContext context) async {
  final result = await showGeneralDialog<bool>(
    context: context,
    barrierDismissible: true,
    barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
    barrierColor: Colors.transparent,
    transitionDuration: MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 150),
    pageBuilder: (context, _, _) {
      final media = MediaQuery.of(context);
      final colors = Theme.of(context).colorScheme;
      final fill = colors.surfaceContainerLow;
      final outline = colors.onSurface.withValues(alpha: .14);
      return Padding(
        padding: EdgeInsets.fromLTRB(
          16,
          media.viewPadding.top + 10,
          16,
          math.max(media.viewPadding.bottom, media.viewInsets.bottom) + 24,
        ),
        child: Align(
          alignment: Alignment.topCenter,
          child: SizedBox(
            width: 240,
            child: CustomPaint(
              painter: _SignOutPointer(fill, outline),
              child: Semantics(
                scopesRoute: true,
                explicitChildNodes: true,
                child: DjlGlassSurface(
                  radius: 40,
                  useNativeView: false,
                  child: Material(
                    key: const ValueKey('cloud-signout-confirmation'),
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
                              child: Semantics(
                                namesRoute: true,
                                header: true,
                                child: Text(
                                  context.l10n.accountSignOutTitle,
                                  textAlign: TextAlign.center,
                                  style: cloudBodyStyle.copyWith(
                                    letterSpacing: 0,
                                    color: colors.onSurface,
                                  ),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 18),
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
                              context.l10n.accountSignOut,
                              textAlign: TextAlign.center,
                              style: cloudBodyStyle.copyWith(
                                letterSpacing: 0,
                                fontWeight: FontWeight.w600,
                                color: DjlColors.of(context).danger,
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
          ),
        ),
      );
    },
  );
  return result == true;
}

class _SignOutPointer extends CustomPainter {
  _SignOutPointer(this.fill, this.outline);
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
  bool shouldRepaint(_SignOutPointer oldDelegate) =>
      oldDelegate.fill != fill || oldDelegate.outline != outline;
}
