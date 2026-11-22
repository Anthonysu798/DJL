import 'package:flutter/material.dart';

import '../../../core/design/djl_icons.dart';
import '../../../core/presentation/djl_glass_menu.dart';
import '../../../l10n/l10n.dart';

class DesktopThreadMenu extends StatelessWidget {
  const DesktopThreadMenu({
    super.key,
    required this.enabled,
    required this.isCurrent,
    required this.onSelected,
    required this.primaryBuilder,
    required this.secondaryBuilder,
  });

  final bool enabled;
  final bool Function() isCurrent;
  final ValueChanged<String> onSelected;
  final PopupMenuItemBuilder<String> primaryBuilder, secondaryBuilder;

  Future<void> _select(BuildContext context, String action) async {
    if (!context.mounted || !isCurrent()) return;
    if (action != 'more-actions') {
      onSelected(action);
      return;
    }
    final anchor = context.findRenderObject();
    final overlay = Navigator.of(context).overlay?.context.findRenderObject();
    if (anchor is! RenderBox || overlay is! RenderBox) return;
    final rect = Rect.fromPoints(
      anchor.localToGlobal(Offset.zero, ancestor: overlay),
      anchor.localToGlobal(
        anchor.size.bottomRight(Offset.zero),
        ancestor: overlay,
      ),
    );
    final selected = await showDjlGlassEntries<String>(
      context,
      anchor: rect,
      entries: secondaryBuilder(context),
      label: context.l10n.chatUiMoreThreadActions,
    );
    if (selected != null && context.mounted && isCurrent()) {
      onSelected(selected);
    }
  }

  @override
  Widget build(BuildContext context) => DjlGlassMenuButton<String>(
    tooltip: context.l10n.chatUiThreadActions,
    enabled: enabled,
    icon: Icon(
      DjlIcons.more,
      size: 24,
      color: enabled
          ? Theme.of(context).colorScheme.onSurface
          : Theme.of(context).disabledColor,
    ),
    onSelected: (action) => _select(context, action),
    itemBuilder: (context) => [
      ...primaryBuilder(context),
      const PopupMenuDivider(height: 8),
      PopupMenuItem(
        value: 'more-actions',
        child: DesktopThreadMenuLabel(
          title: context.l10n.chatUiMoreActions,
          icon: DjlIcons.more,
        ),
      ),
    ],
  );
}

class DesktopThreadMenuLabel extends StatelessWidget {
  const DesktopThreadMenuLabel({
    super.key,
    required this.title,
    required this.icon,
  });
  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 22, color: DefaultTextStyle.of(context).style.color),
      const SizedBox(width: 12),
      Flexible(child: Text(title)),
    ],
  );
}
