import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../../../core/presentation/djl_context_menu.dart';
import '../../../core/presentation/djl_glass.dart';

Future<bool?> showDesktopThreadPinMenu(
  BuildContext context,
  Rect row, {
  required bool pinned,
  required Widget preview,
  double initialScale = 1,
}) => showDjlContextMenu<bool>(
  context,
  row,
  preview: preview,
  initialScale: initialScale,
  actions: (context) {
    final colors = Theme.of(context).colorScheme;
    return DjlGlassSurface(
      radius: 34,
      useNativeView: false,
      child: Material(
        key: const Key('navigation.pin-menu'),
        color: colors.brightness == Brightness.dark
            ? const Color(0xff1c1c1e).withValues(alpha: .85)
            : const Color(0xfff2f2f7).withValues(alpha: .70),
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(34),
          side: BorderSide(
            color: Colors.white.withValues(
              alpha: colors.brightness == Brightness.dark ? .14 : .65,
            ),
          ),
        ),
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: TextButton(
              onPressed: () => Navigator.pop(context, !pinned),
              style: TextButton.styleFrom(
                foregroundColor: colors.onSurface,
                minimumSize: const Size(0, 42),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                padding: const EdgeInsets.symmetric(
                  horizontal: 32,
                  vertical: 10,
                ),
                shape: const RoundedRectangleBorder(),
                textStyle: const TextStyle(
                  fontSize: 17,
                  height: 22 / 17,
                  letterSpacing: 0,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    pinned ? CupertinoIcons.pin_slash : CupertinoIcons.pin,
                    size: 20,
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: Text(pinned ? 'Unpin chat' : 'Pin chat')),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  },
);
