import 'package:flutter/cupertino.dart'
    show CupertinoIcons, CupertinoColors, CupertinoDynamicColor;
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../pairing/data/pairing_repository.dart';
import '../../settings/domain/runtime_defaults.dart';
import 'desktop_controller.dart';
import 'desktop_runtime_labels.dart';

class DesktopModelCatalogSheet extends StatefulWidget {
  const DesktopModelCatalogSheet({
    super.key,
    required this.controller,
    required this.isCurrent,
  });
  final DesktopController controller;
  final bool Function() isCurrent;
  @override
  State<DesktopModelCatalogSheet> createState() =>
      _DesktopModelCatalogSheetState();
}

class _DesktopModelCatalogSheetState extends State<DesktopModelCatalogSheet> {
  final _search = TextEditingController();
  final _focus = FocusNode();
  final _extent = DraggableScrollableController();
  String? _provider, _error;
  bool get _current =>
      mounted &&
      widget.isCurrent() &&
      ModalRoute.of(context)?.isCurrent == true;

  @override
  void initState() {
    super.initState();
    _focus.addListener(_expandSearch);
  }

  void _expandSearch() {
    if (_focus.hasFocus && _extent.isAttached) {
      _extent.animateTo(
        .95,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  void dispose() {
    _focus.removeListener(_expandSearch);
    _search.dispose();
    _focus.dispose();
    _extent.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    if (!_current || widget.controller.isLoadingModels) return;
    setState(() => _error = null);
    try {
      await widget.controller.refreshModels();
    } catch (e) {
      if (_current) setState(() => _error = e.toString());
    }
  }

  void _choose(String id) {
    if (_current &&
        !widget.controller.isLoadingModels &&
        widget.controller.models.any((m) => m['id'] == id)) {
      Navigator.pop(context, id);
    }
  }

  Widget _chip(String label, String? provider) {
    final selected = _provider == provider;
    final colors = Theme.of(context).colorScheme;
    return MergeSemantics(
      child: Semantics(
        selected: selected,
        child: TextButton(
          key: ValueKey('runtime.provider.${provider ?? 'all'}'),
          onPressed: () {
            if (_current) setState(() => _provider = provider);
          },
          style: TextButton.styleFrom(
            foregroundColor: selected ? Colors.white : colors.onSurface,
            backgroundColor: selected
                ? CupertinoDynamicColor.resolve(
                    CupertinoColors.activeBlue,
                    context,
                  )
                : colors.onSurface.withValues(alpha: .05),
            textStyle: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
            minimumSize: Size.zero,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            shape: const StadiumBorder(),
          ),
          child: Text(label),
        ),
      ),
    );
  }

  Widget _row(RemoteJson model) {
    final selected = model['id'] == widget.controller.model;
    final colors = Theme.of(context).colorScheme;
    final description = model['description'] as String? ?? '';
    return MergeSemantics(
      child: Semantics(
        selected: selected,
        child: TextButton(
          key: ValueKey('runtime.model.${model['id']}'),
          onPressed: () => _choose(model['id'] as String),
          style: TextButton.styleFrom(
            foregroundColor: colors.onSurface,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            minimumSize: Size.zero,
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            shape: const RoundedRectangleBorder(),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Icon(
                  selected
                      ? CupertinoIcons.check_mark_circled_solid
                      : CupertinoIcons.circle,
                  size: 18,
                  color: selected
                      ? CupertinoDynamicColor.resolve(
                          CupertinoColors.activeBlue,
                          context,
                        )
                      : colors.onSurface.withValues(alpha: .25),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            desktopModelTitle(model),
                            style: const TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w500,
                              height: 1.2,
                            ),
                          ),
                        ),
                        if (modelSupportsFast(model)) ...[
                          const SizedBox(width: 6),
                          SvgPicture.asset(
                            'assets/icons/runtime/zap.svg',
                            width: 16,
                            height: 16,
                            excludeFromSemantics: true,
                            colorFilter: ColorFilter.mode(
                              colors.onSurfaceVariant,
                              BlendMode.srcIn,
                            ),
                          ),
                        ],
                      ],
                    ),
                    if (description.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        description,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w400,
                          height: 1.2,
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
      child: DraggableScrollableSheet(
        controller: _extent,
        expand: false,
        initialChildSize:
            media.textScaler.scale(17) > 30 || media.viewInsets.bottom > 0
            ? .95
            : .55,
        minChildSize: .35,
        maxChildSize: .95,
        snap: true,
        snapSizes: const [.55, .95],
        builder: (context, scroll) => DjlGlassSurface(
          radius: 44,
          useNativeView: false,
          child: Material(
            color: Theme.of(context).brightness == Brightness.light
                ? Colors.white.withValues(alpha: .6)
                : Colors.transparent,
            shape: const RoundedRectangleBorder(
              borderRadius: BorderRadius.all(Radius.circular(44)),
            ),
            clipBehavior: Clip.antiAlias,
            child: SafeArea(
              top: false,
              child: ListenableBuilder(
                listenable: widget.controller,
                builder: (context, _) {
                  final desktop = widget.controller,
                      colors = Theme.of(context).colorScheme;
                  final models = orderedDesktopModels(desktop.models);
                  final providers =
                      models
                          .map((m) => desktopModelProvider(m) ?? 'Models')
                          .toSet()
                          .toList()
                        ..sort();
                  final query = _search.text.trim().toLowerCase();
                  final visible = models
                      .where(
                        (m) =>
                            (_provider == null ||
                                (desktopModelProvider(m) ?? 'Models') ==
                                    _provider) &&
                            (query.isEmpty ||
                                '${m['displayName'] ?? m['display_name'] ?? ''} ${desktopModelProvider(m) ?? ''} ${m['model'] ?? ''}'
                                    .toLowerCase()
                                    .contains(query)),
                      )
                      .toList();
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 5, bottom: 8),
                        child: Center(
                          child: Container(
                            width: 35,
                            height: 5,
                            decoration: BoxDecoration(
                              color: colors.onSurface.withValues(alpha: .25),
                              borderRadius: BorderRadius.circular(3),
                            ),
                          ),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Row(
                          children: [
                            DjlGlassSurface(
                              radius: 22,
                              useNativeView: false,
                              child: IconButton(
                                tooltip: 'Refresh models',
                                onPressed:
                                    _current &&
                                        desktop.connected &&
                                        !desktop.isLoadingModels
                                    ? _refresh
                                    : null,
                                icon: desktop.isLoadingModels
                                    ? const SizedBox.square(
                                        dimension: 20,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                        ),
                                      )
                                    : const Icon(
                                        CupertinoIcons.refresh,
                                        size: 28,
                                      ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            const Expanded(
                              child: Text(
                                'Provider & model',
                                textAlign: TextAlign.center,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            DjlGlassSurface(
                              radius: 24,
                              useNativeView: false,
                              child: TextButton(
                                onPressed: () {
                                  if (mounted &&
                                      ModalRoute.of(context)?.isCurrent ==
                                          true) {
                                    Navigator.pop(context);
                                  }
                                },
                                style: TextButton.styleFrom(
                                  foregroundColor: colors.onSurface,
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 18,
                                    vertical: 12,
                                  ),
                                  textStyle: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w400,
                                  ),
                                ),
                                child: const Text('Done'),
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (widget.isCurrent()) ...[
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 20,
                            vertical: 10,
                          ),
                          child: Row(
                            spacing: 8,
                            children: [
                              _chip('All providers', null),
                              for (final name in providers) _chip(name, name),
                            ],
                          ),
                        ),
                        if (_error != null)
                          Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 20,
                              vertical: 4,
                            ),
                            child: Text(
                              _error!,
                              style: TextStyle(color: colors.error),
                            ),
                          ),
                      ],
                      Expanded(
                        child: RefreshIndicator(
                          onRefresh: _refresh,
                          child: ListView(
                            key: const Key('runtime.catalog.list'),
                            controller: scroll,
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: const EdgeInsets.fromLTRB(24, 8, 24, 16),
                            children: [
                              if (!widget.isCurrent())
                                const Padding(
                                  padding: EdgeInsets.all(24),
                                  child: Text(
                                    'Connection changed. Reopen model selection.',
                                  ),
                                )
                              else if (desktop.isLoadingModels)
                                const Padding(
                                  padding: EdgeInsets.all(40),
                                  child: Center(
                                    child: CircularProgressIndicator(
                                      semanticsLabel: 'Loading models',
                                    ),
                                  ),
                                )
                              else if (models.isEmpty)
                                Padding(
                                  padding: const EdgeInsets.all(20),
                                  child: Column(
                                    children: [
                                      SvgPicture.asset(
                                        'assets/icons/runtime/layers-behind.svg',
                                        width: 48,
                                        height: 48,
                                        excludeFromSemantics: true,
                                        colorFilter: ColorFilter.mode(
                                          colors.onSurfaceVariant,
                                          BlendMode.srcIn,
                                        ),
                                      ),
                                      const SizedBox(height: 12),
                                      const Text(
                                        'No models available',
                                        textAlign: TextAlign.center,
                                      ),
                                      const SizedBox(height: 8),
                                      const Text(
                                        'Connect a provider in DJL on your computer, then refresh the model list.',
                                        textAlign: TextAlign.center,
                                      ),
                                    ],
                                  ),
                                )
                              else if (visible.isEmpty)
                                const Padding(
                                  padding: EdgeInsets.all(24),
                                  child: Text(
                                    'No matching models',
                                    textAlign: TextAlign.center,
                                  ),
                                )
                              else
                                for (final provider in providers) ...[
                                  if (visible.any(
                                    (m) =>
                                        (desktopModelProvider(m) ?? 'Models') ==
                                        provider,
                                  )) ...[
                                    Padding(
                                      padding: const EdgeInsets.fromLTRB(
                                        16,
                                        6,
                                        16,
                                        8,
                                      ),
                                      child: Text(
                                        provider,
                                        style: TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.w600,
                                          color: colors.onSurfaceVariant,
                                        ),
                                      ),
                                    ),
                                    ClipRRect(
                                      borderRadius: BorderRadius.circular(26),
                                      child: ColoredBox(
                                        color: colors.onSurface.withValues(
                                          alpha: .06,
                                        ),
                                        child: Column(
                                          children: [
                                            for (final (index, model)
                                                in visible
                                                    .where(
                                                      (m) =>
                                                          (desktopModelProvider(
                                                                m,
                                                              ) ??
                                                              'Models') ==
                                                          provider,
                                                    )
                                                    .indexed) ...[
                                              if (index > 0)
                                                Padding(
                                                  padding:
                                                      const EdgeInsets.only(
                                                        left: 46,
                                                        right: 16,
                                                      ),
                                                  child: Divider(
                                                    height: 1,
                                                    color: colors.onSurface
                                                        .withValues(alpha: .12),
                                                  ),
                                                ),
                                              _row(model),
                                            ],
                                          ],
                                        ),
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                  ],
                                ],
                            ],
                          ),
                        ),
                      ),
                      if (widget.isCurrent())
                        Padding(
                          padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
                          child: DjlGlassSurface(
                            radius: 28,
                            useNativeView: false,
                            child: TextField(
                              key: const Key('runtime.catalog.search'),
                              controller: _search,
                              focusNode: _focus,
                              autocorrect: false,
                              textCapitalization: TextCapitalization.none,
                              textInputAction: TextInputAction.search,
                              style: const TextStyle(fontSize: 17),
                              onChanged: (_) {
                                if (_current) setState(() {});
                              },
                              onSubmitted: (_) {
                                if (_current) _focus.unfocus();
                              },
                              decoration: InputDecoration(
                                hintText: 'Search providers or models',
                                prefixIcon: const Icon(
                                  CupertinoIcons.search,
                                  size: 24,
                                ),
                                suffixIcon: _search.text.isEmpty
                                    ? null
                                    : IconButton(
                                        tooltip: 'Clear model search',
                                        onPressed: () {
                                          if (_current) setState(_search.clear);
                                        },
                                        icon: const Icon(
                                          CupertinoIcons.clear_circled_solid,
                                          size: 18,
                                        ),
                                      ),
                                filled: false,
                                border: InputBorder.none,
                                enabledBorder: InputBorder.none,
                                focusedBorder: InputBorder.none,
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 16,
                                  vertical: 14,
                                ),
                              ),
                            ),
                          ),
                        ),
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}
