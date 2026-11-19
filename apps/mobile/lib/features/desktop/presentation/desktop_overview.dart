import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../pairing/data/pairing_repository.dart';
import '../data/desktop_overview_repository.dart';
import '../domain/desktop_overview.dart';
import 'desktop_controller.dart';
import 'desktop_composer_options_menu.dart';
import 'desktop_thread_actions.dart';
import 'desktop_thread_menu.dart';
import '../../groups/presentation/groups_controller.dart';
import '../../groups/presentation/groups_page.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

class DesktopOverview extends StatefulWidget {
  const DesktopOverview({
    super.key,
    required this.desktop,
    required this.onNavigation,
    required this.onConnections,
    required this.onSecureDetails,
    required this.onHost,
    required this.onProject,
    required this.onQuickChat,
    required this.onChat,
    required this.emptyPanel,
    required this.feedback,
    this.onSettings,
    this.navigationNotice,
    this.switchOverlay,
    this.groups,
  });
  final DesktopController desktop;
  final VoidCallback onNavigation,
      onConnections,
      onSecureDetails,
      onHost,
      onProject,
      onQuickChat;
  final Future<void> Function(
    RemoteJson? thread, {
    String? cwd,
    DesktopDraftSource? source,
  })
  onChat;
  final VoidCallback? onSettings;
  final Widget emptyPanel, feedback;
  final Widget? navigationNotice, switchOverlay;

  /// Group chats on this Mac; adds the Groups tab when present.
  final GroupsController? groups;
  @override
  State<DesktopOverview> createState() => _DesktopOverviewState();
}

class _DesktopOverviewState extends State<DesktopOverview> {
  final _search = TextEditingController(), _searchFocus = FocusNode();
  DesktopOverviewScope _scope = DesktopOverviewScope.studio;
  bool _groupsScope = false;
  final _expandedChildren = <String>{};
  Object? _binding;
  Object? _identity;
  int _identityRevision = 0;
  int _metadataRevision = 0;
  List<String> _roots = [];
  late DesktopOverviewRepository _repository;
  DesktopController get desktop => widget.desktop;
  bool get _metadataReady =>
      desktop.connected &&
      desktop.state == 'connected' &&
      desktop.active != null;
  Object get _currentBinding => (
    desktop.active?.macDeviceId,
    desktop.active?.data['macIdentityPublicKey'],
    desktop.host.connectionRevision,
    _metadataReady,
    desktop.threadList.data,
  );
  bool _current(Object binding, int revision) =>
      mounted &&
      _binding == binding &&
      _currentBinding == binding &&
      _metadataRevision == revision;
  VoidCallback _owned(VoidCallback action) {
    final binding = _currentBinding;
    return () {
      if (mounted && _currentBinding == binding) action();
    };
  }

  String? get _defaultProjectPath {
    final projects = projectDesktopOverview(
      desktop.threadList.data.visible(),
      scope: DesktopOverviewScope.projects,
      projectlessRoots: _roots,
    );
    return projects
            .expand((group) => group.threads)
            .where(
              (thread) =>
                  desktopConversationFolder(thread, projectlessRoots: _roots) !=
                  null,
            )
            .firstOrNull?['cwd']
        as String?;
  }

  @override
  void initState() {
    super.initState();
    _searchFocus.addListener(_focusChanged);
    _listen();
  }

  void _focusChanged() => setState(() {});
  void _listen() {
    desktop.addListener(_observeBinding);
    _observeBinding();
  }

  void _observeBinding() {
    final binding = _currentBinding;
    if (_binding == binding) return;
    _binding = binding;
    _repository = DesktopOverviewRepository(desktop.transport);
    final identity = (
      desktop.active?.macDeviceId,
      desktop.active?.data['macIdentityPublicKey'],
      desktop.threadList.data,
    );
    if (_identity != identity) {
      _identity = identity;
      ++_identityRevision;
      _search.clear();
      _searchFocus.unfocus();
      _expandedChildren.clear();
    }
    final revision = ++_metadataRevision;
    _roots = List.of(desktop.threadList.data.projectlessChatRoots);
    if (_metadataReady) unawaited(_loadRoots(binding, revision));
  }

  Future<void> _loadRoots(Object binding, int revision) async {
    try {
      final roots = await _repository.projectlessRoots();
      if (!_current(binding, revision)) return;
      if (listEquals(_roots, roots)) return;
      setState(() => _roots = roots);
      desktop.threadList.data.projectlessChatRoots
        ..clear()
        ..addAll(roots);
      desktop.threadList.scheduleSave();
    } catch (_) {
      // Older bridges retain the same generated-path classification fallback.
    }
  }

  @override
  void didUpdateWidget(DesktopOverview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.desktop != desktop) {
      oldWidget.desktop.removeListener(_observeBinding);
      _binding = null;
      _listen();
    }
  }

  @override
  void dispose() {
    desktop.removeListener(_observeBinding);
    _searchFocus.removeListener(_focusChanged);
    _searchFocus.dispose();
    _search.dispose();
    super.dispose();
  }

  List<DesktopOverviewGroup> _groups(DesktopOverviewScope scope) =>
      projectDesktopOverview(
        desktop.threadList.data.visible(
          archived: desktop.threadList.showArchived,
        ),
        scope: scope,
        pinned: desktop.threadList.data.pinned,
        projectlessRoots: _roots,
        query: _search.text,
      );
  void _chooseScope(DesktopOverviewScope scope) {
    setState(() {
      _scope = scope;
      _groupsScope = false;
    });
  }

  void _toggleProject(String path) {
    final collapsed = desktop.threadList.data.overviewCollapsedProjects;
    setState(() {
      if (!collapsed.remove(path)) collapsed.add(path);
    });
    desktop.threadList.scheduleSave();
  }

  void _toggleAll(List<DesktopOverviewGroup> groups) {
    final paths = groups.where((g) => g.project).map((g) => g.id).toSet();
    final collapsed = desktop.threadList.data.overviewCollapsedProjects;
    setState(() {
      if (paths.every(collapsed.contains)) {
        collapsed.removeAll(paths);
      } else {
        collapsed.addAll(paths);
      }
    });
    desktop.threadList.scheduleSave();
  }

  Color get _secondary => Theme.of(context).colorScheme.onSurfaceVariant;
  (Color, Color) get _accent {
    final scheme = Theme.of(context).colorScheme;
    return (scheme.onSurface, scheme.surface);
  }

  Widget _surface(Widget child, {Color? fill}) => DecoratedBox(
    decoration: BoxDecoration(
      color:
          fill ?? Theme.of(context).colorScheme.surface.withValues(alpha: .96),
      borderRadius: BorderRadius.circular(100),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(alpha: .055),
          blurRadius: 22,
          offset: const Offset(0, 7),
        ),
      ],
    ),
    child: child,
  );
  Widget _button({
    required String label,
    required Widget child,
    required VoidCallback? onTap,
    bool selected = false,
    Color? fill,
    EdgeInsets padding = EdgeInsets.zero,
  }) => Tooltip(
    message: label,
    excludeFromSemantics: true,
    child: Semantics(
      container: true,
      label: label,
      button: true,
      selected: selected,
      enabled: onTap != null,
      onTap: onTap,
      excludeSemantics: true,
      child: _surface(
        Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: BorderRadius.circular(100),
            onTap: onTap,
            child: Padding(padding: padding, child: child),
          ),
        ),
        fill: fill,
      ),
    ),
  );
  Widget _icon(
    String label,
    IconData icon,
    VoidCallback? onTap, {
    double size = 20,
  }) => _button(
    label: label,
    onTap: onTap,
    child: SizedBox.square(dimension: 40, child: Icon(icon, size: size)),
  );

  Widget _header() => Padding(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
    child: Row(
      children: [
        _button(
          label: 'Open navigation',
          onTap: widget.onNavigation,
          child: SizedBox.square(
            dimension: 40,
            child: Center(
              child: SizedBox(
                width: 18,
                height: 12,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
                      height: 2,
                      width: 18,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                    Container(
                      height: 2,
                      width: 10,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Text(
          'DJL',
          style: Theme.of(context).textTheme.bodyMedium!.copyWith(
            fontSize: 18,
            fontWeight: FontWeight.w500,
          ),
        ),
        const Spacer(),
        _surface(
          PopupMenuButton<String>(
            tooltip: 'More actions',
            padding: EdgeInsets.zero,
            style: IconButton.styleFrom(
              minimumSize: const Size.square(40),
              maximumSize: const Size.square(40),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            constraints: const BoxConstraints(minWidth: 220),
            icon: const SizedBox.square(
              dimension: 40,
              child: Icon(DjlIcons.more, size: 20),
            ),
            onSelected: (action) {
              switch (action) {
                case 'connections':
                  widget.onConnections();
                case 'secure':
                  widget.onSecureDetails();
                case 'host':
                  widget.onHost();
                case 'project':
                  widget.onProject();
                case 'chat':
                  widget.onChat(
                    null,
                    cwd: _defaultProjectPath,
                    source: DesktopDraftSource.generalChat,
                  );
                case 'quick-chat':
                  widget.onQuickChat();
                case 'disconnect':
                  desktop.disconnect();
                case 'archive':
                  desktop.threadList.filter(
                    archived: !desktop.threadList.showArchived,
                  );
                case 'refresh':
                  desktop.refreshThreads();
              }
            },
            itemBuilder: (_) => [
              PopupMenuItem(
                value: 'chat',
                enabled: desktop.runtimeReady,
                child: const Text('New Chat'),
              ),
              PopupMenuItem(
                value: 'quick-chat',
                enabled: desktop.runtimeReady,
                child: const Text('Quick Chat'),
              ),
              PopupMenuItem(
                value: 'project',
                enabled: desktop.runtimeReady,
                child: const Text('New Project'),
              ),
              const PopupMenuItem(
                value: 'connections',
                child: Text('Connections'),
              ),
              PopupMenuItem(
                value: 'secure',
                enabled: desktop.canEnterManualPairing,
                child: const Text('Secure pairing details'),
              ),
              if (desktop.active != null)
                const PopupMenuItem(
                  value: 'host',
                  child: Text('Paired host status and controls'),
                ),
              PopupMenuItem(
                value: 'archive',
                child: Text(
                  desktop.threadList.showArchived
                      ? 'Show active desktop chats'
                      : 'Show archived desktop chats',
                ),
              ),
              PopupMenuItem(
                value: 'refresh',
                enabled: desktop.connected,
                child: const Text('Refresh conversations'),
              ),
              if (desktop.connected)
                const PopupMenuItem(
                  value: 'disconnect',
                  child: Text('Disconnect desktop'),
                ),
            ],
          ),
        ),
        if (widget.onSettings != null) ...[
          const SizedBox(width: 10),
          _icon('Settings', DjlIcons.settings, widget.onSettings),
        ],
      ],
    ),
  );

  Widget _searchBar() {
    final binding = _currentBinding;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(
        children: [
          Expanded(
            child: _surface(
              ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 43),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  child: Row(
                    children: [
                      Icon(DjlIcons.search, size: 15, color: _secondary),
                      const SizedBox(width: 6),
                      Expanded(
                        child: TextField(
                          key: ValueKey(_identityRevision),
                          controller: _search,
                          focusNode: _searchFocus,
                          onChanged: (value) {
                            if (_currentBinding != binding) return;
                            desktop.threadList.filter(search: value);
                            setState(() {});
                          },
                          onSubmitted: (_) => _searchFocus.unfocus(),
                          textInputAction: TextInputAction.search,
                          autocorrect: false,
                          style: Theme.of(context).textTheme.bodyMedium,
                          decoration: const InputDecoration(
                            hintText: 'Search conversations',
                            filled: false,
                            isDense: true,
                            border: InputBorder.none,
                            enabledBorder: InputBorder.none,
                            focusedBorder: InputBorder.none,
                            contentPadding: EdgeInsets.zero,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          if (_searchFocus.hasFocus || _search.text.isNotEmpty) ...[
            const SizedBox(width: 8),
            _icon('Dismiss search', DjlIcons.close, () {
              _search.clear();
              _searchFocus.unfocus();
              desktop.threadList.filter(search: '');
              setState(() {});
            }, size: 16),
          ],
        ],
      ),
    );
  }

  Widget _connectionStatus() {
    final busy = desktop.state == 'connecting' || desktop.state == 'resolving';
    final label = busy
        ? 'Connecting'
        : desktop.state == 'desktop offline'
        ? 'Device offline'
        : 'Offline';
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Semantics(
          label: 'Connection status: $label',
          excludeSemantics: true,
          child: _surface(
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: busy
                          ? Theme.of(context).colorScheme.onSurface
                          : _secondary.withValues(alpha: .45),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    label,
                    style: Theme.of(context).textTheme.bodySmall!.copyWith(
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                      color: _secondary,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _scopes(List<DesktopOverviewGroup> groups) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
    child: Row(
      children: [
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final scope in DesktopOverviewScope.values) ...[
                  if (scope != DesktopOverviewScope.studio)
                    const SizedBox(width: 8),
                  _button(
                    label: scope.title,
                    selected: !_groupsScope && _scope == scope,
                    fill: !_groupsScope && _scope == scope ? _accent.$1 : null,
                    onTap: () => _chooseScope(scope),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 8,
                    ),
                    child: Text(
                      scope.title,
                      style: Theme.of(context).textTheme.bodyMedium!.copyWith(
                        fontSize: 14,
                        height: 1.2,
                        fontWeight: FontWeight.w500,
                        color: !_groupsScope && _scope == scope
                            ? _accent.$2
                            : null,
                      ),
                    ),
                  ),
                ],
                if (widget.groups != null) ...[
                  const SizedBox(width: 8),
                  _button(
                    label: 'Groups',
                    selected: _groupsScope,
                    fill: _groupsScope ? _accent.$1 : null,
                    onTap: () => setState(() => _groupsScope = true),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 8,
                    ),
                    child: Text(
                      'Groups',
                      style: Theme.of(context).textTheme.bodyMedium!.copyWith(
                        fontSize: 14,
                        height: 1.2,
                        fontWeight: FontWeight.w500,
                        color: _groupsScope ? _accent.$2 : null,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        if (!_groupsScope &&
            _scope == DesktopOverviewScope.projects &&
            groups.any((g) => g.project)) ...[
          const SizedBox(width: 8),
          _icon(
            groups
                    .where((g) => g.project)
                    .every(
                      (g) => desktop.threadList.data.overviewCollapsedProjects
                          .contains(g.id),
                    )
                ? 'Expand all'
                : 'Collapse all',
            DjlIcons.expand,
            _owned(() => _toggleAll(groups)),
            size: 15,
          ),
        ],
      ],
    ),
  );

  Widget _threadRows(
    List<RemoteJson> rows, {
    String? parent,
    int depth = 0,
    Set<String> ancestors = const {},
  }) {
    final ids = rows.map((r) => r['id']).toSet();
    final visible = rows.where(
      (row) => parent == null
          ? row['parentThreadId'] == null ||
                !ids.contains(row['parentThreadId'])
          : row['parentThreadId'] == parent,
    );
    return Column(
      children: [
        for (final thread in visible) ...[
          _threadRow(thread, rows, depth),
          if (_expandedChildren.contains(thread['id']) &&
              !ancestors.contains(thread['id']))
            _threadRows(
              rows,
              parent: thread['id'] as String,
              depth: depth + 1,
              ancestors: {...ancestors, thread['id'] as String},
            ),
        ],
      ],
    );
  }

  Widget _threadRow(RemoteJson thread, List<RemoteJson> rows, int depth) {
    final id = thread['id'] as String, title = desktop.titleOf(thread);
    final owner = _currentBinding;
    final children = rows.any((row) => row['parentThreadId'] == id);
    void toggleChildren() {
      if (_currentBinding != owner) return;
      setState(() {
        if (!_expandedChildren.remove(id)) _expandedChildren.add(id);
      });
    }

    return Padding(
      key: ValueKey('desktop.thread.$id'),
      padding: EdgeInsets.only(left: depth * 14.0, bottom: 4),
      child: Material(
        color: desktop.thread?['id'] == id
            ? Theme.of(context).colorScheme.surfaceContainerLow
            : Colors.transparent,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () {
            if (_currentBinding == owner) widget.onChat(thread);
          },
          child: Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Row(
              children: [
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    child: Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ),
                ),
                if (children)
                  Semantics(
                    container: true,
                    excludeSemantics: true,
                    button: true,
                    label: _expandedChildren.contains(id)
                        ? 'Collapse child chats for $title'
                        : 'Expand child chats for $title',
                    onTap: toggleChildren,
                    child: IconButton(
                      tooltip: _expandedChildren.contains(id)
                          ? 'Collapse child chats for $title'
                          : 'Expand child chats for $title',
                      iconSize: 12,
                      visualDensity: VisualDensity.compact,
                      icon: Icon(
                        _expandedChildren.contains(id)
                            ? DjlIcons.chevronDown
                            : DjlIcons.chevronRight,
                      ),
                      onPressed: toggleChildren,
                    ),
                  ),
                PopupMenuButton<String>(
                  tooltip: 'Desktop chat actions',
                  padding: EdgeInsets.zero,
                  icon: Icon(DjlIcons.more, size: 15, color: _secondary),
                  itemBuilder: (_) => desktopThreadActions(desktop, thread),
                  onSelected: (action) {
                    if (_currentBinding == owner) {
                      performDesktopThreadAction(
                        context,
                        desktop,
                        thread,
                        action,
                        isCurrent: () => mounted && _currentBinding == owner,
                      );
                    }
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Object get _projectActionOwner =>
      (_currentBinding, desktop.transport.connectionRevision);

  Future<void> _projectActions(
    BuildContext anchor,
    DesktopOverviewGroup group,
    Object owner,
  ) async {
    if (!mounted || !anchor.mounted || !group.project) return;
    final pageContext = context;
    bool current() =>
        mounted &&
        pageContext.mounted &&
        _projectActionOwner == owner &&
        ModalRoute.of(pageContext)?.isCurrent == true;
    if (!current()) return;
    final action = await showDesktopComposerMenu(
      context: anchor,
      allowBelow: true,
      items: [
        const PopupMenuItem(
          value: 'archive',
          child: DesktopThreadMenuLabel(
            title: 'Archive Project',
            icon: DjlIcons.archive,
          ),
        ),
        PopupMenuItem(
          value: 'remove',
          child: DefaultTextStyle.merge(
            style: TextStyle(color: DjlColors.of(anchor).danger),
            child: const DesktopThreadMenuLabel(
              title: 'Remove from Phone',
              icon: DjlIcons.delete,
            ),
          ),
        ),
      ],
    );
    if (action == null || !pageContext.mounted || !current()) return;
    final archive = action == 'archive';
    final title = archive ? 'Archive Project' : 'Remove from Phone';
    if (!pageContext.mounted) return;
    final review = archive
        ? showCupertinoModalPopup<bool>(
            context: pageContext,
            builder: (dialog) => Padding(
              padding: MediaQuery.viewInsetsOf(dialog),
              child: CupertinoActionSheet(
                title: Text('Archive "${group.label}"?'),
                message: const Text(
                  'All active chats in this project will be archived.',
                ),
                actions: [
                  CupertinoActionSheetAction(
                    onPressed: () => Navigator.pop(dialog, true),
                    child: Text(title),
                  ),
                ],
                cancelButton: CupertinoActionSheetAction(
                  onPressed: () => Navigator.pop(dialog, false),
                  child: const Text('Cancel'),
                ),
              ),
            ),
          )
        : showCupertinoDialog<bool>(
            context: pageContext,
            builder: (dialog) => CupertinoAlertDialog(
              title: Text('Remove "${group.label}" from this phone?'),
              content: const Text(
                'Chats for this project will be deleted only from DJL on this phone. Nothing is removed from your device or Codex observer.',
              ),
              actions: [
                CupertinoDialogAction(
                  onPressed: () => Navigator.pop(dialog, false),
                  child: const Text('Cancel'),
                ),
                CupertinoDialogAction(
                  isDestructiveAction: true,
                  onPressed: () => Navigator.pop(dialog, true),
                  child: Text(title),
                ),
              ],
            ),
          );
    final accepted = await review;
    if (accepted != true || !current()) return;
    final ids = desktopProjectThreadIds(
      desktop.threadList.data,
      group,
      liveOnly: archive,
    );
    final affected = archive
        ? await desktop.threadList.archiveGroup(ids)
        : await desktop.threadList.removeGroupLocally(ids);
    if (!current()) return;
    final selected = desktop.thread?['id'];
    if (selected is String && affected.contains(selected)) {
      desktop.closeThread(selected);
    }
  }

  Widget _group(DesktopOverviewGroup group) {
    final path = group.path, label = group.label;
    final owner = _projectActionOwner;
    final toggle = !group.project
        ? null
        : _owned(() => _toggleProject(group.id));
    final collapsed =
        group.project &&
        desktop.threadList.data.overviewCollapsedProjects.contains(group.id);
    return Padding(
      key: ValueKey('desktop.overview.group.${group.id}'),
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (group.project || group.pinned)
            Row(
              children: [
                Expanded(
                  child: Builder(
                    builder: (anchor) => Semantics(
                      container: true,
                      button: group.project,
                      excludeSemantics: true,
                      onTap: toggle,
                      onLongPress: group.project
                          ? () => _projectActions(anchor, group, owner)
                          : null,
                      label: !group.project
                          ? label
                          : collapsed
                          ? 'Expand project $label'
                          : 'Collapse project $label',
                      child: InkWell(
                        onTap: toggle,
                        onLongPress: group.project
                            ? () => _projectActions(anchor, group, owner)
                            : null,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 4,
                            vertical: 9,
                          ),
                          child: Row(
                            children: [
                              Icon(
                                group.pinned ? DjlIcons.pin : DjlIcons.folder,
                                size: 17,
                              ),
                              const SizedBox(width: 8),
                              Flexible(
                                child: Text(
                                  label,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context).textTheme.bodyMedium!
                                      .copyWith(fontWeight: FontWeight.w500),
                                ),
                              ),
                              if (group.project) ...[
                                const SizedBox(width: 6),
                                Icon(
                                  collapsed
                                      ? DjlIcons.chevronRight
                                      : DjlIcons.chevronDown,
                                  size: 12,
                                  color: _secondary,
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                if (group.project)
                  IconButton(
                    tooltip: 'New chat in $label',
                    iconSize: 18,
                    icon: const Icon(DjlIcons.compose),
                    onPressed: desktop.runtimeReady
                        ? _owned(
                            () => widget.onChat(
                              null,
                              cwd: path,
                              source: DesktopDraftSource.folderChat,
                            ),
                          )
                        : null,
                  ),
              ],
            ),
          if (!collapsed) _threadRows(group.threads),
        ],
      ),
    );
  }

  Widget _bottom() {
    final groupChats = _groupsScope ? widget.groups : null;
    if (groupChats != null) {
      final ready = groupChats.available;
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 6, 16, 4),
        child: Align(
          alignment: Alignment.centerRight,
          child: _button(
            label: 'New group',
            fill: ready
                ? _accent.$1
                : Theme.of(context).colorScheme.surfaceContainerHigh,
            onTap: ready ? () => GroupsList.create(context, groupChats) : null,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  DjlIcons.group,
                  size: 20,
                  color: ready ? _accent.$2 : _secondary,
                ),
                const SizedBox(width: 6),
                Text(
                  'Group',
                  style: Theme.of(context).textTheme.bodyMedium!.copyWith(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    height: 1.2,
                    letterSpacing: 0,
                    color: ready ? _accent.$2 : _secondary,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 4),
      child: Wrap(
        alignment: WrapAlignment.end,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 10,
        runSpacing: 8,
        children: [
          _button(
            label: 'New chat',
            fill: desktop.runtimeReady
                ? _accent.$1
                : Theme.of(context).colorScheme.surfaceContainerHigh,
            onTap: !desktop.runtimeReady
                ? null
                : _owned(() {
                    widget.onChat(
                      null,
                      cwd: _scope == DesktopOverviewScope.projects
                          ? _defaultProjectPath
                          : null,
                      source: DesktopDraftSource.generalChat,
                    );
                  }),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  DjlIcons.compose,
                  size: 20,
                  color: desktop.runtimeReady ? _accent.$2 : _secondary,
                ),
                const SizedBox(width: 6),
                Text(
                  'Chat',
                  style: Theme.of(context).textTheme.bodyMedium!.copyWith(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    height: 1.2,
                    letterSpacing: 0,
                    color: desktop.runtimeReady ? _accent.$2 : _secondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([desktop, widget.groups]),
    builder: (context, _) {
      final history =
          desktop.connected ||
          desktop.active != null &&
              desktop.threadList.data.snapshots.isNotEmpty;
      final groups = _groups(_scope);
      Future<void> refresh() async {
        if (!desktop.connected) return;
        await desktop.refreshThreads();
      }

      List<Widget> content(double height) => [
        if (widget.navigationNotice != null) widget.navigationNotice!,
        if (desktop.switchNotice != null &&
            ModalRoute.of(context)?.isCurrent == true)
          Text(desktop.switchNotice!),
        if (!history)
          ConstrainedBox(
            constraints: BoxConstraints(
              minHeight: (height - 24).clamp(0, double.infinity),
            ),
            child: Center(child: widget.emptyPanel),
          )
        else ...[
          widget.feedback,
          if (!desktop.connected)
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              children: [
                Text(
                  'Offline · showing saved chats',
                  style: TextStyle(color: _secondary),
                ),
                if (desktop.hasReconnectCandidate)
                  TextButton(
                    onPressed: desktop.busy ? null : desktop.reconnect,
                    child: const Text('Reconnect'),
                  ),
              ],
            ),
          if (desktop.threadList.localError != null)
            Text(desktop.threadList.localError!),
          if (desktop.threadList.syncWarning != null)
            Text(desktop.threadList.syncWarning!),
          if (desktop.threadList.showArchived) const Text('Archived chats'),
          if (desktop.threadList.loading) const LinearProgressIndicator(),
          if (groups.isEmpty && !desktop.threadList.loading)
            Text(
              _search.text.isNotEmpty
                  ? 'No matching chats.'
                  : _scope == DesktopOverviewScope.studio
                  ? 'No Studio threads'
                  : 'No project chats',
              style: TextStyle(fontSize: 13, color: _secondary),
            ),
          for (final group in groups) _group(group),
        ],
      ];
      final titleLineHeight =
          Theme.of(context).textTheme.bodyMedium?.height ?? 1.4;
      final toolbarHeight =
          16 +
          (MediaQuery.textScalerOf(context).scale(18) * titleLineHeight).clamp(
            40.0,
            double.infinity,
          );
      return Scaffold(
        appBar: PreferredSize(
          preferredSize: Size.fromHeight(toolbarHeight),
          child: AnnotatedRegion<SystemUiOverlayStyle>(
            value: Theme.of(context).brightness == Brightness.dark
                ? SystemUiOverlayStyle.light
                : SystemUiOverlayStyle.dark,
            child: SafeArea(bottom: false, child: _header()),
          ),
        ),
        body: SafeArea(
          top: false,
          child: LayoutBuilder(
            builder: (context, constraints) {
              final scale = (MediaQuery.textScalerOf(context).scale(15) / 15)
                  .clamp(1.0, double.infinity);
              // Let all controls scroll when the keyboard or large type leaves
              // less room than the pinned chrome needs.
              final compact =
                  !_groupsScope && constraints.maxHeight < 260 * scale;
              final header = [
                _searchBar(),
                if (history)
                  _scopes(groups)
                else if (!desktop.connected &&
                    !_searchFocus.hasFocus &&
                    _search.text.trim().isEmpty)
                  _connectionStatus(),
              ];
              if (widget.switchOverlay != null) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(child: widget.switchOverlay!),
                    if (!compact) _bottom(),
                  ],
                );
              }
              return Stack(
                children: [
                  if (compact)
                    RefreshIndicator(
                      onRefresh: refresh,
                      child: ListView(
                        children: [
                          ...header,
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: content(0),
                            ),
                          ),
                          _bottom(),
                        ],
                      ),
                    )
                  else
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        ...header,
                        if (_groupsScope && widget.groups != null)
                          Expanded(
                            child: GroupsList(controller: widget.groups!),
                          )
                        else
                          Expanded(
                            child: LayoutBuilder(
                              builder: (context, body) => RefreshIndicator(
                                onRefresh: refresh,
                                child: ListView(
                                  padding: const EdgeInsets.fromLTRB(
                                    16,
                                    12,
                                    16,
                                    12,
                                  ),
                                  children: content(body.maxHeight),
                                ),
                              ),
                            ),
                          ),
                        _bottom(),
                      ],
                    ),
                ],
              );
            },
          ),
        ),
      );
    },
  );
}
