import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../design/djl_tokens.dart';
import 'djl_glass.dart';

class DjlTab {
  const DjlTab({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    this.badge = 0,
    this.key,
  });
  final IconData icon, selectedIcon;
  final String label;

  /// A count drawn on the icon; zero hides it.
  final int badge;
  final Key? key;
}

const _barHeight = 62.0, _tabWidth = 78.0, _inset = 4.0;

/// The space content should leave under itself for the floating bar.
const djlTabBarReserve = _barHeight + 28;

/// A floating Liquid Glass tab bar with an optional round glass button
/// beside it, in the iOS 26 manner. Native glass on iOS 26, frosted glass
/// elsewhere. The selection lens slides and briefly stretches as it moves.
class DjlFloatingTabBar extends StatelessWidget {
  const DjlFloatingTabBar({
    super.key,
    required this.tabs,
    required this.index,
    required this.onSelected,
    this.accessory,
  });
  final List<DjlTab> tabs;
  final int index;
  final ValueChanged<int> onSelected;

  /// Usually a [DjlGlassCircleButton]; animates in and out when it changes.
  final Widget? accessory;

  @override
  Widget build(BuildContext context) {
    final motion = DjlMotion.of(context, const Duration(milliseconds: 520));
    // Labels grow with the reader's text size, up to what the bar can hold.
    final media = MediaQuery.of(context);
    return MediaQuery(
      data: media.copyWith(
        textScaler: media.textScaler.clamp(maxScaleFactor: 1.25),
      ),
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: motion,
        curve: DjlMotion.curve,
        // Slide and settle, never fade: an opacity layer over native glass
        // or a blur is not allowed by the renderer.
        builder: (context, value, child) => Transform.translate(
          offset: Offset(0, 96 * (1 - value)),
          child: Transform.scale(scale: .94 + .06 * value, child: child),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _Floating(
              radius: _barHeight / 2,
              child: SizedBox(
                width: tabs.length * _tabWidth + _inset * 2,
                height: _barHeight,
                child: DjlGlassSurface(
                  radius: _barHeight / 2,
                  child: Padding(
                    padding: const EdgeInsets.all(_inset),
                    child: Stack(
                      children: [
                        _Lens(index: index),
                        Row(
                          children: [
                            for (var i = 0; i < tabs.length; i++)
                              _TabButton(
                                key: tabs[i].key,
                                tab: tabs[i],
                                selected: i == index,
                                onTap: () {
                                  if (i == index) return;
                                  HapticFeedback.selectionClick();
                                  onSelected(i);
                                },
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            AnimatedSize(
              duration: DjlMotion.of(context),
              curve: DjlMotion.curve,
              child: AnimatedSwitcher(
                duration: DjlMotion.of(context),
                switchInCurve: DjlMotion.curve,
                transitionBuilder: (child, animation) =>
                    ScaleTransition(scale: animation, child: child),
                child: accessory == null
                    ? const SizedBox(key: ValueKey('none'), height: _barHeight)
                    : Padding(
                        key: accessory!.key ?? const ValueKey('accessory'),
                        padding: const EdgeInsets.only(left: 10),
                        child: accessory,
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The selected tab's soft pill. It slides to the new tab and stretches a
/// little mid-way, the way a drop of liquid would.
class _Lens extends StatelessWidget {
  const _Lens({required this.index});
  final int index;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final dark = Theme.of(context).brightness == Brightness.dark;
    return TweenAnimationBuilder<double>(
      tween: Tween(end: index.toDouble()),
      duration: DjlMotion.of(context, const Duration(milliseconds: 420)),
      curve: DjlMotion.curve,
      builder: (context, position, _) {
        final travel = position - position.floorToDouble();
        final stretch = 1 + .22 * math.sin(math.pi * travel);
        final width = _tabWidth * stretch;
        return Positioned(
          left: position * _tabWidth - (width - _tabWidth) / 2,
          top: 0,
          bottom: 0,
          width: width,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: colors.ink.withValues(alpha: dark ? .14 : .075),
              borderRadius: BorderRadius.circular(_barHeight / 2 - _inset),
            ),
          ),
        );
      },
    );
  }
}

class _TabButton extends StatefulWidget {
  const _TabButton({
    super.key,
    required this.tab,
    required this.selected,
    required this.onTap,
  });
  final DjlTab tab;
  final bool selected;
  final VoidCallback onTap;

  @override
  State<_TabButton> createState() => _TabButtonState();
}

class _TabButtonState extends State<_TabButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final tab = widget.tab, selected = widget.selected;
    final color = selected ? colors.ink : colors.inkMuted;
    final fast = DjlMotion.of(context, DjlMotion.fast);
    return Semantics(
      button: true,
      selected: selected,
      label: tab.badge > 0 ? '${tab.label}, ${tab.badge}' : tab.label,
      onTap: widget.onTap,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => setState(() => _pressed = true),
        onTapCancel: () => setState(() => _pressed = false),
        onTapUp: (_) => setState(() => _pressed = false),
        onTap: widget.onTap,
        child: SizedBox(
          width: _tabWidth,
          child: AnimatedScale(
            scale: _pressed ? .9 : 1,
            duration: fast,
            curve: DjlMotion.curve,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    AnimatedSwitcher(
                      duration: fast,
                      transitionBuilder: (child, animation) => FadeTransition(
                        opacity: animation,
                        child: ScaleTransition(
                          scale: Tween(begin: .8, end: 1.0).animate(animation),
                          child: child,
                        ),
                      ),
                      child: Icon(
                        selected ? tab.selectedIcon : tab.icon,
                        key: ValueKey(selected),
                        size: 23,
                        color: color,
                      ),
                    ),
                    Positioned(
                      top: -4,
                      left: 15,
                      child: AnimatedScale(
                        scale: tab.badge > 0 ? 1 : 0,
                        duration: fast,
                        curve: DjlMotion.curve,
                        child: _Badge(count: tab.badge),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                AnimatedDefaultTextStyle(
                  duration: fast,
                  style: TextStyle(
                    fontSize: 11,
                    height: 1.15,
                    letterSpacing: 0,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                    color: color,
                  ),
                  child: Text(
                    tab.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.count});
  final int count;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    return Container(
      constraints: const BoxConstraints(minWidth: 17),
      height: 17,
      padding: const EdgeInsets.symmetric(horizontal: 5),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: colors.ink,
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: colors.surface, width: 1.5),
      ),
      child: Text(
        count > 99 ? '99+' : '$count',
        style: TextStyle(
          fontSize: 10,
          height: 1,
          fontWeight: FontWeight.w700,
          color: colors.onInk,
        ),
      ),
    );
  }
}

/// A round glass button that floats beside the tab bar.
class DjlGlassCircleButton extends StatefulWidget {
  const DjlGlassCircleButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  @override
  State<DjlGlassCircleButton> createState() => _DjlGlassCircleButtonState();
}

class _DjlGlassCircleButtonState extends State<DjlGlassCircleButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final enabled = widget.onPressed != null;
    return Tooltip(
      message: widget.tooltip,
      child: Semantics(
        button: true,
        enabled: enabled,
        label: widget.tooltip,
        onTap: widget.onPressed,
        excludeSemantics: true,
        child: GestureDetector(
          onTapDown: enabled ? (_) => setState(() => _pressed = true) : null,
          onTapCancel: () => setState(() => _pressed = false),
          onTapUp: (_) => setState(() => _pressed = false),
          onTap: widget.onPressed,
          child: AnimatedScale(
            scale: _pressed ? .9 : 1,
            duration: DjlMotion.of(context, DjlMotion.fast),
            curve: DjlMotion.curve,
            child: _Floating(
              radius: _barHeight / 2,
              child: SizedBox.square(
                dimension: _barHeight,
                child: DjlGlassSurface(
                  radius: _barHeight / 2,
                  child: Center(
                    child: AnimatedSwitcher(
                      duration: DjlMotion.of(context, DjlMotion.fast),
                      child: Icon(
                        widget.icon,
                        key: ValueKey(widget.icon),
                        size: 24,
                        color: enabled ? colors.ink : colors.inkFaint,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A soft shadow under floating glass, so it reads as lifted off the page.
class _Floating extends StatelessWidget {
  const _Floating({required this.radius, required this.child});
  final double radius;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: dark ? .4 : .1),
            blurRadius: 28,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: child,
    );
  }
}
