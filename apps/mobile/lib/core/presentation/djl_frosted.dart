import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../features/settings/domain/appearance.dart';
import '../design/djl_icons.dart';
import '../design/djl_tokens.dart';
import '../../l10n/l10n.dart';

/// Frosted glass drawn in Flutter: a blur of what is behind, a translucent
/// fill that is brighter at the top, and a fine light edge. With the Liquid
/// Glass setting off it becomes a solid raised surface.
class DjlFrosted extends StatelessWidget {
  const DjlFrosted({
    super.key,
    required this.child,
    this.radius = DjlRadius.lg,
    this.shadow = true,
    this.blur = true,
  });
  final Widget child;
  final double radius;
  final bool shadow;

  /// Off for controls on a still background, where a blur shows nothing and
  /// only costs a pass every frame.
  final bool blur;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = DjlColors.of(context);
    final dark = theme.brightness == Brightness.dark;
    final glass = theme.extension<DjlAppearance>()?.liquidGlass ?? true;
    final shape = BorderRadius.circular(radius);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: shape,
        boxShadow: shadow
            ? [
                BoxShadow(
                  color: Colors.black.withValues(alpha: dark ? .45 : .12),
                  blurRadius: 40,
                  offset: const Offset(0, 14),
                ),
              ]
            : null,
      ),
      child: ClipRRect(
        borderRadius: shape,
        child: glass
            ? _maybeBlur(
                DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: shape,
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: dark
                          ? [
                              const Color(0xff3a3a3c).withValues(alpha: .62),
                              const Color(0xff1c1c1e).withValues(alpha: .58),
                            ]
                          : [
                              const Color(0xfffcfcfc).withValues(alpha: .84),
                              const Color(0xffededed).withValues(alpha: .80),
                            ],
                    ),
                    border: Border.all(
                      color: dark
                          ? Colors.white.withValues(alpha: .12)
                          : Colors.black.withValues(alpha: .07),
                      width: .8,
                    ),
                  ),
                  child: child,
                ),
              )
            : DecoratedBox(
                decoration: BoxDecoration(
                  color: colors.surfaceRaised,
                  borderRadius: shape,
                  border: Border.all(color: colors.hairline),
                ),
                child: child,
              ),
      ),
    );
  }

  Widget _maybeBlur(Widget child) => blur
      ? BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 28, sigmaY: 28),
          child: child,
        )
      : child;
}

/// A round frosted button for floating chrome (back, close, more, settings).
class DjlGlassIconButton extends StatelessWidget {
  const DjlGlassIconButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
    this.size = 44,
  });
  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  final double size;

  @override
  Widget build(BuildContext context) => _Pressable(
    label: label,
    onPressed: onPressed,
    child: SizedBox.square(
      dimension: size,
      child: DjlFrosted(
        radius: size / 2,
        shadow: false,
        child: Icon(icon, size: 20, color: DjlColors.of(context).ink),
      ),
    ),
  );
}

/// The page's way back, drawn as a frosted circle in the top-left corner.
class DjlGlassBackButton extends StatelessWidget {
  const DjlGlassBackButton({super.key, this.onPressed});
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => DjlGlassIconButton(
    icon: DjlIcons.back,
    label: context.l10n.coreBack,
    onPressed: onPressed ?? () => Navigator.maybePop(context),
  );
}

/// A frosted pill with a text label. [prominent] fills it with ink for the
/// one main action on a screen.
class DjlGlassPillButton extends StatelessWidget {
  const DjlGlassPillButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.prominent = false,
    this.compact = false,
  });
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool prominent;

  /// A smaller pill for controls that sit inside a list row.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final enabled = onPressed != null;
    final foreground = !enabled
        ? colors.inkFaint
        : prominent
        ? colors.onInk
        : colors.ink;
    final content = Padding(
      padding: compact
          ? const EdgeInsets.symmetric(horizontal: 14, vertical: 8)
          : const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 18, color: foreground),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                color: foreground,
                fontWeight: FontWeight.w600,
                fontSize: compact ? 13 : null,
              ),
            ),
          ),
        ],
      ),
    );
    return _Pressable(
      label: label,
      onPressed: onPressed,
      child: ConstrainedBox(
        constraints: BoxConstraints(minHeight: compact ? 34 : 44),
        child: prominent && enabled
            ? DecoratedBox(
                decoration: BoxDecoration(
                  color: colors.ink,
                  borderRadius: BorderRadius.circular(DjlRadius.pill),
                ),
                child: content,
              )
            : DjlFrosted(radius: DjlRadius.pill, shadow: false, child: content),
      ),
    );
  }
}

/// Shrinks slightly while held, like a physical key.
class _Pressable extends StatefulWidget {
  const _Pressable({
    required this.label,
    required this.onPressed,
    required this.child,
  });
  final String label;
  final VoidCallback? onPressed;
  final Widget child;

  @override
  State<_Pressable> createState() => _PressableState();
}

class _PressableState extends State<_Pressable> {
  bool _down = false;

  void _set(bool value) {
    if (_down != value) setState(() => _down = value);
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;
    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.label,
      excludeSemantics: true,
      onTap: widget.onPressed,
      child: Tooltip(
        message: widget.label,
        excludeFromSemantics: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapDown: enabled ? (_) => _set(true) : null,
          onTapUp: (_) => _set(false),
          onTapCancel: () => _set(false),
          onTap: enabled
              ? () {
                  HapticFeedback.selectionClick();
                  widget.onPressed!();
                }
              : null,
          child: AnimatedScale(
            scale: _down ? .94 : 1,
            duration: DjlMotion.of(context, DjlMotion.fast),
            curve: DjlMotion.curve,
            child: widget.child,
          ),
        ),
      ),
    );
  }
}
