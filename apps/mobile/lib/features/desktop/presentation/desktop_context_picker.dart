import 'dart:async';
import 'package:flutter/material.dart';
import '../../pairing/data/pairing_repository.dart';
import '../data/desktop_composer_repository.dart';
import '../data/remote_transport.dart';
import '../domain/desktop_composer.dart';

class DesktopContextPicker extends StatefulWidget {
  const DesktopContextPicker({
    super.key,
    required this.repository,
    required this.isCurrent,
    this.scopeChanges,
  });
  final DesktopComposerRepository repository;
  final bool Function() isCurrent;
  final Listenable? scopeChanges;
  @override
  State<DesktopContextPicker> createState() => _DesktopContextPickerState();
}

class _DesktopContextPickerState extends State<DesktopContextPicker> {
  DesktopContextKind _kind = DesktopContextKind.skill;
  final _query = TextEditingController();
  List<RemoteJson> _items = [];
  String? _error;
  bool _loading = false, _stale = false;
  int _generation = 0;
  Timer? _debounce;
  String get _label => switch (_kind) {
    DesktopContextKind.skill => 'Skills',
    DesktopContextKind.plugin => 'Plugins',
    DesktopContextKind.file => 'Files',
  };
  @override
  void initState() {
    super.initState();
    widget.scopeChanges?.addListener(_scopeChanged);
    unawaited(_load());
  }

  void _scopeChanged() {
    if (!widget.isCurrent() && mounted) {
      _generation++;
      _debounce?.cancel();
      setState(() {
        _stale = true;
        _loading = false;
        _items = [];
      });
    }
  }

  Future<void> _load() async {
    final generation = ++_generation;
    if (!widget.isCurrent() || _stale) {
      _scopeChanged();
      return;
    }
    final query = _query.text.trim();
    if (_kind == DesktopContextKind.file &&
        (query.isEmpty || widget.repository.cwd?.trim().isNotEmpty != true)) {
      setState(() {
        _items = [];
        _loading = false;
        _error = null;
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _items = [];
    });
    try {
      final items = await switch (_kind) {
        DesktopContextKind.skill => widget.repository.skills(),
        DesktopContextKind.plugin => widget.repository.plugins(),
        DesktopContextKind.file => widget.repository.files(
          query,
          cancellationToken: 'mobile-context-$generation',
        ),
      };
      if (!mounted || generation != _generation || !widget.isCurrent()) return;
      setState(() {
        _items = items;
      });
    } catch (e) {
      if (!mounted || generation != _generation || !widget.isCurrent()) return;
      setState(() {
        _error = e is RemoteRpcException && e.code == -32601
            ? '$_label are not supported by this desktop runtime.'
            : e.toString();
      });
    } finally {
      if (mounted && generation == _generation) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  void _search(String value) {
    _debounce?.cancel();
    if (_kind != DesktopContextKind.file) {
      setState(() {});
      return;
    }
    // Invalidate existing work immediately, including before the debounce fires.
    _generation++;
    setState(() {
      _items = [];
      _loading = value.trim().isNotEmpty;
      _error = null;
    });
    _debounce = Timer(
      const Duration(milliseconds: 180),
      () => unawaited(_load()),
    );
  }

  bool _allowedFile(RemoteJson item) {
    final path = item['path'];
    final root = (item['root'] as String? ?? widget.repository.cwd)
        ?.replaceFirst(RegExp(r'/+$'), '');
    final cwd = widget.repository.cwd?.trim().replaceFirst(RegExp(r'/+$'), '');
    return path is String &&
        path.trim().isNotEmpty &&
        !path.startsWith('/') &&
        !path.split('/').contains('..') &&
        root == cwd;
  }

  void _select(RemoteJson item) {
    if (_stale || !widget.isCurrent()) return;
    final name =
        (item['name'] as String? ??
                item['file_name'] as String? ??
                item['path'] as String? ??
                '')
            .trim();
    final path = item['path'] as String?;
    if (name.isEmpty ||
        _kind == DesktopContextKind.skill && item['enabled'] == false ||
        _kind == DesktopContextKind.file && !_allowedFile(item)) {
      return;
    }
    Navigator.pop(
      context,
      DesktopComposerContext(
        kind: _kind,
        id: _kind == DesktopContextKind.skill ? name : path!,
        name: name,
        path: path,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final query = _query.text.trim().toLowerCase();
    final items = _items
        .where(
          (item) =>
              (_kind != DesktopContextKind.file || _allowedFile(item)) &&
              (_kind == DesktopContextKind.file ||
                  query.isEmpty ||
                  [item['name'], item['displayName'], item['description']]
                      .whereType<String>()
                      .join(' ')
                      .toLowerCase()
                      .contains(query)),
        )
        .toList();
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    final available = (MediaQuery.sizeOf(context).height - inset).clamp(
      0.0,
      double.infinity,
    );
    final Widget? status = _stale
        ? const Text('The conversation changed. Reopen the context picker.')
        : _loading
        ? const CircularProgressIndicator()
        : _error != null
        ? Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!),
              TextButton(
                onPressed: _load,
                child: const Text('Retry discovery'),
              ),
            ],
          )
        : items.isEmpty
        ? Text(
            _kind == DesktopContextKind.file && query.isEmpty
                ? widget.repository.cwd?.trim().isNotEmpty == true
                      ? 'Search files in ${widget.repository.cwd}'
                      : 'Select a project folder to search desktop files.'
                : 'No ${_label.toLowerCase()} found.',
          )
        : null;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: inset),
        child: SizedBox(
          height: available * .72,
          child: CustomScrollView(
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.all(16),
                sliver: SliverToBoxAdapter(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Add desktop context',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 12),
                      SegmentedButton<DesktopContextKind>(
                        segments: const [
                          ButtonSegment(
                            value: DesktopContextKind.skill,
                            label: Text('Skills'),
                          ),
                          ButtonSegment(
                            value: DesktopContextKind.plugin,
                            label: Text('Plugins'),
                          ),
                          ButtonSegment(
                            value: DesktopContextKind.file,
                            label: Text('Files'),
                          ),
                        ],
                        selected: {_kind},
                        onSelectionChanged: _stale
                            ? null
                            : (value) {
                                _debounce?.cancel();
                                _kind = value.single;
                                _query.clear();
                                unawaited(_load());
                              },
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        key: const Key('desktop_context_search'),
                        controller: _query,
                        enabled: !_stale,
                        onChanged: _search,
                        decoration: InputDecoration(
                          prefixIcon: const Icon(Icons.search),
                          hintText: _kind == DesktopContextKind.file
                              ? 'Search files on your desktop'
                              : 'Search ${_label.toLowerCase()}',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (status != null)
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Center(child: status),
                  ),
                )
              else
                SliverList.builder(
                  itemCount: items.length,
                  itemBuilder: (context, index) {
                    final item = items[index],
                        disabled =
                            _kind == DesktopContextKind.skill &&
                            items[index]['enabled'] == false;
                    final title =
                        (_kind == DesktopContextKind.file
                                ? item['path']
                                : item['displayName'] ?? item['name'])
                            as String;
                    return ListTile(
                      enabled: !disabled,
                      title: Text(title),
                      subtitle: Text(
                        disabled
                            ? 'Disabled on desktop'
                            : (_kind == DesktopContextKind.file
                                      ? 'On paired desktop'
                                      : item['description'] ??
                                            item['path'] ??
                                            '')
                                  .toString(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      onTap: disabled ? null : () => _select(item),
                    );
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _generation++;
    _debounce?.cancel();
    widget.scopeChanges?.removeListener(_scopeChanged);
    _query.dispose();
    super.dispose();
  }
}
