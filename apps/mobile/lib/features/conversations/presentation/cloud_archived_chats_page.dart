import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../../../core/presentation/cloud_chrome.dart';
import '../../chat/data/cloud_repository.dart';
import '../../chat/domain/cloud_models.dart';
import '../../settings/presentation/settings_group.dart';

import '../../../core/design/djl_icons.dart';
import '../../../l10n/l10n.dart';

class CloudArchivedChatsPage extends StatefulWidget {
  const CloudArchivedChatsPage({
    super.key,
    required this.repository,
    required this.onRestored,
  });
  final CloudRepository repository;
  final VoidCallback onRestored;
  @override
  State<CloudArchivedChatsPage> createState() => _CloudArchivedChatsPageState();
}

class _CloudArchivedChatsPageState extends State<CloudArchivedChatsPage> {
  final List<Conversation> _items = [];
  late final int _revision;
  String? _cursor, _error, _restoring;
  bool _loading = false;
  bool get _current =>
      mounted && widget.repository.client.revision == _revision;
  @override
  void initState() {
    super.initState();
    _revision = widget.repository.client.revision;
    unawaited(_load());
  }

  Future<void> _load({bool more = false}) async {
    if (!_current ||
        _loading ||
        _restoring != null ||
        more && _cursor == null) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await widget.repository.list(
        archived: true,
        cursor: more ? _cursor : null,
      );
      if (!_current) return;
      final rows = (page['conversations'] as List)
          .map((value) => Conversation.fromJson(value as Json))
          .toList();
      setState(() {
        if (!more) _items.clear();
        for (final row in rows) {
          if (!_items.any((old) => old.id == row.id)) _items.add(row);
        }
        _cursor = page['nextCursor'] as String?;
      });
    } catch (error) {
      if (_current) setState(() => _error = error.toString());
    } finally {
      if (_current) setState(() => _loading = false);
    }
  }

  Future<void> _restore(Conversation item) async {
    if (!_current || _loading || _restoring != null) return;
    setState(() {
      _restoring = item.id;
      _error = null;
    });
    try {
      await widget.repository.update(item.id, {'archived': false});
      if (!_current) return;
      setState(() => _items.removeWhere((row) => row.id == item.id));
      widget.onRestored();
    } catch (error) {
      if (_current) setState(() => _error = error.toString());
    } finally {
      if (_current) setState(() => _restoring = null);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: cloudGroupedBackground(context),
    body: CustomScrollView(
      slivers: [
        CloudLargeNavigationBar(
          title: context.l10n.conversationsArchivedChats,
          leading: CloudNavigationButton(
            icon: DjlIcons.back,
            label: context.l10n.coreBack,
            onPressed: () => Navigator.maybePop(context),
          ),
        ),
        if (_items.isNotEmpty)
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            sliver: SliverToBoxAdapter(
              child: SettingsGroup(
                children: [
                  for (final item in _items)
                    Semantics(
                      key: ValueKey('cloud.archived.${item.id}'),
                      container: true,
                      explicitChildNodes: true,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 4,
                        ),
                        child: LayoutBuilder(
                          builder: (context, constraints) {
                            final style = cloudBodyStyle.copyWith(
                              fontWeight: FontWeight.w400,
                              fontFamily: DefaultTextStyle.of(
                                context,
                              ).style.fontFamily,
                            );
                            final measure = TextPainter(
                              text: TextSpan(
                                text: context.l10n.conversationsRestore,
                                style: style,
                              ),
                              textDirection: Directionality.of(context),
                              textScaler: MediaQuery.textScalerOf(context),
                            )..layout();
                            final buttonWidth = (measure.width + 2).clamp(
                              44.0,
                              constraints.maxWidth,
                            );
                            measure.dispose();
                            final title = Semantics(
                              container: true,
                              child: Text(
                                item.displayTitle,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: cloudBodyStyle,
                              ),
                            );
                            final button = SizedBox(
                              width: buttonWidth,
                              child: TextButton(
                                key: ValueKey(
                                  'cloud.archived.restore.${item.id}',
                                ),
                                style: TextButton.styleFrom(
                                  foregroundColor: cloudActionColor(context),
                                  textStyle: style,
                                  padding: EdgeInsets.zero,
                                  minimumSize: const Size(0, 44),
                                  tapTargetSize:
                                      MaterialTapTargetSize.shrinkWrap,
                                ),
                                onPressed: _loading || _restoring != null
                                    ? null
                                    : () => _restore(item),
                                child: _restoring == item.id
                                    ? const CupertinoActivityIndicator()
                                    : Text(context.l10n.conversationsRestore),
                              ),
                            );
                            return constraints.maxWidth - buttonWidth - 16 >= 72
                                ? Row(
                                    children: [
                                      Expanded(child: title),
                                      const SizedBox(width: 16),
                                      button,
                                    ],
                                  )
                                : Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      title,
                                      const SizedBox(height: 4),
                                      Align(
                                        alignment:
                                            AlignmentDirectional.centerEnd,
                                        child: button,
                                      ),
                                    ],
                                  );
                          },
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        if (_loading)
          const SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.all(20),
              child: Center(child: CupertinoActivityIndicator()),
            ),
          ),
        if (!_loading && _cursor != null)
          SliverToBoxAdapter(
            child: TextButton(
              onPressed: _restoring == null ? () => _load(more: true) : null,
              child: Text(context.l10n.conversationsLoadMore),
            ),
          ),
        if (_error != null)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  TextButton(
                    onPressed: _loading || _restoring != null ? null : _load,
                    child: Text(context.l10n.cloudChatRetry),
                  ),
                ],
              ),
            ),
          ),
        if (_items.isEmpty && !_loading && _error == null)
          SliverFillRemaining(
            hasScrollBody: false,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  DjlIcons.archive,
                  size: 48,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                const SizedBox(height: 14),
                Text(
                  context.l10n.conversationsNoArchivedChats,
                  style: const TextStyle(
                    fontSize: 22,
                    height: 1.2,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        const SliverToBoxAdapter(
          child: SafeArea(top: false, child: SizedBox.shrink()),
        ),
      ],
    ),
  );
}
