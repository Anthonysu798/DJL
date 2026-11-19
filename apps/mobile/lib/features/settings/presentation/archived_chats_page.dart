import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../desktop/presentation/desktop_threads_controller.dart';
import '../../desktop/presentation/desktop_controller.dart';
import '../../desktop/domain/thread_local_state.dart';
import '../../pairing/data/pairing_repository.dart';
import 'archived_chat_row.dart';
import 'archived_remove_confirmation.dart';
import 'settings_group.dart';

class SettingsArchivedChatsCard extends StatelessWidget {
  const SettingsArchivedChatsCard({super.key, required this.desktop});
  final DesktopController desktop;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: desktop.threadList,
    builder: (context, _) {
      final count = desktop.threadList.data.visible(archived: true).length;
      return SettingsGroup(
        title: 'Archived',
        children: [
          SettingsLinkRow(
            title: 'Archived Chats',
            subtitle: count == 0 ? null : '$count saved locally',
            leading: const Icon(CupertinoIcons.archivebox),
            onTap: () => Navigator.push<void>(
              context,
              MaterialPageRoute(
                builder: (_) => ArchivedChatsPage(desktop: desktop),
              ),
            ),
          ),
        ],
      );
    },
  );
}

class ArchivedChatsPage extends StatefulWidget {
  const ArchivedChatsPage({super.key, required this.desktop});
  final DesktopController desktop;
  DesktopThreadsController get controller => desktop.threadList;
  @override
  State<ArchivedChatsPage> createState() => _ArchivedChatsPageState();
}

class _ArchivedChatsPageState extends State<ArchivedChatsPage>
    with WidgetsBindingObserver {
  String? _revealed;
  late final Timer _dateTicker;
  bool _hasDates = false, _active = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _active = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    _dateTicker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_active &&
          _hasDates &&
          mounted &&
          ModalRoute.of(context)?.isCurrent == true) {
        setState(() {});
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _active = state == AppLifecycleState.resumed;
    if (_active && _hasDates && mounted) setState(() {});
  }

  @override
  void dispose() {
    _dateTicker.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  bool _scopeCurrent(ThreadLocalState data, String? mac) =>
      mounted &&
      identical(widget.controller.data, data) &&
      widget.controller.macDeviceId == mac;

  bool _owns(ThreadLocalState data, String? mac, String id) =>
      _scopeCurrent(data, mac) &&
      data.find(id) != null &&
      !data.deleted.contains(id) &&
      data.isArchived(id);

  void _unarchive(ThreadLocalState data, String? mac, String id) {
    if (_owns(data, mac, id)) unawaited(widget.controller.archive(id, false));
  }

  Future<void> _remove(
    ThreadLocalState data,
    String? mac,
    String id,
    Offset point,
  ) async {
    if (!_owns(data, mac, id)) return;
    final title = threadTitle(data.find(id)!);
    final confirmed = await showArchivedRemoveConfirmation(
      context,
      title: title,
      anchor: point,
    );
    if (confirmed && _owns(data, mac, id)) {
      await widget.controller.remove(id, archiveOnDesktop: false);
      if (_scopeCurrent(data, mac) && data.deleted.contains(id)) {
        widget.desktop.closeThread(id);
      }
    }
  }

  Future<void> _menu(
    ThreadLocalState data,
    String? mac,
    String id,
    Offset point,
  ) async {
    if (!_owns(data, mac, id)) return;
    final overlay =
        Navigator.of(context).overlay!.context.findRenderObject() as RenderBox;
    final local = overlay.globalToLocal(point), size = overlay.size;
    final choice = await showMenu<String>(
      context: context,
      position: RelativeRect.fromLTRB(
        local.dx,
        local.dy,
        size.width - local.dx,
        size.height - local.dy,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
      constraints: BoxConstraints(
        maxWidth: size.width < 282 ? size.width - 32 : 250,
      ),
      items: [
        PopupMenuItem(
          value: 'unarchive',
          child: Row(
            children: [
              const Icon(CupertinoIcons.tray_arrow_up, size: 20),
              const SizedBox(width: 12),
              Expanded(
                child: Text('Unarchive', style: settingsTextStyle(context, 17)),
              ),
            ],
          ),
        ),
        PopupMenuItem(
          value: 'remove',
          child: Row(
            children: [
              const Icon(
                CupertinoIcons.trash,
                size: 20,
                color: CupertinoColors.systemRed,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Remove from Phone',
                  style: settingsTextStyle(
                    context,
                    17,
                    color: CupertinoColors.systemRed,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
    if (!_owns(data, mac, id)) return;
    if (choice == 'unarchive') _unarchive(data, mac, id);
    if (choice == 'remove') await _remove(data, mac, id, point);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final controller = widget.controller,
          data = controller.data,
          mac = controller.macDeviceId;
      final rows = data.visible(archived: true)
        ..sort(
          (a, b) => (_archiveDate(b)?.millisecondsSinceEpoch ?? 0).compareTo(
            _archiveDate(a)?.millisecondsSinceEpoch ?? 0,
          ),
        );
      _hasDates = rows.any((row) => _archiveDate(row) != null);
      final colors = Theme.of(context).colorScheme;
      final background = colors.brightness == Brightness.dark
          ? Colors.black
          : rows.isEmpty
          ? Colors.white
          : colors.surfaceContainerLow;
      final card = colors.brightness == Brightness.dark
          ? colors.surfaceContainerLow
          : colors.surface;
      return Scaffold(
        backgroundColor: background,
        appBar: AppBar(
          toolbarHeight: 44,
          backgroundColor: background,
          surfaceTintColor: Colors.transparent,
          centerTitle: true,
          leadingWidth: 76,
          leading: Padding(
            padding: const EdgeInsets.only(left: 16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: SizedBox.square(
                dimension: 44,
                child: DjlGlassSurface(
                  radius: 999,
                  useNativeView: false,
                  child: IconButton(
                    tooltip: MaterialLocalizations.of(
                      context,
                    ).backButtonTooltip,
                    onPressed: () => Navigator.maybePop(context),
                    style: IconButton.styleFrom(
                      backgroundColor: colors.brightness == Brightness.dark
                          ? colors.surfaceContainerLow
                          : colors.surface,
                      padding: EdgeInsets.zero,
                      shape: const CircleBorder(),
                    ),
                    icon: Icon(
                      CupertinoIcons.chevron_back,
                      size: 22,
                      color: colors.onSurface,
                    ),
                  ),
                ),
              ),
            ),
          ),
          title: Text(
            'Archived Chats',
            style: settingsTextStyle(
              context,
              17,
              weight: FontWeight.w600,
              color: colors.onSurface,
            ),
          ),
        ),
        body: SafeArea(
          top: false,
          child: CustomScrollView(
            slivers: [
              for (final warning in [
                controller.localError,
                controller.syncWarning,
              ])
                if (warning != null)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        warning,
                        style: settingsTextStyle(
                          context,
                          12,
                          color: colors.error,
                        ),
                      ),
                    ),
                  ),
              if (rows.isEmpty)
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            CupertinoIcons.archivebox,
                            size: 36,
                            color: CupertinoColors.tertiaryLabel.resolveFrom(
                              context,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            'No archived chats',
                            style: settingsTextStyle(
                              context,
                              14,
                              color: colors.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 46, 16, 24),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate((context, index) {
                      final thread = rows[index], id = thread['id'] as String;
                      final date = _archiveDate(thread),
                          reference = DateTime.now();
                      return Material(
                        color: card,
                        clipBehavior: Clip.antiAlias,
                        borderRadius: BorderRadius.vertical(
                          top: index == 0
                              ? const Radius.circular(26)
                              : Radius.zero,
                          bottom: index == rows.length - 1
                              ? const Radius.circular(26)
                              : Radius.zero,
                        ),
                        child: Column(
                          children: [
                            ArchivedChatRow(
                              key: ValueKey((data, id)),
                              title: threadTitle(thread),
                              color: card,
                              revealed: _revealed == id,
                              onReveal: () => setState(() => _revealed = id),
                              onUnarchive: () => _unarchive(data, mac, id),
                              onRemove: (point) =>
                                  unawaited(_remove(data, mac, id, point)),
                              onMenu: (point) =>
                                  unawaited(_menu(data, mac, id, point)),
                              subtitle: date == null
                                  ? null
                                  : FutureBuilder<String?>(
                                      future: _relativeDate(date, reference),
                                      builder: (context, snapshot) => Text(
                                        snapshot.data ??
                                            _elapsedFallback(date, reference),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: settingsTextStyle(
                                          context,
                                          11,
                                          color: colors.onSurfaceVariant,
                                        ),
                                      ),
                                    ),
                            ),
                            if (index < rows.length - 1)
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 16,
                                ),
                                child: Divider(
                                  height: 1,
                                  thickness: .5,
                                  color: colors.outlineVariant,
                                ),
                              ),
                          ],
                        ),
                      );
                    }, childCount: rows.length),
                  ),
                ),
            ],
          ),
        ),
      );
    },
  );
}

DateTime? _archiveDate(RemoteJson thread) {
  for (var raw in [
    thread['updatedAt'],
    thread['updated_at'],
    thread['createdAt'],
    thread['created_at'],
  ]) {
    if (raw is String) {
      final text = raw.trim();
      raw = num.tryParse(text) ?? text;
      if (raw is String) {
        final date = DateTime.tryParse(raw);
        if (date != null) return date;
      }
    }
    if (raw is num && raw.isFinite) {
      final absolute = raw.abs();
      final millis = absolute >= 1000000000000000000
          ? raw / 1000000
          : absolute >= 1000000000000000
          ? raw / 1000
          : absolute >= 10000000000
          ? raw
          : raw * 1000;
      try {
        return DateTime.fromMillisecondsSinceEpoch(millis.round());
      } on RangeError {
        continue;
      }
    }
  }
  return null;
}

Future<String?> _relativeDate(DateTime date, DateTime reference) async {
  try {
    final value = await const MethodChannel('djl.mobile/app-info')
        .invokeMethod<Object?>('relativeDate', {
          'date': date.millisecondsSinceEpoch,
          'relativeTo': reference.millisecondsSinceEpoch,
          'elapsed': true,
        });
    return value is String && value.trim().isNotEmpty ? value : null;
  } on MissingPluginException {
    return null;
  } on PlatformException {
    return null;
  }
}

String _elapsedFallback(DateTime date, DateTime reference) {
  final seconds = reference.difference(date).inSeconds.abs();
  if (seconds >= 86400) {
    final days = seconds ~/ 86400;
    return '$days ${days == 1 ? 'day' : 'days'}';
  }
  if (seconds >= 3600) {
    final hours = seconds ~/ 3600;
    return '$hours ${hours == 1 ? 'hr' : 'hrs'}, ${(seconds % 3600) ~/ 60} mins';
  }
  if (seconds >= 60) return '${seconds ~/ 60} mins, ${seconds % 60} secs';
  return '$seconds secs';
}
