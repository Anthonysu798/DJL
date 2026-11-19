import 'dart:async';
import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart' show CupertinoIcons;
import '../../../app/desktop_deep_link.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../../core/platform/native_text_search.dart';
import '../../pairing/data/pairing_repository.dart';
import '../../status/domain/run_status.dart';
import '../../settings/domain/appearance.dart';
import '../domain/thread_local_state.dart';
import '../domain/desktop_attention.dart';
import 'desktop_attention_page.dart';
import 'desktop_controller.dart';
import 'desktop_thread_pin_menu.dart';

// Match the wire parser used by CodexThread: seconds, ms, us, ns or ISO-8601.
double? _timestamp(Object? value) {
  final number = value is num
      ? value.toDouble()
      : value is String
      ? double.tryParse(value.trim())
      : null;
  if (number != null && number.isFinite) {
    final absolute = number.abs();
    return number /
        (absolute >= 1e18
            ? 1e9
            : absolute >= 1e15
            ? 1e6
            : absolute >= 1e10
            ? 1e3
            : 1);
  }
  final date = value is String ? DateTime.tryParse(value.trim()) : null;
  return date == null ? null : date.microsecondsSinceEpoch / 1e6;
}

double? _recentDate(RemoteJson thread) =>
    _timestamp(thread['updatedAt']) ??
    _timestamp(thread['updated_at']) ??
    _timestamp(thread['createdAt']) ??
    _timestamp(thread['created_at']);

List<RemoteJson> desktopPhoneThreads(ThreadLocalState data) {
  final result = data.snapshots.where((thread) {
    final id = thread['id'];
    return id is String &&
        !data.deleted.contains(id) &&
        !data.isArchived(id) &&
        thread['syncState'] != 'archivedLocal' &&
        thread['sync_state'] != 'archivedLocal' &&
        normalizeThread(thread)['parentThreadId'] == null;
  }).toList();
  result.sort((a, b) {
    final left = _recentDate(a), right = _recentDate(b);
    final date = left == null
        ? (right == null ? 0 : 1)
        : right == null
        ? -1
        : right.compareTo(left);
    return date != 0 ? date : (a['id'] as String).compareTo(b['id'] as String);
  });
  return result;
}

class DesktopNavigationMenu extends StatefulWidget {
  const DesktopNavigationMenu({
    super.key,
    required this.controller,
    required this.onThread,
    required this.onNewChat,
    required this.onRemote,
    required this.isCurrent,
    this.onSettings,
    this.onCloud,
    this.onReview,
    this.selectedThreadId,
    this.remoteSelected = false,
    this.runStatus,
    this.visible = true,
  });
  final DesktopController controller;
  final ValueChanged<RemoteJson> onThread;
  final VoidCallback onNewChat, onRemote;
  final VoidCallback? onSettings, onCloud, onReview;
  final bool Function() isCurrent;
  final String? selectedThreadId;
  final bool remoteSelected, visible;
  final RunStatusProjector? runStatus;
  @override
  State<DesktopNavigationMenu> createState() => _DesktopNavigationMenuState();
}

class _DesktopNavigationMenuState extends State<DesktopNavigationMenu>
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  final _search = TextEditingController();
  bool _showsSearch = false;
  String? _previewThread;
  String? _pressedThread;
  late final AnimationController _press;
  double get _pressScale =>
      1 + .06 * Curves.easeOutQuad.transform(_press.value);
  final _header = GlobalKey();
  double _headerHeight = 74;
  String? _matchQuery;
  List<String>? _matchTitles;
  Future<List<int>>? _matches;

  Future<List<int>> _matchingRows(List<RemoteJson> rows) {
    final titles = rows.map(threadTitle).toList();
    if (_matchQuery != _search.text || !listEquals(_matchTitles, titles)) {
      _matchQuery = _search.text;
      _matchTitles = titles;
      _matches = nativeSearchMatches(titles, _search.text);
    }
    return _matches!;
  }

  Timer? _expiry;
  DateTime? _deadline;
  bool _resumed = true;
  @override
  void initState() {
    super.initState();
    _press = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
      reverseDuration: const Duration(milliseconds: 150),
    );
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    setState(() => _resumed = state == AppLifecycleState.resumed);
    if (!_resumed) {
      _expiry?.cancel();
      _expiry = null;
      _deadline = null;
    }
  }

  void _scheduleExpiry(DateTime? deadline) {
    if (_deadline == deadline) return;
    _expiry?.cancel();
    _deadline = deadline;
    if (deadline == null) return;
    final delay = deadline.difference(widget.runStatus!.now());
    _expiry = Timer(delay.isNegative ? Duration.zero : delay, () {
      _deadline = null;
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _expiry?.cancel();
    _search.dispose();
    _press.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([widget.controller, ?widget.runStatus]),
    builder: (context, _) {
      final desktop = widget.controller,
          pair = desktop.active,
          data = desktop.threadList.data;
      final mac = pair?.macDeviceId,
          pin = pair?.data['macIdentityPublicKey'] as String?;
      final revision = desktop.navigationRevision,
          selection = desktop.selectionRevision;
      bool owner() =>
          mounted &&
          desktop.active?.macDeviceId == mac &&
          desktop.active?.data['macIdentityPublicKey'] == pin &&
          desktop.navigationRevision == revision &&
          desktop.selectionRevision == selection &&
          identical(desktop.threadList.data, data) &&
          desktop.navigationTarget == null &&
          (pair == null ||
              pin != null &&
                  desktop.trusted.any(
                    (p) => p.macDeviceId == mac && p.publicKey == pin,
                  ));
      bool current() => owner() && widget.isCurrent();
      final rows = mac != null && desktop.threadList.macDeviceId == mac
          ? desktopPhoneThreads(data)
          : <RemoteJson>[];
      final attention = desktop.attentionItems;
      void review(DesktopAttentionItem item) {
        if (!current() || mac == null || pin == null) return;
        final fresh = desktop.attentionItems
            .where(
              (value) =>
                  value.id == item.id &&
                  value.target == item.target &&
                  value.requestId == item.requestId,
            )
            .firstOrNull;
        final fingerprint = DesktopLinkTarget.keyFingerprint(pin);
        if (fresh == null || fingerprint == null) return;
        widget.onReview?.call();
        desktop.queueNavigation(
          DesktopLinkTarget(
            fresh.target.thread,
            turn: fresh.target.turn,
            item: fresh.target.item,
            message: fresh.target.message,
            request: fresh.requestId,
            macId: mac,
            macKeySha256: fingerprint,
          ),
        );
      }

      Future<void> openAttention() async {
        if (!current()) return;
        FocusManager.instance.primaryFocus?.unfocus();
        final item = await Navigator.of(context).push<DesktopAttentionItem>(
          MaterialPageRoute(
            builder: (_) =>
                DesktopAttentionPage(controller: desktop, isCurrent: owner),
          ),
        );
        if (item != null) review(item);
      }

      final live = mac == null || pin == null || !widget.visible || !_resumed
          ? null
          : widget.runStatus?.liveRunningThreads(
              mac: mac,
              fingerprint: DesktopLinkTarget.keyFingerprint(pin) ?? '',
            );
      final running = live?.ids ?? const <String>{};
      _scheduleExpiry(live?.nextDeadline);
      final largeText = MediaQuery.textScalerOf(context).scale(22) > 33;
      final scheme = Theme.of(context).colorScheme;
      final neutralControlStyle = IconButton.styleFrom(
        backgroundColor: Colors.transparent,
        foregroundColor: scheme.onSurface,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      );
      Widget section(String text) => Padding(
        padding: const EdgeInsets.fromLTRB(14, 26, 14, 8),
        child: Semantics(
          header: true,
          child: Text(
            text,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: scheme.onSurfaceVariant,
            ),
          ),
        ),
      );
      Widget empty(String text) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        child: Text(
          text,
          style: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
        ),
      );
      Widget row(RemoteJson thread, bool pinned) {
        final id = thread['id'] as String;
        final selected = widget.selectedThreadId == id;
        final fill = selected
            ? scheme.onSurface.withValues(alpha: .065)
            : Colors.transparent;
        // Native lifted rows retain their undimmed selection contrast.
        final previewTint =
            255 * .065 * (scheme.brightness == Brightness.dark ? 1 : -1);
        final content = ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 50),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Row(
              children: [
                SizedBox(
                  width: 26,
                  child: Icon(
                    pinned ? CupertinoIcons.pin : CupertinoIcons.bubble_left,
                    size: 18,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    threadTitle(thread),
                    style: const TextStyle(
                      fontSize: 17,
                      height: kTextHeightNone,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (running.contains(id))
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
          ),
        );

        return Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: Opacity(
            key: ValueKey('navigation.thread-paint.$id'),
            opacity: _previewThread == id ? 0 : 1,
            child: Builder(
              builder: (rowContext) => Listener(
                onPointerDown: (_) {
                  if (!current() ||
                      _previewThread != null ||
                      MediaQuery.disableAnimationsOf(context)) {
                    return;
                  }
                  setState(() => _pressedThread = id);
                  _press.forward(from: 0);
                },
                onPointerUp: (_) => _press.reverse(),
                onPointerCancel: (_) => _press.reverse(),
                child: AnimatedBuilder(
                  animation: _press,
                  builder: (_, child) => Transform.scale(
                    scale: _pressedThread == id ? _pressScale : 1,
                    transformHitTests: false,
                    child: child,
                  ),
                  child: Material(
                    color: fill,
                    borderRadius: BorderRadius.circular(14),
                    child: Semantics(
                      container: true,
                      button: true,
                      identifier: 'navigation.thread.$id',
                      child: InkWell(
                        key: ValueKey('navigation.thread.$id'),
                        borderRadius: BorderRadius.circular(14),
                        onTap: () {
                          if (current()) widget.onThread(thread);
                        },
                        onTapCancel: () => _press.reverse(),
                        onLongPress: () async {
                          if (!current()) return;
                          final row =
                              rowContext.findRenderObject()! as RenderBox;
                          final overlay =
                              Navigator.of(
                                    rowContext,
                                  ).overlay!.context.findRenderObject()!
                                  as RenderBox;
                          final anchor =
                              row.localToGlobal(
                                Offset.zero,
                                ancestor: overlay,
                              ) &
                              row.size;
                          final initialScale = _pressedThread == id
                              ? _pressScale
                              : 1.0;
                          _press.reset();
                          setState(() {
                            _pressedThread = null;
                            _previewThread = id;
                          });
                          bool? action;
                          try {
                            action = await showDesktopThreadPinMenu(
                              rowContext,
                              anchor,
                              pinned: pinned,
                              initialScale: initialScale,
                              preview: ClipRRect(
                                borderRadius: BorderRadius.circular(14),
                                child: BackdropFilter(
                                  enabled: selected,
                                  filter: ColorFilter.matrix([
                                    1,
                                    0,
                                    0,
                                    0,
                                    previewTint,
                                    0,
                                    1,
                                    0,
                                    0,
                                    previewTint,
                                    0,
                                    0,
                                    1,
                                    0,
                                    previewTint,
                                    0,
                                    0,
                                    0,
                                    1,
                                    0,
                                  ]),
                                  child: Material(
                                    color: Colors.transparent,
                                    child: content,
                                  ),
                                ),
                              ),
                            );
                          } finally {
                            if (mounted && _previewThread == id) {
                              setState(() => _previewThread = null);
                            }
                          }
                          if (action != null && current()) {
                            await desktop.threadList.pin(id, action);
                          }
                        },
                        child: content,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      }

      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final height = _header.currentContext?.size?.height;
        if (height != null && height != _headerHeight) {
          setState(() => _headerHeight = height);
        }
      });
      return Material(
        color: scheme.surface,
        child: SafeArea(
          right: false,
          maintainBottomViewPadding: true,
          child: Stack(
            children: [
              Positioned.fill(
                child: ShaderMask(
                  blendMode: BlendMode.dstIn,
                  shaderCallback: (bounds) => LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: const [
                      Colors.transparent,
                      Colors.black,
                      Colors.black,
                    ],
                    stops: [0, (20 / bounds.height).clamp(0, 1), 1],
                  ).createShader(bounds),
                  child: FutureBuilder<List<int>>(
                    future: _matchingRows(rows),
                    builder: (context, snapshot) {
                      final matches = _search.text.isEmpty
                          ? rows
                          : snapshot.connectionState == ConnectionState.done &&
                                !snapshot.hasError
                          ? (snapshot.data ?? const <int>[])
                                .map((index) => rows[index])
                                .toList()
                          : const <RemoteJson>[];
                      final pinned = matches
                          .where((t) => data.isPinned(t['id'] as String))
                          .toList();
                      final recent = matches
                          .where((t) => !data.isPinned(t['id'] as String))
                          .toList();
                      return ListView(
                        key: const Key('navigation.list'),
                        padding: EdgeInsets.fromLTRB(
                          10,
                          _headerHeight,
                          10,
                          124,
                        ),
                        keyboardDismissBehavior:
                            ScrollViewKeyboardDismissBehavior.onDrag,
                        children: [
                          _destination(
                            'Cloud chat',
                            CupertinoIcons.cloud,
                            widget.onCloud == null
                                ? null
                                : () {
                                    if (current()) widget.onCloud!();
                                  },
                          ),
                          _destination(
                            'Remote',
                            CupertinoIcons.device_laptop,
                            () {
                              if (current()) widget.onRemote();
                            },
                            selected: widget.remoteSelected,
                            trailing: CupertinoIcons.arrow_up_right,
                          ),
                          _destination(
                            'Attention',
                            CupertinoIcons.tray,
                            () => unawaited(openAttention()),
                            count: attention.length,
                          ),
                          if (_search.text.isNotEmpty && snapshot.hasError) ...[
                            empty('Could not search chats.'),
                            TextButton(
                              onPressed: () =>
                                  setState(() => _matchQuery = null),
                              child: const Text('Retry search'),
                            ),
                          ] else if (_search.text.isNotEmpty &&
                              snapshot.connectionState != ConnectionState.done)
                            empty('Searching chats…')
                          else ...[
                            section('Pinned'),
                            if (pinned.isEmpty)
                              empty(
                                'Keep favorite chats close.\nTouch and hold a chat to pin it.',
                              ),
                            for (final thread in pinned) row(thread, true),
                            section('Recent chats'),
                            if (recent.isEmpty)
                              empty(
                                _search.text.isEmpty
                                    ? 'Your chats will appear here.'
                                    : 'No matching chats',
                              ),
                            for (final thread in recent) row(thread, false),
                          ],
                        ],
                      );
                    },
                  ),
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                top: 0,
                child: Column(
                  key: _header,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Padding(
                      padding: EdgeInsets.fromLTRB(
                        largeText ? 8 : 22,
                        12,
                        largeText ? 8 : 22,
                        18,
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Flexible(
                            child: DjlGlassSurface(
                              radius: 22,
                              child: Container(
                                constraints: const BoxConstraints(
                                  minHeight: 44,
                                ),
                                padding: EdgeInsets.symmetric(
                                  horizontal: largeText ? 6 : 12,
                                  vertical: 4,
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Image.asset(
                                      'assets/djl-logo.png',
                                      width: 25,
                                      height: 25,
                                      excludeFromSemantics: true,
                                    ),
                                    SizedBox(width: largeText ? 4 : 8),
                                    Flexible(
                                      child: Text(
                                        'DJL',
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: Theme.of(context)
                                            .textTheme
                                            .titleLarge
                                            ?.copyWith(
                                              fontSize: 22,
                                              fontWeight: FontWeight.w600,
                                            ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          DjlGlassSurface(
                            radius: 22,
                            child: IconButton(
                              style: neutralControlStyle,
                              constraints: const BoxConstraints.tightFor(
                                width: 44,
                                height: 44,
                              ),
                              tooltip: _showsSearch
                                  ? 'Close search'
                                  : 'Search chats',
                              onPressed: () => setState(() {
                                _showsSearch = !_showsSearch;
                                if (!_showsSearch) _search.clear();
                              }),
                              icon: Icon(
                                _showsSearch
                                    ? CupertinoIcons.xmark
                                    : CupertinoIcons.search,
                                size: 19,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (_showsSearch)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(18, 0, 18, 12),
                        child: TextField(
                          key: const Key('navigation.search'),
                          controller: _search,
                          autofocus: true,
                          autocorrect: false,
                          textCapitalization: TextCapitalization.none,
                          style: const TextStyle(fontSize: 17),
                          onChanged: (_) => setState(() {}),
                          decoration: InputDecoration(
                            hintText: 'Search chats',
                            contentPadding: const EdgeInsets.all(12),
                            filled: true,
                            fillColor: scheme.surfaceContainerLow,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: BorderSide.none,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: Padding(
                  padding: EdgeInsets.fromLTRB(
                    largeText ? 8 : 22,
                    12,
                    largeText ? 8 : 22,
                    0,
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Flexible(
                        child: FilledButton.icon(
                          style: FilledButton.styleFrom(
                            minimumSize: const Size(0, 50),
                            padding: EdgeInsets.symmetric(
                              horizontal: largeText ? 18 : 22,
                              vertical: 10,
                            ),
                            backgroundColor: scheme.onSurface,
                            foregroundColor: scheme.surface,
                            disabledBackgroundColor: scheme.onSurface,
                            disabledForegroundColor: scheme.onSurfaceVariant,
                            textStyle: const TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          onPressed: desktop.runtimeReady && current()
                              ? () {
                                  if (current() && desktop.runtimeReady) {
                                    widget.onNewChat();
                                  }
                                }
                              : null,
                          icon: const Icon(
                            CupertinoIcons.square_pencil,
                            size: 20,
                          ),
                          label: const Text(
                            'Chat',
                            semanticsLabel: 'New chat',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                      DjlGlassSurface(
                        radius: 25,
                        child: IconButton(
                          style: neutralControlStyle,
                          tooltip: 'Settings',
                          constraints: const BoxConstraints.tightFor(
                            width: 50,
                            height: 50,
                          ),
                          onPressed: widget.onSettings,
                          icon: const Icon(CupertinoIcons.gear_alt, size: 22),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );

  Widget _destination(
    String label,
    IconData icon,
    VoidCallback? action, {
    bool selected = false,
    IconData? trailing,
    int count = 0,
  }) {
    final cloud = icon == CupertinoIcons.cloud;
    final scaler = MediaQuery.textScalerOf(context);
    final tracking =
        DjlAppearance.of(context).font == AppFontStyle.system &&
            scaler.scale(17) == 17
        ? switch (Theme.of(context).platform) {
            TargetPlatform.iOS => -.44,
            TargetPlatform.android => .28,
            _ => 0.0,
          }
        : 0.0;
    final glyph = Icon(icon, size: cloud ? scaler.scale(21) : 22);
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Semantics(
        button: true,
        enabled: action != null,
        selected: selected,
        child: Material(
          color: selected
              ? Theme.of(context).colorScheme.onSurface.withValues(alpha: .055)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            onTap: action,
            borderRadius: BorderRadius.circular(16),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 52),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 8,
                ),
                child: Row(
                  children: [
                    SizedBox(
                      width: cloud ? scaler.scale(23) : 26,
                      child: icon == CupertinoIcons.device_laptop
                          ? SizedBox(
                              height: 22,
                              child: OverflowBox(
                                minWidth: 32,
                                maxWidth: 32,
                                minHeight: 22,
                                maxHeight: 22,
                                child: CustomPaint(
                                  size: const Size(32, 22),
                                  painter: _DrawerLaptopPainter(
                                    Theme.of(context).colorScheme.onSurface,
                                  ),
                                ),
                              ),
                            )
                          : glyph,
                    ),
                    SizedBox(width: cloud ? 8 : 14),
                    Expanded(
                      child: Text(
                        label,
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w500,
                          letterSpacing: tracking,
                        ),
                      ),
                    ),
                    if (count > 0)
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: Badge.count(count: count),
                      ),
                    if (trailing != null)
                      Icon(
                        trailing,
                        size: 12,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DrawerLaptopPainter extends CustomPainter {
  const _DrawerLaptopPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.translate(
      (size.width - 31) / 2 + 1 / 6,
      (size.height - 52 / 3) / 2 + 0.5,
    );
    final screen = RRect.fromRectAndRadius(
      const Rect.fromLTWH(11 / 3, 0, 71 / 3, 52 / 3),
      const Radius.circular(5 / 3),
    );
    final window = screen.deflate(5 / 3);
    canvas.drawRRect(window, Paint()..color = color.withValues(alpha: .25));
    canvas.drawPath(
      Path()
        ..fillType = PathFillType.evenOdd
        ..addRRect(screen)
        ..addRRect(window),
      Paint()..color = color,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        const Rect.fromLTWH(0, 15, 31, 7 / 3),
        const Radius.circular(7 / 6),
      ),
      Paint()..color = color,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(_DrawerLaptopPainter oldDelegate) =>
      oldDelegate.color != color;
}
