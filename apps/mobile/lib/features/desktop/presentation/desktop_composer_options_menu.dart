import 'dart:math' as math;
import 'dart:ui' show SemanticsRole;
import 'package:flutter/material.dart';

enum DesktopComposerMenuAlignment { leading, center, trailing }

Future<String?> showDesktopComposerMenu({
  required BuildContext context,
  required List<PopupMenuEntry<String>> items,
  VoidCallback? onOpened,
  bool allowBelow = false,
}) async {
  return showDesktopComposerPopover<String>(
    context: context,
    onOpened: onOpened,
    allowBelow: allowBelow,
    builder: (context) => _composerMenuBody(context, items),
  );
}

Future<T?> showDesktopComposerPopover<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  VoidCallback? onOpened,
  bool allowBelow = false,
  double screenMargin = 8,
  DesktopComposerMenuAlignment alignment = DesktopComposerMenuAlignment.leading,
  bool coverAnchor = false,
}) async {
  if (!context.mounted) return null;
  final navigator = Navigator.of(context);
  final button = context.findRenderObject();
  final overlay = navigator.overlay?.context.findRenderObject();
  if (button is! RenderBox || overlay is! RenderBox || !button.hasSize) {
    return null;
  }
  onOpened?.call();
  return navigator.push<T>(
    _ComposerOptionsRoute<T>(
      button: button,
      overlay: overlay,
      builder: builder,
      screenMargin: screenMargin,
      alignment: alignment,
      coverAnchor: coverAnchor,
      allowBelow: allowBelow,
      barrierLabel: MaterialLocalizations.of(context).menuDismissLabel,
    ),
  );
}

/// The composer's menu stays above its button and the current keyboard.
class DesktopComposerOptionsMenu extends StatelessWidget {
  const DesktopComposerOptionsMenu({
    super.key,
    required this.onOpened,
    required this.onSelected,
    required this.itemBuilder,
  });

  final VoidCallback onOpened;
  final ValueChanged<String> onSelected;
  final PopupMenuItemBuilder<String> itemBuilder;

  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: 'Composer options',
    padding: EdgeInsets.zero,
    icon: const Icon(Icons.add, size: 20),
    style: IconButton.styleFrom(
      minimumSize: const Size(34, 34),
      maximumSize: const Size(34, 34),
      padding: EdgeInsets.zero,
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
    ),
    onPressed: () async {
      final value = await showDesktopComposerMenu(
        context: context,
        items: itemBuilder(context),
        onOpened: onOpened,
      );
      if (value != null) onSelected(value);
    },
  );
}

class _ComposerOptionsRoute<T> extends PopupRoute<T> {
  _ComposerOptionsRoute({
    required this.button,
    required this.overlay,
    required this.builder,
    required this.screenMargin,
    required this.alignment,
    required this.coverAnchor,
    required this.barrierLabel,
    required this.allowBelow,
  }) : super(requestFocus: false);

  final RenderBox button, overlay;
  final WidgetBuilder builder;
  final double screenMargin;
  final DesktopComposerMenuAlignment alignment;
  final bool coverAnchor;
  final bool allowBelow;
  @override
  final String barrierLabel;
  @override
  Color? get barrierColor => null;
  @override
  bool get barrierDismissible => true;
  @override
  Duration get transitionDuration => const Duration(milliseconds: 300);
  @override
  Duration get reverseTransitionDuration => const Duration(milliseconds: 200);

  @override
  Widget buildPage(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
  ) {
    return _ComposerOptionsViewport(
      button: button,
      overlay: overlay,
      allowBelow: allowBelow,
      screenMargin: screenMargin,
      alignment: alignment,
      coverAnchor: coverAnchor,
      child: FadeTransition(
        opacity: animation,
        child: Builder(builder: builder),
      ),
    );
  }
}

Widget _composerMenuBody(
  BuildContext context,
  List<PopupMenuEntry<String>> items,
) {
  final theme = Theme.of(context);
  final popup = PopupMenuTheme.of(context);
  return Material(
    type: MaterialType.card,
    elevation: popup.elevation ?? (theme.useMaterial3 ? 3 : 8),
    shape:
        popup.shape ??
        (theme.useMaterial3
            ? const RoundedRectangleBorder(
                borderRadius: BorderRadius.all(Radius.circular(4)),
              )
            : null),
    color:
        popup.color ??
        (theme.useMaterial3 ? theme.colorScheme.surfaceContainer : null),
    shadowColor:
        popup.shadowColor ??
        (theme.useMaterial3 ? theme.colorScheme.shadow : null),
    surfaceTintColor:
        popup.surfaceTintColor ??
        (theme.useMaterial3 ? Colors.transparent : null),
    child: ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 220, maxWidth: 320),
      child: IntrinsicWidth(
        stepWidth: 56,
        child: Semantics(
          role: SemanticsRole.menu,
          scopesRoute: true,
          namesRoute: true,
          explicitChildNodes: true,
          label: MaterialLocalizations.of(context).popupMenuLabel,
          child: SingleChildScrollView(
            padding:
                popup.menuPadding ?? const EdgeInsets.symmetric(vertical: 8),
            child: ListBody(children: items),
          ),
        ),
      ),
    ),
  );
}

class _ComposerOptionsViewport extends StatefulWidget {
  const _ComposerOptionsViewport({
    required this.button,
    required this.overlay,
    required this.child,
    required this.allowBelow,
    required this.screenMargin,
    required this.alignment,
    required this.coverAnchor,
  });
  final RenderBox button, overlay;
  final Widget child;
  final bool allowBelow;
  final double screenMargin;
  final DesktopComposerMenuAlignment alignment;
  final bool coverAnchor;

  @override
  State<_ComposerOptionsViewport> createState() =>
      _ComposerOptionsViewportState();
}

class _ComposerOptionsViewportState extends State<_ComposerOptionsViewport> {
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // The underlying Scaffold also lays out on an IME/viewport change. Measure
    // again after that frame so the anchor is its current rendered position.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.button.attached ||
        !widget.overlay.attached ||
        !widget.button.hasSize) {
      final route = ModalRoute.of(context);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && route?.isCurrent == true) Navigator.pop(context);
      });
      return const SizedBox.shrink();
    }
    final media = MediaQuery.of(context);
    final direction = Directionality.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final anchor =
            widget.button.localToGlobal(Offset.zero, ancestor: widget.overlay) &
            widget.button.size;
        return CustomSingleChildLayout(
          delegate: _ComposerOptionsLayout(
            anchor: anchor,
            padding: media.padding,
            insets: media.viewInsets,
            direction: direction,
            allowBelow: widget.allowBelow,
            screenMargin: widget.screenMargin,
            alignment: widget.alignment,
            coverAnchor: widget.coverAnchor,
          ),
          child: widget.child,
        );
      },
    );
  }
}

class _ComposerOptionsLayout extends SingleChildLayoutDelegate {
  _ComposerOptionsLayout({
    required this.anchor,
    required this.padding,
    required this.insets,
    required this.direction,
    required this.allowBelow,
    required this.screenMargin,
    required this.alignment,
    required this.coverAnchor,
  });

  final Rect anchor;
  final EdgeInsets padding, insets;
  final TextDirection direction;
  final bool allowBelow;
  final double screenMargin;
  final DesktopComposerMenuAlignment alignment;
  final bool coverAnchor;

  bool below(Rect visible) =>
      allowBelow &&
      visible.bottom - anchor.bottom.clamp(visible.top, visible.bottom) >
          anchor.top.clamp(visible.top, visible.bottom) - visible.top;

  double bottom(Rect visible) => (coverAnchor ? anchor.bottom : anchor.top)
      .clamp(visible.top, visible.bottom)
      .toDouble();

  Rect viewport(Size size) => Rect.fromLTRB(
    math.max(padding.left, insets.left) + screenMargin,
    math.max(padding.top, insets.top) + screenMargin,
    size.width - math.max(padding.right, insets.right) - screenMargin,
    size.height - math.max(padding.bottom, insets.bottom) - screenMargin,
  );

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) {
    final visible = viewport(constraints.biggest);
    final available = allowBelow
        ? visible.height
        : bottom(visible) - visible.top;
    return BoxConstraints.loose(
      Size(math.max(0, visible.width), math.max(0, available)),
    );
  }

  @override
  Offset getPositionForChild(Size size, Size childSize) {
    final visible = viewport(size);
    final rect = anchor;
    final x = switch (alignment) {
      DesktopComposerMenuAlignment.center =>
        rect.center.dx - childSize.width / 2,
      DesktopComposerMenuAlignment.leading =>
        direction == TextDirection.rtl
            ? rect.right - childSize.width
            : rect.left,
      DesktopComposerMenuAlignment.trailing =>
        direction == TextDirection.rtl
            ? rect.left
            : rect.right - childSize.width,
    };
    return Offset(
      x.clamp(
        visible.left,
        math.max(visible.left, visible.right - childSize.width),
      ),
      allowBelow
          ? (below(visible) ? rect.bottom : rect.top - childSize.height).clamp(
              visible.top,
              math.max(visible.top, visible.bottom - childSize.height),
            )
          : bottom(visible) - childSize.height,
    );
  }

  @override
  bool shouldRelayout(_ComposerOptionsLayout oldDelegate) => true;
}
