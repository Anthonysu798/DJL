import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../core/presentation/cloud_chrome.dart';
import '../../../core/presentation/djl_context_menu.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../chat/domain/cloud_models.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

Future<String?> showCloudChatActions(
  BuildContext context,
  Conversation item,
  Rect row, {
  required Widget preview,
  Listenable? dismissOnChange,
}) => showDjlContextMenu<String>(
  context,
  row,
  preview: preview,
  useRootNavigator: true,
  dismissOnChange: dismissOnChange,
  actions: (context) {
    final colors = Theme.of(context).colorScheme;
    return _cloudMenuSurface(
      context,
      false,
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final action in [
              ('pin', item.pinned ? 'Unpin' : 'Pin', DjlIcons.pin),
              ('rename', 'Rename', DjlIcons.edit),
              ('archive', 'Archive', DjlIcons.archive),
              ('delete', 'Delete', DjlIcons.delete),
            ])
              TextButton(
                onPressed: () => Navigator.pop(context, action.$1),
                style: TextButton.styleFrom(
                  foregroundColor: action.$1 == 'delete'
                      ? DjlColors.of(context).danger
                      : colors.onSurface,
                  minimumSize: const Size(0, 42),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 32,
                    vertical: 10,
                  ),
                  shape: const RoundedRectangleBorder(),
                  alignment: Alignment.centerLeft,
                  textStyle: cloudBodyStyle.copyWith(letterSpacing: 0),
                ),
                child: Row(
                  children: [
                    Icon(action.$3, size: 20),
                    const SizedBox(width: 12),
                    Expanded(child: Text(action.$2)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  },
);

Future<bool> showCloudChatDeleteConfirmation(
  BuildContext context,
  Rect menu,
) async =>
    await _show<bool>(context, menu, (context) {
      final colors = Theme.of(context).colorScheme;
      return Padding(
        padding: const EdgeInsets.all(16),
        child: TextButton(
          onPressed: () => Navigator.pop(context, true),
          style: TextButton.styleFrom(
            backgroundColor: colors.onSurface.withValues(alpha: .10),
            minimumSize: const Size(0, 48),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
            shape: const StadiumBorder(),
          ),
          child: Text(
            'Delete',
            textAlign: TextAlign.center,
            style: cloudBodyStyle.copyWith(
              letterSpacing: 0,
              fontWeight: FontWeight.w600,
              color: DjlColors.of(context).danger,
            ),
          ),
        ),
      );
    }) ==
    true;

Future<T?> _show<T>(BuildContext context, Rect anchor, WidgetBuilder builder) =>
    showGeneralDialog<T>(
      context: context,
      barrierDismissible: true,
      barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
      barrierColor: Colors.transparent,
      transitionDuration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 150),
      pageBuilder: (context, _, _) {
        return CustomSingleChildLayout(
          delegate: _DeleteLayout(anchor, MediaQuery.of(context)),
          child: Semantics(
            scopesRoute: true,
            explicitChildNodes: true,
            label: 'Delete this chat?',
            child: _cloudMenuSurface(context, true, builder(context)),
          ),
        );
      },
    );

Widget _cloudMenuSurface(
  BuildContext context,
  bool confirmation,
  Widget child,
) {
  final colors = Theme.of(context).colorScheme;
  final fill = colors.surfaceContainerLow;
  final outline = colors.onSurface.withValues(alpha: .14);
  return CustomPaint(
    painter: confirmation ? _DeletePointer(fill, outline) : null,
    child: DjlGlassSurface.menu(
      radius: confirmation ? 28 : 34,
      child: Material(
        key: ValueKey(
          confirmation
              ? 'cloud-chat-delete-confirmation'
              : 'cloud-chat-actions',
        ),
        color: Colors.transparent,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(confirmation ? 28 : 34),
        ),
        child: SizedBox(
          width: double.infinity,
          child: SingleChildScrollView(child: child),
        ),
      ),
    ),
  );
}

class _DeleteLayout extends SingleChildLayoutDelegate {
  _DeleteLayout(this.anchor, this.media);
  final Rect anchor;
  final MediaQueryData media;
  Rect viewport(Size size) => Rect.fromLTRB(
    math.max(media.viewPadding.left, media.viewInsets.left) + 10,
    math.max(media.viewPadding.top, media.viewInsets.top) + 10,
    size.width - math.max(media.viewPadding.right, media.viewInsets.right) - 10,
    size.height -
        math.max(media.viewPadding.bottom, media.viewInsets.bottom) -
        10,
  );
  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) {
    final visible = viewport(constraints.biggest);
    final width = math.min(240.0, math.max(0.0, visible.width));
    return BoxConstraints(
      minWidth: width,
      maxWidth: width,
      maxHeight: math.max(0, visible.height),
    );
  }

  @override
  Offset getPositionForChild(Size size, Size childSize) {
    final visible = viewport(size);
    final x = anchor.center.dx + 12;
    final y = anchor.center.dy - childSize.height / 2;
    return Offset(
      x.clamp(
        visible.left,
        math.max(visible.left, visible.right - childSize.width),
      ),
      y.clamp(
        visible.top,
        math.max(visible.top, visible.bottom - childSize.height),
      ),
    );
  }

  @override
  bool shouldRelayout(_DeleteLayout oldDelegate) =>
      anchor != oldDelegate.anchor || media != oldDelegate.media;
}

class _DeletePointer extends CustomPainter {
  _DeletePointer(this.fill, this.outline);
  final Color fill, outline;
  @override
  void paint(Canvas canvas, Size size) {
    final y = size.height / 2;
    final path = Path()
      ..moveTo(1, y - 12)
      ..lineTo(-10, y - 3)
      ..quadraticBezierTo(-13, y, -10, y + 3)
      ..lineTo(1, y + 12)
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
  bool shouldRepaint(_DeletePointer oldDelegate) =>
      oldDelegate.fill != fill || oldDelegate.outline != outline;
}
