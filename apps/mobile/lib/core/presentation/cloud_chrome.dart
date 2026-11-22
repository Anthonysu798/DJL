import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../../features/settings/domain/appearance.dart';

import '../design/djl_icons.dart';

import '../design/djl_tokens.dart';

const cloudBodyStyle = TextStyle(fontSize: 17, height: 1.2);

Color cloudActionColor(BuildContext context) => DjlColors.of(context).ink;

Color cloudGroupedBackground(BuildContext context) =>
    DjlColors.of(context).surface;

class CloudNavigationButton extends StatelessWidget {
  const CloudNavigationButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
  });
  final IconData icon;
  final String label;
  final VoidCallback onPressed;
  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    return Tooltip(
      message: label,
      excludeFromSemantics: true,
      child: Semantics(
        button: true,
        label: label,
        excludeSemantics: true,
        onTap: onPressed,
        child: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: colors.surfaceRaised,
            shape: BoxShape.circle,
          ),
          child: CupertinoButton(
            padding: EdgeInsets.zero,
            onPressed: onPressed,
            child: Icon(
              icon,
              size: icon == DjlIcons.menu ? 26 : 23,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}

class CloudLargeNavigationBar extends StatelessWidget {
  const CloudLargeNavigationBar({
    super.key,
    required this.title,
    required this.leading,
    this.trailing,
  });
  final String title;
  final Widget leading;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) {
    final base = CupertinoTheme.of(context);
    final family = DjlAppearance.of(context).font.family;
    final color = Theme.of(context).colorScheme.onSurface;
    return CupertinoTheme(
      data: base.copyWith(
        primaryColor: cloudActionColor(context),
        textTheme: base.textTheme.copyWith(
          navTitleTextStyle: base.textTheme.navTitleTextStyle.copyWith(
            fontFamily: family ?? base.textTheme.navTitleTextStyle.fontFamily,
            fontSize: 17,
            fontWeight: FontWeight.w600,
            color: color,
          ),
          navLargeTitleTextStyle: base.textTheme.navLargeTitleTextStyle
              .copyWith(
                fontFamily:
                    family ?? base.textTheme.navLargeTitleTextStyle.fontFamily,
                fontSize: 34,
                fontWeight: FontWeight.w700,
                color: color,
              ),
        ),
      ),
      child: CupertinoSliverNavigationBar(
        largeTitle: Text(title),
        leading: leading,
        trailing: trailing,
        automaticallyImplyLeading: false,
        transitionBetweenRoutes: false,
        border: null,
        padding: const EdgeInsetsDirectional.only(start: 16, end: 16),
        backgroundColor: cloudGroupedBackground(context).withValues(alpha: .94),
      ),
    );
  }
}

class CloudValueRow extends StatelessWidget {
  const CloudValueRow({super.key, required this.label, required this.value});
  final String label, value;
  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(minHeight: 52),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Wrap(
        alignment: WrapAlignment.spaceBetween,
        spacing: 16,
        runSpacing: 2,
        children: [
          Text(label, style: cloudBodyStyle),
          Text(
            value,
            style: cloudBodyStyle.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    ),
  );
}

/// Match the current iOS source's switch contour while retaining native Switch
/// semantics and the full parent row's touch target on both platforms.
class CloudSwitch extends StatelessWidget {
  const CloudSwitch({super.key, required this.value, required this.onChanged});
  final bool value;
  final ValueChanged<bool>? onChanged;
  @override
  Widget build(BuildContext context) => Transform.scale(
    scaleX: 63 / 51,
    scaleY: 28 / 31,
    child: CupertinoSwitch(
      value: value,
      onChanged: onChanged,
      activeTrackColor: DjlColors.of(context).ink,
      inactiveTrackColor: DjlColors.of(context).inkFaint,
      thumbColor: DjlColors.of(context).surface,
    ),
  );
}
