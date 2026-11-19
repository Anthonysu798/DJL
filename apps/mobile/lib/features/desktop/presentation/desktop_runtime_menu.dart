import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../settings/domain/runtime_defaults.dart';
import 'desktop_composer_options_menu.dart';
import 'desktop_controller.dart';
import 'desktop_model_catalog_sheet.dart';
import 'desktop_runtime_labels.dart';

typedef _RuntimeChoice = ({String kind, String value, String? model});

class DesktopRuntimeControl extends StatelessWidget {
  const DesktopRuntimeControl({
    super.key,
    required this.controller,
    required this.isCurrent,
  });
  final DesktopController controller;
  final bool Function() isCurrent;

  @override
  Widget build(BuildContext context) {
    final desktop = controller, selected = desktop.selectedModel;
    final title = selected == null
        ? desktop.model == null
              ? desktop.isLoadingModels
                    ? 'Loading…'
                    : 'Select model'
              : desktopModelName(desktop.model!)
        : desktopModelTitle(selected);
    final words = title
        .replaceAll(RegExp('[-_]'), ' ')
        .split(RegExp(r'\s+'))
        .where((word) => !{'gpt', 'codex'}.contains(word.toLowerCase()))
        .toList();
    final compact = words.isEmpty ? title : words.join(' ');
    final provider = selected == null ? null : desktopModelProvider(selected);
    final label = provider == null ? compact : '$provider · $compact';
    final effort = desktop.model == null || desktop.effort == null
        ? null
        : desktopReasoningTitle(desktop.effort!);
    final fast = desktop.supportsFastMode && desktop.serviceTier == 'fast';
    final colors = Theme.of(context).colorScheme;
    return Builder(
      builder: (anchorContext) {
        Future<void> open() async {
          if (!anchorContext.mounted || !isCurrent()) return;
          final owner = isCurrent,
              page = ModalRoute.of(anchorContext),
              navigator = Navigator.of(anchorContext);
          if (!owner() || page?.isCurrent != true) return;
          TransitionRoute<dynamic>? popup;
          final choice = await showDesktopComposerPopover<_RuntimeChoice>(
            context: anchorContext,
            alignment: DesktopComposerMenuAlignment.trailing,
            coverAnchor: true,
            builder: (menuContext) {
              popup = ModalRoute.of(menuContext) as TransitionRoute<dynamic>?;
              return _RuntimePopover(
                controller: desktop,
                isCurrent: () =>
                    owner() && anchorContext.mounted && page?.isActive == true,
              );
            },
          );
          if (choice == null ||
              !anchorContext.mounted ||
              !owner() ||
              page?.isCurrent != true) {
            return;
          }
          if (choice.kind == 'catalog') {
            // Remove the old popup before the searchable sheet takes focus.
            await popup?.completed;
            if (!navigator.mounted ||
                !anchorContext.mounted ||
                !owner() ||
                page?.isCurrent != true) {
              return;
            }
            final model = await showModalBottomSheet<String>(
              context: navigator.context,
              isScrollControlled: true,
              useSafeArea: true,
              backgroundColor: Colors.transparent,
              shape: const RoundedRectangleBorder(
                borderRadius: BorderRadius.vertical(top: Radius.circular(44)),
              ),
              clipBehavior: Clip.antiAlias,
              builder: (_) => DesktopModelCatalogSheet(
                controller: desktop,
                isCurrent: () => owner() && page?.isActive == true,
              ),
            );
            if (model != null &&
                owner() &&
                page?.isCurrent == true &&
                desktop.models.any((m) => m['id'] == model)) {
              desktop.setModel(model);
            }
            return;
          }
          if (choice.kind == 'model') {
            if (!desktop.isLoadingModels &&
                desktop.models.any((m) => m['id'] == choice.value)) {
              desktop.setModel(choice.value);
            }
          } else if (choice.model == desktop.model) {
            if (choice.kind == 'effort') desktop.setEffort(choice.value);
            if (choice.kind == 'speed') desktop.setServiceTier(choice.value);
          }
        }

        return Tooltip(
          message: 'Chat controls',
          child: Semantics(
            label: [?provider, title, ?effort, if (fast) 'Fast'].join(', '),
            button: true,
            onTap: open,
            excludeSemantics: true,
            child: TextButton(
              key: const Key('composer.runtime'),
              onPressed: open,
              style: TextButton.styleFrom(
                minimumSize: Size.zero,
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                foregroundColor: colors.onSurface,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (fast) ...[
                    SvgPicture.asset(
                      'assets/icons/runtime/zap.svg',
                      width: 16,
                      height: 16,
                      excludeFromSemantics: true,
                      colorFilter: ColorFilter.mode(
                        colors.onSurface,
                        BlendMode.srcIn,
                      ),
                    ),
                    const SizedBox(width: 6),
                  ],
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w400,
                        height: 1.125,
                      ),
                    ),
                  ),
                  if (effort != null && effort.isNotEmpty) ...[
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        effort,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w400,
                          height: 1.2,
                          color: colors.onSurface.withValues(alpha: .3),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _RuntimePopover extends StatefulWidget {
  const _RuntimePopover({required this.controller, required this.isCurrent});
  final DesktopController controller;
  final bool Function() isCurrent;
  @override
  State<_RuntimePopover> createState() => _RuntimePopoverState();
}

class _RuntimePopoverState extends State<_RuntimePopover> {
  String _branch = 'main';
  bool get _current =>
      mounted &&
      widget.isCurrent() &&
      ModalRoute.of(context)?.isCurrent == true;

  void _choose(String kind, String value, {String? model}) {
    if (!_current) return;
    final desktop = widget.controller;
    if (kind == 'model' &&
        (desktop.isLoadingModels ||
            !desktop.models.any((m) => m['id'] == value))) {
      return;
    }
    if ((kind == 'effort' || kind == 'speed') && model != desktop.model) return;
    if (kind == 'effort' && !desktop.reasoningEfforts.contains(value)) return;
    if (kind == 'speed' && value == 'fast' && !desktop.supportsFastMode) return;
    Navigator.pop(context, (kind: kind, value: value, model: model));
  }

  Widget _action({
    required String title,
    required VoidCallback onPressed,
    Key? key,
    bool selected = false,
    bool enabled = true,
    bool fast = false,
    bool other = false,
    String? icon,
  }) {
    final colors = Theme.of(context).colorScheme;
    return MergeSemantics(
      child: Semantics(
        selected: selected,
        child: TextButton(
          key: key,
          onPressed: enabled ? onPressed : null,
          style: TextButton.styleFrom(
            foregroundColor: colors.onSurface,
            minimumSize: const Size(0, 42),
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            shape: const RoundedRectangleBorder(),
            textStyle: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w400,
              height: 1.2,
            ),
          ),
          child: Row(
            children: [
              SizedBox(
                width: 15,
                child: Opacity(
                  opacity: selected ? 1 : 0,
                  child: const Icon(CupertinoIcons.check_mark, size: 15),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(child: Text(title)),
              if (icon != null) ...[
                const SizedBox(width: 8),
                SvgPicture.asset(
                  'assets/icons/runtime/$icon.svg',
                  width: 20,
                  height: 20,
                  excludeFromSemantics: true,
                  colorFilter: ColorFilter.mode(
                    colors.onSurface,
                    BlendMode.srcIn,
                  ),
                ),
              ],
              if (fast) ...[
                const SizedBox(width: 8),
                SvgPicture.asset(
                  'assets/icons/runtime/zap.svg',
                  width: 18,
                  height: 18,
                  excludeFromSemantics: true,
                  colorFilter: ColorFilter.mode(
                    colors.onSurface,
                    BlendMode.srcIn,
                  ),
                ),
              ],
              if (other) ...[
                const SizedBox(width: 8),
                const Icon(CupertinoIcons.ellipsis, size: 18),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _parent(
    String title,
    String value,
    String icon,
    String branch, {
    Key? key,
  }) {
    final colors = Theme.of(context).colorScheme;
    return TextButton(
      key: key,
      onPressed: () {
        if (_current) {
          setState(() => _branch = _branch == branch ? 'main' : branch);
        }
      },
      style: TextButton.styleFrom(
        foregroundColor: colors.onSurface,
        minimumSize: const Size(0, 60),
        padding: const EdgeInsets.fromLTRB(43, 10, 16, 10),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        shape: const RoundedRectangleBorder(),
      ),
      child: Row(
        children: [
          SvgPicture.asset(
            'assets/icons/runtime/$icon.svg',
            width: 22,
            height: 22,
            excludeFromSemantics: true,
            colorFilter: ColorFilter.mode(colors.onSurface, BlendMode.srcIn),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w400,
                    height: 1.2,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w400,
                    height: 1.2,
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Icon(
            _branch == branch
                ? CupertinoIcons.chevron_down
                : CupertinoIcons.chevron_forward,
            size: 14,
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final desktop = widget.controller, colors = Theme.of(context).colorScheme;
      final models = orderedDesktopModels(desktop.models);
      final selected = desktop.model;
      final title = desktop.selectedModel == null
          ? selected == null
                ? desktop.isLoadingModels
                      ? 'Loading…'
                      : 'Select model'
                : desktopModelName(selected)
          : desktopModelTitle(desktop.selectedModel!);
      final efforts = orderedDesktopEfforts(desktop.reasoningEfforts);
      final featured = models
          .where(
            (m) =>
                {
                  'gpt-5.5',
                  'gpt-5.4',
                }.contains('${m['model']}'.toLowerCase()) ||
                {'gpt-5.5', 'gpt-5.4'}.contains('${m['id']}'.toLowerCase()),
          )
          .toList();
      final current = models.where((m) => m['id'] == selected).firstOrNull;
      if (current != null && !featured.any((m) => m['id'] == selected)) {
        featured.add(current);
      }
      final others = models.any(
        (m) => !featured.any((f) => f['id'] == m['id']),
      );
      final providers = models.any((m) => m['djlProvider'] != null);
      final speed = desktop.serviceTier == 'fast' && desktop.supportsFastMode
          ? 'Fast'
          : 'Normal';
      return SizedBox(
        key: const Key('composer.runtime.popover'),
        width: 250,
        child: DjlGlassSurface(
          radius: 32,
          useNativeView: false,
          child: Material(
            type: MaterialType.transparency,
            child: Semantics(
              scopesRoute: true,
              namesRoute: true,
              explicitChildNodes: true,
              label: 'Chat controls',
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (!widget.isCurrent())
                      const Padding(
                        padding: EdgeInsets.all(20),
                        child: Text(
                          'Connection changed. Reopen chat controls.',
                        ),
                      )
                    else if (_branch == 'model') ...[
                      _parent(
                        'Model',
                        title,
                        '3d-box-top',
                        'model',
                        key: const Key('desktop_runtime_model'),
                      ),
                      const SizedBox(height: 20),
                      if (desktop.isLoadingModels)
                        _action(
                          title: 'Loading models…',
                          enabled: false,
                          onPressed: () {},
                        )
                      else ...[
                        if (models.isEmpty)
                          _action(
                            title: 'No models available',
                            enabled: false,
                            onPressed: () {},
                          ),
                        if (others || models.isEmpty)
                          _action(
                            title: 'Other models…',
                            key: const Key('runtime.other_models'),
                            other: true,
                            onPressed: () => _choose('catalog', ''),
                          ),
                        for (final model in featured.reversed)
                          _action(
                            title: desktopModelTitle(model),
                            key: ValueKey('runtime.model.${model['id']}'),
                            selected: model['id'] == selected,
                            fast: modelSupportsFast(model),
                            onPressed: () =>
                                _choose('model', model['id'] as String),
                          ),
                      ],
                    ] else if (_branch == 'speed' &&
                        desktop.supportsFastMode) ...[
                      _parent(
                        'Speed',
                        speed,
                        'zap',
                        'speed',
                        key: const Key('runtime.speed'),
                      ),
                      const SizedBox(height: 20),
                      _action(
                        title: 'Fast',
                        key: const Key('runtime.speed.fast'),
                        selected: speed == 'Fast',
                        fast: true,
                        onPressed: () =>
                            _choose('speed', 'fast', model: selected),
                      ),
                      _action(
                        title: 'Normal',
                        key: const Key('runtime.speed.default'),
                        selected: speed == 'Normal',
                        onPressed: () =>
                            _choose('speed', 'default', model: selected),
                      ),
                    ] else ...[
                      if (efforts.isNotEmpty) ...[
                        Padding(
                          padding: const EdgeInsets.only(
                            left: 43,
                            right: 16,
                            bottom: 10,
                          ),
                          child: Text(
                            'Intelligence',
                            style: TextStyle(
                              fontSize: 13,
                              height: 1.2,
                              fontWeight: FontWeight.w600,
                              color: colors.onSurfaceVariant,
                            ),
                          ),
                        ),
                        for (final effort in efforts)
                          _action(
                            title: desktopReasoningTitle(effort),
                            key: ValueKey('runtime.effort.$effort'),
                            selected: desktop.effort == effort,
                            onPressed: () =>
                                _choose('effort', effort, model: selected),
                          ),
                        Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 24,
                            vertical: 10,
                          ),
                          child: Divider(
                            height: 1,
                            color: colors.onSurface.withValues(alpha: .1),
                          ),
                        ),
                      ],
                      if (providers)
                        _action(
                          title: 'Provider & model',
                          icon: '3d-box-top',
                          key: const Key('desktop_runtime_model'),
                          onPressed: () => _choose('catalog', ''),
                        )
                      else
                        _parent(
                          'Model',
                          title,
                          '3d-box-top',
                          'model',
                          key: const Key('desktop_runtime_model'),
                        ),
                      if (desktop.supportsFastMode)
                        _parent(
                          'Speed',
                          speed,
                          'zap',
                          'speed',
                          key: const Key('runtime.speed'),
                        ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
}
