import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../desktop/domain/desktop_overview.dart';
import '../data/workspace_repository.dart';
import 'project_controller.dart';

Future<String?> showProjectPicker(
  BuildContext context, {
  required ProjectRepository repository,
  String? initialPath,
}) => showModalBottomSheet<String>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  showDragHandle: true,
  clipBehavior: Clip.antiAlias,
  backgroundColor: CupertinoColors.systemGroupedBackground.resolveFrom(context),
  builder: (_) => FractionallySizedBox(
    heightFactor: .96,
    child: ProjectPickerPage(repository: repository, initialPath: initialPath),
  ),
);

class ProjectPickerPage extends StatefulWidget {
  const ProjectPickerPage({
    super.key,
    required this.repository,
    this.initialPath,
  });
  final ProjectRepository repository;
  final String? initialPath;
  @override
  State<ProjectPickerPage> createState() => _ProjectPickerPageState();
}

class _ProjectPickerPageState extends State<ProjectPickerPage> {
  late final ProjectController _controller;
  final _search = TextEditingController();
  Timer? _searchTimer;
  String? _searchRoot;
  bool _pendingSearch = false;

  bool get _current => mounted && ModalRoute.of(context)?.isCurrent == true;

  @override
  void initState() {
    super.initState();
    _controller = ProjectController(widget.repository)
      ..addListener(_rootChanged);
    unawaited(_controller.initialize(widget.initialPath));
  }

  void _rootChanged() {
    final path = _controller.listing?.path;
    if (path == _searchRoot) return;
    _searchRoot = path;
    if (path != null && _search.text.trim().isNotEmpty) {
      _searchChanged(_search.text);
    }
  }

  void _searchChanged(String value) {
    _searchTimer?.cancel();
    final query = value.trim();
    setState(
      () => _pendingSearch = query.isNotEmpty && _controller.listing != null,
    );
    if (query.isEmpty) {
      unawaited(_controller.search(''));
    } else if (_controller.listing != null) {
      _searchTimer = Timer(const Duration(milliseconds: 250), () {
        if (!mounted || ModalRoute.of(context)?.isActive != true) return;
        unawaited(_controller.search(query));
        setState(() => _pendingSearch = false);
      });
    }
  }

  void _browse(String path) {
    _searchTimer?.cancel();
    _pendingSearch = false;
    _search.clear();
    unawaited(_controller.browse(path));
  }

  Future<void> _create() async {
    if (!_current) return;
    final name = await showCupertinoDialog<String>(
      context: context,
      builder: (_) => const _NewFolderDialog(),
    );
    if (!_current || name == null || name.trim().isEmpty) return;
    final path = await _controller.create(name);
    if (path != null && mounted && ModalRoute.of(context)?.isCurrent == true) {
      Navigator.pop(context, path);
    }
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    _controller.removeListener(_rootChanged);
    _controller.dispose();
    _search.dispose();
    super.dispose();
  }

  Widget _icon(String asset, {Color? color}) => SvgPicture.asset(
    'assets/icons/command/$asset.svg',
    width: 22,
    height: 22,
    colorFilter: ColorFilter.mode(
      color ?? Theme.of(context).colorScheme.onSurfaceVariant,
      BlendMode.srcIn,
    ),
  );

  Widget _row(
    String title,
    String subtitle,
    Widget icon, {
    VoidCallback? onTap,
  }) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          icon,
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    fontSize: 17,
                    height: 1.2,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    fontSize: 13,
                    height: 1.2,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
    return onTap == null
        ? Semantics(container: true, child: row)
        : CupertinoButton(
            padding: EdgeInsets.zero,
            onPressed: onTap,
            child: row,
          );
  }

  Widget _message(String value, {bool error = false}) => Semantics(
    container: true,
    child: SizedBox(
      width: double.infinity,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          value,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            fontSize: 17,
            height: 1.2,
            color: error
                ? Theme.of(context).colorScheme.error
                : Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ),
    ),
  );

  Widget _section(String? title, List<Widget> rows) => Padding(
    padding: const EdgeInsets.only(bottom: 18),
    child: CupertinoListSection.insetGrouped(
      margin: EdgeInsets.zero,
      backgroundColor: Colors.transparent,
      decoration: BoxDecoration(
        color: CupertinoColors.secondarySystemGroupedBackground.resolveFrom(
          context,
        ),
        borderRadius: BorderRadius.circular(26),
      ),
      clipBehavior: Clip.antiAlias,
      dividerMargin: 16,
      additionalDividerMargin: 34,
      header: title == null
          ? null
          : Semantics(
              container: true,
              header: true,
              child: Text(
                title,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  fontSize: 13,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ),
      children: rows,
    ),
  );

  Widget get _title => Semantics(
    header: true,
    child: Text(
      'Add Local Folder',
      textAlign: TextAlign.center,
      style: Theme.of(context).textTheme.titleMedium?.copyWith(
        fontSize: 17,
        fontWeight: FontWeight.w600,
      ),
    ),
  );

  Widget _header(bool canUse) {
    final c = _controller;
    final close = DjlGlassSurface(
      radius: 999,
      child: TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Close'),
      ),
    );
    final actions = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        DjlGlassSurface(
          radius: 999,
          child: IconButton(
            tooltip: 'Create folder on Mac',
            onPressed: canUse ? _create : null,
            icon: c.creating
                ? const CupertinoActivityIndicator()
                : _icon(
                    'central-folder-add-right',
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
          ),
        ),
        const SizedBox(width: 6),
        DjlGlassSurface(
          radius: 999,
          child: TextButton(
            onPressed: canUse
                ? () => Navigator.pop(context, c.listing!.path)
                : null,
            child: const Text('Use'),
          ),
        ),
      ],
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
      child: MediaQuery.textScalerOf(context).scale(17) > 25
          ? Row(children: [close, const Spacer(), actions])
          : Row(
              children: [
                close,
                const SizedBox(width: 6),
                Expanded(child: _title),
                const SizedBox(width: 6),
                actions,
              ],
            ),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _controller,
    builder: (context, _) {
      final c = _controller, listing = c.listing;
      final matching = _search.text.trim().isNotEmpty;
      final busy = c.loading || _pendingSearch;
      final canUse = listing != null && !busy && !c.creating;
      final entries = matching ? c.matches ?? [] : listing?.entries ?? [];
      final rows = <Widget>[
        if (!matching && listing?.parentPath != null)
          _row(
            'Parent Folder',
            listing!.parentPath!,
            const Icon(CupertinoIcons.arrow_uturn_left, size: 22),
            onTap: busy || c.creating
                ? null
                : () => _browse(listing.parentPath!),
          ),
        if (busy)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                const CupertinoActivityIndicator(),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(matching ? 'Searching folders...' : 'Loading'),
                ),
              ],
            ),
          )
        else if (matching && c.error != null)
          _message(c.error!, error: true)
        else if (entries.isEmpty)
          _message(
            matching
                ? 'No matching folders under this folder.'
                : 'No child folders here.',
          )
        else
          for (final entry in entries)
            _row(
              entry.name,
              entry.path,
              _icon(
                entry.isSymlink
                    ? 'central-folder-restricted'
                    : 'central-folder-2',
              ),
              onTap: c.creating ? null : () => _browse(entry.path),
            ),
      ];
      return Scaffold(
        backgroundColor: CupertinoColors.systemGroupedBackground.resolveFrom(
          context,
        ),
        body: SafeArea(
          child: Column(
            children: [
              _header(canUse),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  children: [
                    if (MediaQuery.textScalerOf(context).scale(17) > 25)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _title,
                      ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: CupertinoSearchTextField(
                        controller: _search,
                        placeholder: 'Search folders',
                        suffixIcon: const Icon(
                          CupertinoIcons.xmark_circle_fill,
                          semanticLabel: 'Clear folder search',
                        ),
                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                          fontSize: 17,
                          height: 1.2,
                        ),
                        onChanged: _searchChanged,
                      ),
                    ),
                    if (!matching && c.error != null)
                      _section(null, [_message(c.error!, error: true)]),
                    if (c.locations.isNotEmpty)
                      _section('Locations', [
                        for (final location in c.locations)
                          _row(
                            location.label,
                            location.path,
                            _icon('central-folder-2'),
                            onTap: c.loading || c.creating
                                ? null
                                : () => _browse(location.path),
                          ),
                      ]),
                    _section('Current Folder', [
                      if (listing != null)
                        _row(
                          desktopConversationPathLabel(listing.path),
                          listing.path,
                          _icon('central-folder-open-reversed'),
                        )
                      else
                        _message(
                          c.loading
                              ? 'Loading folders...'
                              : 'No folder selected.',
                        ),
                    ]),
                    _section(matching ? 'Matching Folders' : 'Folders', rows),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}

class _NewFolderDialog extends StatefulWidget {
  const _NewFolderDialog();
  @override
  State<_NewFolderDialog> createState() => _NewFolderDialogState();
}

class _NewFolderDialogState extends State<_NewFolderDialog> {
  final _name = TextEditingController();
  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => CupertinoAlertDialog(
    title: const Text('New Folder'),
    content: Column(
      children: [
        const Text('Create this folder on your device and start a chat there.'),
        const SizedBox(height: 12),
        CupertinoTextField(
          controller: _name,
          autofocus: true,
          placeholder: 'Folder name',
        ),
      ],
    ),
    actions: [
      CupertinoDialogAction(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      CupertinoDialogAction(
        isDefaultAction: true,
        onPressed: () => Navigator.pop(context, _name.text),
        child: const Text('Create'),
      ),
    ],
  );
}
