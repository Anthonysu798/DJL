import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../../../app/cloud_navigation.dart';
import '../../chat/domain/cloud_models.dart';
import 'conversation_controller.dart';
import 'cloud_chat_actions.dart';

import '../../../core/design/djl_icons.dart';
import '../../../l10n/l10n.dart';

// AppFont.body in the Swift reference is 15pt; native Form rows use 17pt.
const _menuBodyStyle = TextStyle(fontSize: 15, height: 1.2);

class CloudNavigationMenu extends StatefulWidget {
  const CloudNavigationMenu({
    super.key,
    required this.history,
    required this.navigation,
    required this.onDestination,
    required this.onConversation,
    required this.onNewChat,
    required this.onRemote,
    required this.onAction,
    this.unreadCount = 0,
  });
  final ConversationController history;
  final CloudNavigationController navigation;
  final ValueChanged<CloudDestination> onDestination;
  final ValueChanged<Conversation> onConversation;
  final VoidCallback onNewChat, onRemote;
  final Future<void> Function(Conversation, String, Rect) onAction;
  final int unreadCount;
  @override
  State<CloudNavigationMenu> createState() => _CloudNavigationMenuState();
}

class _CloudNavigationMenuState extends State<CloudNavigationMenu> {
  final _query = TextEditingController();
  Timer? _debounce;
  bool _searching = false;
  String? _previewConversation;
  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _search(String value) {
    _debounce?.cancel();
    final owner = widget.navigation.owner;
    _debounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted || widget.navigation.owner != owner) return;
      widget.history.query = value.trim();
      widget.history.refresh();
    });
  }

  Widget _rowContent(Conversation item) => ConstrainedBox(
    constraints: const BoxConstraints(minHeight: 50),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          const SizedBox(
            width: 24,
            height: 24,
            child: Icon(DjlIcons.chat, size: 17),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              item.displayTitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: _menuBodyStyle,
            ),
          ),
        ],
      ),
    ),
  );

  Future<void> _actions(Conversation item, BuildContext rowContext) async {
    if (_previewConversation != null) return;
    final owner = widget.navigation.owner;
    final row = rowContext.findRenderObject() as RenderBox;
    final menu = context.findRenderObject() as RenderBox;
    final media = MediaQuery.of(context);
    final menuRect = (menu.localToGlobal(Offset.zero) & menu.size);
    final safeMenu = Rect.fromLTRB(
      menuRect.left,
      menuRect.top + media.viewPadding.top,
      menuRect.right,
      menuRect.bottom - media.viewPadding.bottom,
    );
    final selected = widget.navigation.conversationId == item.id;
    final colors = Theme.of(context).colorScheme;
    final tint = 255 * .06 * (colors.brightness == Brightness.dark ? 1 : -1);
    setState(() => _previewConversation = item.id);
    String? action;
    try {
      action = await showCloudChatActions(
        context,
        item,
        row.localToGlobal(Offset.zero) & row.size,
        dismissOnChange: widget.navigation,
        preview: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: BackdropFilter(
            enabled: selected,
            filter: ColorFilter.matrix([
              1,
              0,
              0,
              0,
              tint,
              0,
              1,
              0,
              0,
              tint,
              0,
              0,
              1,
              0,
              tint,
              0,
              0,
              0,
              1,
              0,
            ]),
            child: Material(
              color: Colors.transparent,
              child: _rowContent(item),
            ),
          ),
        ),
      );
    } finally {
      if (mounted && _previewConversation == item.id) {
        setState(() => _previewConversation = null);
      }
    }
    if (action != null && mounted && widget.navigation.owner == owner) {
      await widget.onAction(item, action, safeMenu);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([widget.history, widget.navigation]),
    builder: (context, _) {
      final colors = Theme.of(context).colorScheme;
      Widget surface(Widget child, {double radius = 28, Color? tint}) =>
          Container(
            decoration: BoxDecoration(
              color: tint ?? (colors.surfaceContainerLow),
              borderRadius: BorderRadius.circular(radius),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(
                    alpha: colors.brightness == Brightness.dark ? .18 : .06,
                  ),
                  blurRadius: 22,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: child,
          );
      Widget action(
        String label,
        IconData icon,
        VoidCallback callback, {
        int? badge,
      }) => Semantics(
        button: true,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: callback,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 50),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: Row(
                children: [
                  Icon(icon, size: 23),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      label,
                      style: _menuBodyStyle.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  if (badge != null && badge > 0)
                    Text(
                      '$badge',
                      style: _menuBodyStyle.copyWith(
                        fontSize: 12,
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      );
      List<Widget> section(String title, List<Conversation> rows) => [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 24, 14, 8),
          child: Semantics(
            header: true,
            container: true,
            child: Text(
              title,
              style: _menuBodyStyle.copyWith(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: colors.onSurfaceVariant,
              ),
            ),
          ),
        ),
        if (rows.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Text(
              title == context.l10n.conversationsPinned
                  ? context.l10n.conversationsPinnedEmpty
                  : context.l10n.conversationsRecentEmpty,
              style: _menuBodyStyle.copyWith(
                fontSize: 14,
                color: colors.onSurfaceVariant,
              ),
            ),
          ),
        for (final item in rows)
          Opacity(
            key: ValueKey('cloud.navigation.paint.${item.id}'),
            opacity: _previewConversation == item.id ? 0 : 1,
            child: Semantics(
              container: true,
              button: true,
              selected: widget.navigation.conversationId == item.id,
              hint: context.l10n.conversationsCloudConversationHint,
              child: Material(
                color: widget.navigation.conversationId == item.id
                    ? colors.onSurface.withValues(alpha: .06)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(16),
                child: Builder(
                  builder: (rowContext) => InkWell(
                    onTap: () => widget.onConversation(item),
                    onLongPress: () => _actions(item, rowContext),
                    borderRadius: BorderRadius.circular(16),
                    child: _rowContent(item),
                  ),
                ),
              ),
            ),
          ),
      ];
      return LayoutBuilder(
        builder: (context, constraints) {
          Size labelSize(
            String value,
            double size, [
            double maxWidth = double.infinity,
          ]) {
            final painter = TextPainter(
              text: TextSpan(
                text: value,
                style: DefaultTextStyle.of(context).style.merge(
                  _menuBodyStyle.copyWith(
                    fontSize: size,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              textDirection: Directionality.of(context),
              textScaler: MediaQuery.textScalerOf(context),
            )..layout(maxWidth: maxWidth);
            final result = painter.size;
            painter.dispose();
            return result;
          }

          final brand = labelSize('DJL', 18),
              chat = labelSize(context.l10n.conversationsChat, 15);
          final headerHeight = labelSize(
            'DJL',
            18,
            (constraints.maxWidth - 94).clamp(1.0, double.infinity),
          ).height.clamp(48.0, double.infinity);
          final footerHeight =
              (labelSize(
                        context.l10n.conversationsChat,
                        15,
                        (constraints.maxWidth - 106).clamp(
                          1.0,
                          double.infinity,
                        ),
                      ).height +
                      24)
                  .clamp(50.0, double.infinity);
          final topInset =
              headerHeight +
              38 +
              (brand.width + 62 + 48 + 8 > constraints.maxWidth - 32 ? 56 : 0);
          final bottomInset =
              footerHeight +
              74 +
              (chat.width + 70 + 50 + 8 > constraints.maxWidth - 36 ? 58 : 0);
          return Material(
            color: colors.surface,
            child: SafeArea(
              child: Stack(
                children: [
                  Positioned.fill(
                    child: ListView(
                      key: const Key('cloud.navigation.history'),
                      padding: EdgeInsets.fromLTRB(
                        10,
                        topInset,
                        10,
                        bottomInset,
                      ),
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      children:
                          [
                                if (_searching)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    child: TextField(
                                      key: const Key('cloud.navigation.search'),
                                      controller: _query,
                                      autocorrect: false,
                                      textCapitalization:
                                          TextCapitalization.none,
                                      decoration: InputDecoration(
                                        hintText: context
                                            .l10n
                                            .conversationsSearchChats,
                                        filled: true,
                                        fillColor: colors.onSurface.withValues(
                                          alpha: .05,
                                        ),
                                        border: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            16,
                                          ),
                                          borderSide: BorderSide.none,
                                        ),
                                        contentPadding: const EdgeInsets.all(
                                          14,
                                        ),
                                      ),
                                      onChanged: _search,
                                    ),
                                  ),
                                action(
                                  context.l10n.conversationsChat,
                                  DjlIcons.chats,
                                  () => widget.onDestination(
                                    CloudDestination.chat,
                                  ),
                                ),
                                action(
                                  context.l10n.appImages,
                                  DjlIcons.images,
                                  () => widget.onDestination(
                                    CloudDestination.images,
                                  ),
                                ),
                                action(
                                  context.l10n.conversationsRemote,
                                  DjlIcons.laptop,
                                  widget.onRemote,
                                ),
                                action(
                                  context.l10n.appNotifications,
                                  DjlIcons.bell,
                                  () => widget.onDestination(
                                    CloudDestination.notifications,
                                  ),
                                  badge: widget.unreadCount,
                                ),
                                ...section(
                                  context.l10n.conversationsPinned,
                                  widget.history.items
                                      .where((c) => c.pinned)
                                      .toList(),
                                ),
                                ...section(
                                  context.l10n.conversationsRecentChats,
                                  widget.history.items
                                      .where((c) => !c.pinned)
                                      .toList(),
                                ),
                                if (widget.history.loading)
                                  const Padding(
                                    padding: EdgeInsets.all(14),
                                    child: CupertinoActivityIndicator(),
                                  ),
                                if (widget.history.cursor != null &&
                                    widget.history.query.isEmpty)
                                  TextButton(
                                    onPressed: widget.history.loading
                                        ? null
                                        : () => widget.history.refresh(
                                            more: true,
                                          ),
                                    child: Text(
                                      context.l10n.conversationsLoadMore,
                                    ),
                                  ),
                                if (widget.history.error != null)
                                  Padding(
                                    padding: const EdgeInsets.all(14),
                                    child: Text(
                                      widget.history.error!,
                                      style: _menuBodyStyle.copyWith(
                                        fontSize: 12,
                                        color: colors.onSurfaceVariant,
                                      ),
                                    ),
                                  ),
                                if (widget.history.error != null)
                                  TextButton(
                                    onPressed: widget.history.loading
                                        ? null
                                        : () => widget.history.refresh(),
                                    child: Text(context.l10n.cloudChatRetry),
                                  ),
                              ]
                              .expand((row) => [row, const SizedBox(height: 4)])
                              .toList(),
                    ),
                  ),
                  Positioned(
                    top: 12,
                    left: 16,
                    right: 16,
                    child: Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        surface(
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 14),
                            child: ConstrainedBox(
                              constraints: const BoxConstraints(minHeight: 48),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Image.asset(
                                    'assets/djl-logo.png',
                                    width: 26,
                                    height: 26,
                                  ),
                                  const SizedBox(width: 8),
                                  Flexible(
                                    child: Text(
                                      'DJL',
                                      style: _menuBodyStyle.copyWith(
                                        fontSize: 18,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        surface(
                          Tooltip(
                            message: context.l10n.conversationsSearchChats,
                            excludeFromSemantics: true,
                            child: Semantics(
                              label: context.l10n.conversationsSearchChats,
                              button: true,
                              excludeSemantics: true,
                              onTap: _toggleSearch,
                              child: SizedBox(
                                width: 48,
                                height: 48,
                                child: IconButton(
                                  onPressed: _toggleSearch,
                                  icon: Icon(
                                    DjlIcons.search,
                                    size: 20,
                                    color: colors.onSurface,
                                  ),
                                ),
                              ),
                            ),
                          ),
                          radius: 24,
                        ),
                      ],
                    ),
                  ),
                  Positioned(
                    bottom: 16,
                    left: 18,
                    right: 18,
                    child: Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        surface(
                          Tooltip(
                            message: context.l10n.cloudChatNewChat,
                            excludeFromSemantics: true,
                            child: Semantics(
                              label: context.l10n.cloudChatNewChat,
                              button: true,
                              excludeSemantics: true,
                              onTap: widget.onNewChat,
                              child: CupertinoButton(
                                minimumSize: const Size(0, 50),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 20,
                                  vertical: 12,
                                ),
                                onPressed: widget.onNewChat,
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      DjlIcons.compose,
                                      size: 18,
                                      color: colors.surface,
                                    ),
                                    const SizedBox(width: 8),
                                    Flexible(
                                      child: Text(
                                        context.l10n.conversationsChat,
                                        style: _menuBodyStyle.copyWith(
                                          fontWeight: FontWeight.w600,
                                          color: colors.surface,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          tint: colors.onSurface,
                        ),
                        surface(
                          Tooltip(
                            message: context.l10n.conversationsSettings,
                            excludeFromSemantics: true,
                            child: Semantics(
                              label: context.l10n.conversationsSettings,
                              button: true,
                              excludeSemantics: true,
                              onTap: () => widget.onDestination(
                                CloudDestination.settings,
                              ),
                              child: SizedBox(
                                width: 50,
                                height: 50,
                                child: IconButton(
                                  onPressed: () => widget.onDestination(
                                    CloudDestination.settings,
                                  ),
                                  icon: Icon(
                                    DjlIcons.settings,
                                    size: 22,
                                    color: colors.onSurface,
                                  ),
                                ),
                              ),
                            ),
                          ),
                          radius: 25,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      );
    },
  );

  void _toggleSearch() {
    setState(() => _searching = !_searching);
    if (!_searching) {
      _debounce?.cancel();
      _query.clear();
      widget.history.query = '';
      widget.history.refresh();
    }
  }
}
