import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import '../../../core/presentation/djl_glass_menu.dart';
import '../domain/appearance.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

TextStyle settingsTextStyle(
  BuildContext context,
  double size, {
  Color? color,
  FontWeight weight = FontWeight.w400,
}) {
  final font = DjlAppearance.of(context).font;
  final iosSystem =
      Theme.of(context).platform == TargetPlatform.iOS &&
      font == AppFontStyle.system;
  final scaled = MediaQuery.textScalerOf(context).scale(size);
  return TextStyle(
    fontFamily: iosSystem
        ? (size >= 20 ? 'CupertinoSystemDisplay' : 'CupertinoSystemText')
        // Cupertino buttons default to Roboto off iOS; name the app's face.
        : font.family ?? Theme.of(context).textTheme.bodyMedium?.fontFamily,
    fontVariations: iosSystem
        ? [FontVariation.opticalSize(scaled < 17 ? 17 : scaled)]
        : null,
    fontSize: size,
    height: 1.2,
    fontWeight: weight,
    color: color,
    letterSpacing: iosSystem
        ? switch (size) {
            34 => .37,
            17 => -.41,
            15 => -.23,
            _ => 0,
          }
        : null,
  );
}

class SettingsLinkRow extends StatelessWidget {
  const SettingsLinkRow({
    super.key,
    required this.title,
    required this.leading,
    required this.onTap,
    this.subtitle,
  });
  final String title;
  final String? subtitle;
  final Widget leading;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.onSurface;
    return CupertinoButton(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      onPressed: onTap,
      child: Row(
        children: [
          SizedBox(
            width: 22,
            height: 22,
            child: IconTheme(
              data: IconThemeData(size: 15, color: primary),
              child: leading,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: settingsTextStyle(context, 15, color: primary),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: settingsTextStyle(
                      context,
                      12,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ),
          // The source spacer includes its minimum eight points and two HStack gaps.
          const SizedBox(width: 32),
          Icon(
            DjlIcons.chevronRight,
            size: 11,
            color: DjlColors.of(context).inkFaint,
          ),
        ],
      ),
    );
  }
}

/// One device permission: an icon tile, its name, a short line on what it
/// does or why it is off, and one compact control on the right. Extra
/// [actions] sit under the text, aligned with it.
class SettingsPermissionRow extends StatelessWidget {
  const SettingsPermissionRow({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.trailing,
    this.actions = const [],
    this.onTap,
    this.subtitleIsError = false,
  });
  final IconData icon;
  final String title, subtitle;
  final Widget? trailing;
  final List<Widget> actions;
  final VoidCallback? onTap;
  final bool subtitleIsError;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final row = Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: colors.surfaceSunken,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, size: 18, color: colors.ink),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: settingsTextStyle(
                        context,
                        15,
                        weight: FontWeight.w500,
                        color: colors.ink,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      style: settingsTextStyle(
                        context,
                        12.5,
                        color: subtitleIsError
                            ? colors.danger
                            : colors.inkMuted,
                      ).copyWith(height: 1.35),
                    ),
                  ],
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 12), trailing!],
            ],
          ),
          if (actions.isNotEmpty)
            Padding(
              // Under the text, past the 34-point icon tile and its gap.
              padding: const EdgeInsets.only(left: 46, top: 2),
              child: Wrap(spacing: 16, runSpacing: 4, children: actions),
            ),
        ],
      ),
    );
    return onTap == null ? row : InkWell(onTap: onTap, child: row);
  }
}

/// A quiet text action for under a [SettingsPermissionRow]'s description.
class SettingsRowLink extends StatelessWidget {
  const SettingsRowLink({
    super.key,
    required this.label,
    required this.onPressed,
  });
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    return CupertinoButton(
      padding: const EdgeInsets.symmetric(vertical: 6),
      minimumSize: const Size(0, 32),
      onPressed: onPressed,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: settingsTextStyle(
              context,
              13,
              weight: FontWeight.w600,
              color: onPressed == null ? colors.inkFaint : colors.ink,
            ),
          ),
          const SizedBox(width: 3),
          Icon(
            DjlIcons.chevronRight,
            size: 11,
            color: onPressed == null ? colors.inkFaint : colors.inkMuted,
          ),
        ],
      ),
    );
  }
}

/// The shared inset-grouped surface used by the real Settings controls.
class SettingsGroup extends StatelessWidget {
  const SettingsGroup({
    super.key,
    this.title,
    required this.children,
    this.footer,
    this.dividerIndent = 16,
  });
  final String? title;
  final double dividerIndent;
  final List<Widget> children;
  final String? footer;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (title != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Semantics(
                container: true,
                header: true,
                child: Text(
                  title!,
                  style: settingsTextStyle(
                    context,
                    14,
                    weight: FontWeight.w600,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ),
          Material(
            color: scheme.brightness == Brightness.dark
                ? scheme.surfaceContainerLow
                : scheme.surface,
            borderRadius: BorderRadius.circular(26),
            clipBehavior: Clip.antiAlias,
            child: ListTileTheme.merge(
              titleTextStyle: settingsTextStyle(
                context,
                15,
                color: scheme.onSurface,
              ),
              subtitleTextStyle: settingsTextStyle(
                context,
                12,
                color: scheme.onSurfaceVariant,
              ),
              child: DefaultTextStyle.merge(
                style: settingsTextStyle(context, 15),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < children.length; i++) ...[
                      if (i > 0)
                        Padding(
                          padding: EdgeInsets.only(
                            left: dividerIndent,
                            right: 16,
                          ),
                          child: Divider(
                            height: 1,
                            thickness: .5,
                            color: scheme.outlineVariant,
                          ),
                        ),
                      Semantics(container: true, child: children[i]),
                    ],
                  ],
                ),
              ),
            ),
          ),
          if (footer != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Semantics(
                container: true,
                child: Text(
                  footer!,
                  style: settingsTextStyle(
                    context,
                    12,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// An anchored menu keeps the surrounding settings and scroll position visible.
class SettingsMenuRow<T> extends StatefulWidget {
  const SettingsMenuRow({
    super.key,
    required this.label,
    required this.valueLabel,
    required this.value,
    required this.options,
    required this.onChanged,
    this.valueIcon,
    this.nativePickerStyle = false,
  });
  final String label, valueLabel;
  final T? value;
  final Map<T, String> options;
  final ValueChanged<T>? onChanged;
  final Widget? valueIcon;
  final bool nativePickerStyle;

  @override
  State<SettingsMenuRow<T>> createState() => _SettingsMenuRowState<T>();
}

class _SettingsMenuRowState<T> extends State<SettingsMenuRow<T>> {
  Future<void> _open() async {
    final box = context.findRenderObject()! as RenderBox;
    final row = box.localToGlobal(Offset.zero) & box.size;
    final selected = await showDjlGlassMenu<T>(
      context,
      anchor: row.deflate(8),
      label: widget.label,
      sections: [
        [
          for (final option in widget.options.entries)
            DjlMenuItem(
              option.key,
              option.value,
              null,
              selected: option.key == widget.value,
            ),
        ],
      ],
    );
    if (mounted && selected != null) widget.onChanged?.call(selected);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final enabled = widget.onChanged != null && widget.options.isNotEmpty;
    return Semantics(
      label: widget.label,
      value: widget.valueLabel,
      enabled: enabled,
      button: true,
      excludeSemantics: true,
      onTap: enabled ? _open : null,
      child: InkWell(
        onTap: enabled ? _open : null,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 24),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    widget.label,
                    style: TextStyle(
                      fontSize: 15,
                      color: enabled
                          ? scheme.onSurface
                          : scheme.onSurfaceVariant,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Flexible(
                  child: Align(
                    alignment: Alignment.centerRight,
                    child:
                        widget.valueIcon ??
                        LayoutBuilder(
                          builder: (context, constraints) {
                            final style = settingsTextStyle(
                              context,
                              widget.nativePickerStyle ? 17 : 14,
                              color: widget.nativePickerStyle
                                  ? scheme.onSurface
                                  : scheme.onSurfaceVariant,
                            );
                            final scaler = MediaQuery.textScalerOf(context);
                            final painter = TextPainter(
                              text: TextSpan(
                                text: widget.valueLabel,
                                style: DefaultTextStyle.of(
                                  context,
                                ).style.merge(style),
                              ),
                              textDirection: Directionality.of(context),
                              textScaler: scaler,
                              maxLines: 1,
                            )..layout();
                            final fit = painter.width == 0
                                ? 1.0
                                : (constraints.maxWidth / painter.width).clamp(
                                    .85,
                                    1.0,
                                  );
                            painter.dispose();
                            return Text(
                              widget.valueLabel,
                              textAlign: TextAlign.right,
                              maxLines: 1,
                              softWrap: false,
                              overflow: TextOverflow.ellipsis,
                              textScaler: fit == 1
                                  ? scaler
                                  : TextScaler.linear(
                                      scaler.scale(14) * fit / 14,
                                    ),
                              style: style,
                            );
                          },
                        ),
                  ),
                ),
                if (widget.valueIcon == null) ...[
                  const SizedBox(width: 4),
                  Icon(
                    DjlIcons.expandVertical,
                    size: widget.nativePickerStyle ? 14 : 10,
                    color: widget.nativePickerStyle
                        ? scheme.onSurface
                        : scheme.onSurfaceVariant,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
