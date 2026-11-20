import 'dart:math' as math;
import 'dart:ui' as ui;
import 'dart:ui' show SemanticsRole;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../design/djl_icons.dart';
import '../design/djl_tokens.dart';
import 'djl_frosted.dart';
import 'djl_glass.dart';

/// One row of a [showDjlGlassMenu].
class DjlMenuItem<T> {
  const DjlMenuItem(
    this.value,
    this.label,
    this.icon, {
    this.enabled = true,
    this.destructive = false,
    this.selected = false,
  });
  final T value;
  final String label;
  final IconData? icon;
  final bool enabled;
  final bool destructive;

  /// Marks the current choice with a check, for pickers.
  final bool selected;
}

/// A frosted glass menu that grows out of [anchor]'s top-right corner.
/// [sections] are separated by hairlines; empty sections are skipped.
Future<T?> showDjlGlassMenu<T>(
  BuildContext context, {
  required Rect anchor,
  required List<List<DjlMenuItem<T>>> sections,
  String label = 'Menu',
}) {
  final visible = [
    for (final section in sections)
      if (section.isNotEmpty) section,
  ];
  return _showGlass<T>(
    context,
    anchor: anchor,
    label: label,
    body: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < visible.length; i++) ...[
          if (i > 0) const _SectionGap(),
          for (final item in visible[i]) _MenuRow(item),
        ],
      ],
    ),
  );
}

/// The same glass menu for existing Material menu entries
/// ([PopupMenuItem], [CheckedPopupMenuItem], [PopupMenuDivider]).
Future<T?> showDjlGlassEntries<T>(
  BuildContext context, {
  required Rect anchor,
  required List<PopupMenuEntry<T>> entries,
  String label = 'Menu',
  bool requestFocus = true,
}) => _showGlass<T>(
  context,
  anchor: anchor,
  label: label,
  menu: true,
  requestFocus: requestFocus,
  body: ListBody(children: entries),
);

Future<T?> _showGlass<T>(
  BuildContext context, {
  required Rect anchor,
  required String label,
  required Widget body,
  bool menu = false,
  bool requestFocus = true,
}) async {
  final navigator = Navigator.of(context);
  final overlays = djlNativeGlassOverlays(navigator);
  final reduceMotion = MediaQuery.disableAnimationsOf(context);
  HapticFeedback.selectionClick();
  overlays.value++;
  try {
    return await showGeneralDialog<T>(
      context: context,
      barrierDismissible: true,
      barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
      barrierColor: Colors.transparent,
      // false keeps the keyboard and selection of a composer behind the menu.
      requestFocus: requestFocus,
      transitionDuration: reduceMotion
          ? Duration.zero
          : const Duration(milliseconds: 240),
      pageBuilder: (context, animation, _) => _GlassMenuRoute(
        anchor: anchor,
        animation: animation,
        label: label,
        body: body,
        menu: menu,
      ),
    );
  } finally {
    overlays.value--;
  }
}

class _GlassMenuRoute extends StatelessWidget {
  const _GlassMenuRoute({
    required this.anchor,
    required this.animation,
    required this.label,
    required this.body,
    required this.menu,
  });
  final Rect anchor;
  final Animation<double> animation;
  final String label;
  final Widget body;

  /// Material menu items must sit inside a node with the menu role.
  final bool menu;

  @override
  Widget build(BuildContext context) {
    final grow = CurvedAnimation(
      parent: animation,
      curve: DjlMotion.curve,
      reverseCurve: Curves.easeInCubic,
    );
    return Stack(
      children: [
        Positioned.fill(child: DjlMenuBackdrop(animation: grow)),
        CustomSingleChildLayout(
          delegate: _MenuLayout(anchor, MediaQuery.of(context)),
          child: FadeTransition(
            opacity: grow,
            child: ScaleTransition(
              scale: Tween(begin: .82, end: 1.0).animate(grow),
              alignment: Alignment.topRight,
              child: Semantics(
                role: menu ? SemanticsRole.menu : null,
                scopesRoute: true,
                namesRoute: menu,
                explicitChildNodes: true,
                label: label,
                child: DjlGlassMenuSurface(child: body),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Softens and dims the page behind an open menu so it reads as a layer.
class DjlMenuBackdrop extends StatelessWidget {
  const DjlMenuBackdrop({super.key, required this.animation});
  final Animation<double> animation;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return IgnorePointer(
      child: AnimatedBuilder(
        animation: animation,
        builder: (_, _) => BackdropFilter(
          filter: ui.ImageFilter.blur(
            sigmaX: 6 * animation.value,
            sigmaY: 6 * animation.value,
          ),
          child: ColoredBox(
            color: Colors.black.withValues(
              alpha: (dark ? .35 : .10) * animation.value,
            ),
          ),
        ),
      ),
    );
  }
}

/// The frosted panel every menu sits on. Material menu items placed inside
/// pick up the app's type and colours instead of Material's defaults.
class DjlGlassMenuSurface extends StatelessWidget {
  const DjlGlassMenuSurface({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final text = Theme.of(context).textTheme.bodyLarge?.copyWith(
      fontWeight: FontWeight.w500,
      letterSpacing: -.1,
    );
    return DjlFrosted(
      child: Material(
        type: MaterialType.transparency,
        child: PopupMenuTheme(
          data: PopupMenuThemeData(
            textStyle: text?.copyWith(color: colors.ink),
            labelTextStyle: WidgetStateProperty.resolveWith(
              (states) => text?.copyWith(
                color: states.contains(WidgetState.disabled)
                    ? colors.inkFaint
                    : colors.ink,
              ),
            ),
          ),
          child: IconTheme.merge(
            data: IconThemeData(color: colors.ink, size: 20),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: SingleChildScrollView(child: child),
            ),
          ),
        ),
      ),
    );
  }
}

/// A drop-in for [PopupMenuButton] that opens the glass menu.
class DjlGlassMenuButton<T> extends StatelessWidget {
  const DjlGlassMenuButton({
    super.key,
    required this.itemBuilder,
    this.onSelected,
    this.tooltip,
    this.enabled = true,
    this.icon,
    this.child,
    this.style,
    this.padding,
    this.requestFocus = true,
  }) : assert(icon == null || child == null);
  final PopupMenuItemBuilder<T> itemBuilder;
  final PopupMenuItemSelected<T>? onSelected;
  final String? tooltip;
  final bool enabled;
  final Widget? icon;
  final Widget? child;

  /// Passed to the [IconButton] so compact toolbars keep their size.
  final ButtonStyle? style;
  final EdgeInsetsGeometry? padding;
  final bool requestFocus;

  Future<void> _open(BuildContext context) async {
    final box = context.findRenderObject()! as RenderBox;
    final value = await showDjlGlassEntries<T>(
      context,
      anchor: box.localToGlobal(Offset.zero) & box.size,
      entries: itemBuilder(context),
      label: tooltip?.isNotEmpty == true ? tooltip! : 'Menu',
      requestFocus: requestFocus,
    );
    if (value != null && context.mounted) onSelected?.call(value);
  }

  @override
  Widget build(BuildContext context) => Builder(
    builder: (anchor) {
      final onTap = enabled ? () => _open(anchor) : null;
      if (child != null) {
        final button = InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(DjlRadius.sm),
          child: child,
        );
        return tooltip?.isNotEmpty == true
            ? Tooltip(message: tooltip!, child: button)
            : button;
      }
      return IconButton(
        tooltip: tooltip?.isNotEmpty == true ? tooltip : null,
        onPressed: onTap,
        style: style,
        padding: padding,
        icon: icon ?? const Icon(DjlIcons.more),
      );
    },
  );
}

class _SectionGap extends StatelessWidget {
  const _SectionGap();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 16),
    child: Container(
      height: .8,
      color: DjlColors.of(context).ink.withValues(alpha: .10),
    ),
  );
}

class _MenuRow<T> extends StatefulWidget {
  const _MenuRow(this.item);
  final DjlMenuItem<T> item;

  @override
  State<_MenuRow<T>> createState() => _MenuRowState<T>();
}

class _MenuRowState<T> extends State<_MenuRow<T>> {
  bool _pressed = false;

  void _press(bool value) {
    if (_pressed != value) setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final colors = DjlColors.of(context);
    final foreground = !item.enabled
        ? colors.inkFaint
        : item.destructive
        ? colors.danger
        : colors.ink;
    return Semantics(
      button: true,
      enabled: item.enabled,
      selected: item.selected ? true : null,
      label: item.label,
      excludeSemantics: true,
      onTap: item.enabled ? () => Navigator.pop(context, item.value) : null,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: item.enabled ? (_) => _press(true) : null,
        onTapCancel: () => _press(false),
        onTapUp: (_) => _press(false),
        onTap: item.enabled
            ? () {
                HapticFeedback.selectionClick();
                Navigator.pop(context, item.value);
              }
            : null,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6),
          child: AnimatedContainer(
            duration: DjlMotion.fast,
            curve: DjlMotion.curve,
            constraints: const BoxConstraints(minHeight: 46),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: _pressed
                  ? colors.ink.withValues(alpha: .08)
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(DjlRadius.sm + 2),
            ),
            child: Row(
              children: [
                if (item.icon != null) ...[
                  Icon(item.icon, size: 20, color: foreground),
                  const SizedBox(width: 14),
                ],
                Expanded(
                  child: Text(
                    item.label,
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: foreground,
                      fontWeight: FontWeight.w500,
                      letterSpacing: -.1,
                    ),
                  ),
                ),
                if (item.selected)
                  Icon(DjlIcons.check, size: 18, color: foreground),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MenuLayout extends SingleChildLayoutDelegate {
  _MenuLayout(this.anchor, this.media);
  final Rect anchor;
  final MediaQueryData media;
  static const _gap = 8.0;

  Rect _viewport(Size size) => Rect.fromLTRB(
    media.viewPadding.left + 12,
    media.viewPadding.top + 12,
    size.width - media.viewPadding.right - 12,
    size.height -
        math.max(media.viewPadding.bottom, media.viewInsets.bottom) -
        12,
  );

  double _below(Rect visible) => visible.bottom - anchor.bottom - _gap;
  double _above(Rect visible) => anchor.top - _gap - visible.top;

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) {
    final visible = _viewport(constraints.biggest);
    final width = math.min(264.0, math.max(0.0, visible.width));
    return BoxConstraints(
      minWidth: width,
      maxWidth: width,
      maxHeight: math.max(0, math.max(_below(visible), _above(visible))),
    );
  }

  @override
  Offset getPositionForChild(Size size, Size childSize) {
    final visible = _viewport(size);
    final left = (anchor.right - childSize.width)
        .clamp(
          visible.left,
          math.max(visible.left, visible.right - childSize.width),
        )
        .toDouble();
    final fitsBelow = childSize.height <= _below(visible);
    final top = fitsBelow || _below(visible) >= _above(visible)
        ? anchor.bottom + _gap
        : anchor.top - _gap - childSize.height;
    return Offset(left, top);
  }

  @override
  bool shouldRelayout(_MenuLayout oldDelegate) =>
      anchor != oldDelegate.anchor || media != oldDelegate.media;
}
